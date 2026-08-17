// Knowledge card lifecycle: turning sent replies into maintained knowledge
// instead of a pile of near-duplicate articles.
//
// The old auto-learning (in tickets/[id]/send) wrote ONE KnowledgeBase
// article per sent reply, deduplicated only by "does an article whose title
// contains the first 50 chars of this subject already exist". Two agents
// answering the same question differently produced two articles, both fed to
// the AI generator, with nothing anywhere recording that they disagreed. The
// pile was simply deleted after 30 days.
//
// A knowledge CARD is instead a knowledge identity: one recurring question,
// one currently-accepted answer, and the list of replies that confirmed it.
// Every sent reply is adjudicated against the existing cards and lands in
// exactly one of three states:
//
//   new         → no card covers this question; create one.
//   confirms    → a card covers it and the new answer agrees; link the
//                 ticket as another source and bump the confirmation count.
//   contradicts → a card covers it but the new answer says something
//                 materially different; raise a KnowledgeCardConflict and
//                 park the card in 'review' so the AI stops quoting an
//                 answer we no longer trust.
//
// Conflicts are NEVER resolved automatically. A helper model is good enough
// to notice that two answers disagree, and not good enough to decide which
// one is true — and picking wrong poisons every future answer on the topic.
//
// Like classifyTicket and sendConfirmationEmail, nothing here throws into
// the send path: knowledge maintenance is enrichment, and a failure must
// never stop a reply from reaching a customer.

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db/client';

// Adjudication compares two answers for contradiction — a reasoning task
// where a wrong call has lasting consequences (a bogus conflict wastes an
// agent's time; a missed one leaves the AI quoting a stale answer). It runs
// once per sent reply that has a plausible candidate, so the volume is low
// enough to use the stronger helper model.
const ADJUDICATION_MODEL = 'claude-sonnet-4-6';

// Cheap lexical prefilter before the model call. Cards below this score are
// not plausibly the same question, so they never reach the prompt.
const CANDIDATE_SCORE_THRESHOLD = 4;
// How many candidates the model gets to choose between.
const MAX_CANDIDATES = 6;
// Long threads add noise, not signal, to a same-question judgement.
const MAX_QUESTION_CHARS = 1500;
const MAX_ANSWER_CHARS = 3000;

export const CARD_STATUS = {
  active: 'active',
  review: 'review',
  archived: 'archived',
} as const;

export const CONFLICT_STATUS = {
  open: 'open',
  resolved: 'resolved',
  dismissed: 'dismissed',
} as const;

export const CONFLICT_RESOLUTION = {
  keptCurrent: 'kept_current',
  acceptedProposed: 'accepted_proposed',
  merged: 'merged',
} as const;

export type Verdict = 'new' | 'confirms' | 'contradicts';

// The minimum a card must expose to be adjudicated — so the pure functions
// can be unit-tested without a Prisma row.
export interface CandidateCard {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[];
}

export interface Adjudication {
  verdict: Verdict;
  // Which card the verdict is about; null when the verdict is 'new'.
  cardId: string | null;
  // One sentence on what contradicts what. Only meaningful for
  // 'contradicts', where it is shown to the agent in the review queue.
  reason: string;
}

export interface AdjudicateDeps {
  client?: Pick<Anthropic, 'messages'>;
}

let defaultClient: Anthropic | null = null;
function getDefaultClient(): Anthropic {
  if (!defaultClient) {
    defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return defaultClient;
}

// --- Stage 1: lexical candidate selection (pure) ---

const STOPWORDS = new Set([
  'och', 'att', 'det', 'som', 'för', 'med', 'jag', 'har', 'inte', 'den', 'kan',
  'vill', 'min', 'mitt', 'mina', 'hur', 'vad', 'när', 'är', 'ska', 'skulle',
  'man', 'på', 'till', 'från', 'the', 'and', 'for', 'you', 'this', 'that',
  'have', 'with', 'hej', 'hello', 'tack', 'mvh', 'hejsan',
]);

export function questionTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOPWORDS.has(w))
    )
  );
}

// How plausibly a card answers the same question, from term overlap alone.
// Deliberately generous: this only decides what the model gets to look at,
// and a missed candidate means a duplicate card, which is the failure mode
// the whole feature exists to prevent.
export function scoreCandidate(card: CandidateCard, terms: string[]): number {
  if (terms.length === 0) return 0;
  const questionLower = card.question.toLowerCase();
  const answerLower = card.answer.toLowerCase();
  const tagsLower = card.tags.map(t => t.toLowerCase());

  let score = 0;
  score += terms.filter(t => questionLower.includes(t)).length * 4;
  score += Math.min(terms.filter(t => answerLower.includes(t)).length * 1.5, 9);
  score += tagsLower.filter(tag => terms.some(t => tag.includes(t) || t.includes(tag))).length * 3;
  if (card.category && terms.some(t => card.category!.toLowerCase().includes(t))) score += 2;
  return score;
}

export function selectCandidates(cards: CandidateCard[], question: string): CandidateCard[] {
  const terms = questionTerms(question);
  return cards
    .map(card => ({ card, score: scoreCandidate(card, terms) }))
    .filter(({ score }) => score >= CANDIDATE_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(({ card }) => card);
}

// --- Stage 2: adjudication (one forced tool call) ---

const ADJUDICATE_TOOL: Anthropic.Tool = {
  name: 'adjudicate_answer',
  description:
    'Avgör om det skickade svaret besvarar samma fråga som ett befintligt kunskapskort, och i så fall om det bekräftar eller motsäger kortets svar.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['new', 'confirms', 'contradicts'],
        description:
          'new = inget kort besvarar samma fråga. confirms = ett kort besvarar samma fråga och svaren är sakligt förenliga. contradicts = ett kort besvarar samma fråga men svaren säger olika saker i sak.',
      },
      card_id: {
        type: 'string',
        description: 'ID:t för det kort domen gäller. Utelämnas när verdict är "new".',
      },
      reason: {
        type: 'string',
        description:
          'En mening på svenska som beskriver exakt vilken uppgift som skiljer sig. Endast relevant vid "contradicts".',
      },
    },
    required: ['verdict'],
  },
};

const ADJUDICATE_SYSTEM = `Du underhåller en kunskapsbas för kundtjänst.

Du får en fråga som en kund har ställt, svaret som en handläggare faktiskt skickade, och ett antal befintliga kunskapskort.

Avgör:
1. Besvarar något av korten SAMMA fråga? Samma fråga betyder samma sakliga ärende, även om orden skiljer sig. Olika frågor inom samma ämne är INTE samma fråga.
2. Om ja: säger det skickade svaret något som motsäger kortets svar i sak? Skillnader i ton, artighet, längd, hälsningsfraser eller kunduppgifter (namn, belopp, datum som gäller just den kunden) är INTE motsägelser. Olika pris, olika tidsfrist, olika villkor, olika förfarande eller motsatt besked ÄR motsägelser.

Är du osäker på om två svar motsäger varandra: välj "confirms". En falsk motsägelse stjäl tid från en handläggare i onödan.
Är du osäker på om det är samma fråga: välj "new". Ett extra kort är billigare än ett kort som blandar ihop två frågor.`;

export async function adjudicate(
  question: string,
  answer: string,
  candidates: CandidateCard[],
  deps: AdjudicateDeps = {}
): Promise<Adjudication> {
  if (candidates.length === 0) {
    return { verdict: 'new', cardId: null, reason: '' };
  }

  try {
    const client = deps.client ?? getDefaultClient();
    const cardList = candidates
      .map(
        c =>
          `[ID:${c.id}]\nFråga: ${c.question}\nSvar: ${c.answer.slice(0, MAX_ANSWER_CHARS)}`
      )
      .join('\n\n');

    const result = await client.messages.create({
      model: ADJUDICATION_MODEL,
      max_tokens: 400,
      system: ADJUDICATE_SYSTEM,
      tools: [ADJUDICATE_TOOL],
      tool_choice: { type: 'tool', name: 'adjudicate_answer' },
      messages: [
        {
          role: 'user',
          content: `KUNDENS FRÅGA:\n${question.slice(0, MAX_QUESTION_CHARS)}\n\nSKICKAT SVAR:\n${answer.slice(0, MAX_ANSWER_CHARS)}\n\nBEFINTLIGA KUNSKAPSKORT:\n${cardList}`,
        },
      ],
    });

    const toolUse = result.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );
    const input = (toolUse?.input ?? {}) as {
      verdict?: unknown;
      card_id?: unknown;
      reason?: unknown;
    };

    const verdict = input.verdict;
    if (verdict !== 'confirms' && verdict !== 'contradicts') {
      // Includes an explicit 'new' and anything unparseable: treat as new.
      return { verdict: 'new', cardId: null, reason: '' };
    }

    // A verdict about a card we did not offer is not actionable — the model
    // either hallucinated an id or dropped it. Fall back to 'new' rather
    // than confirming or conflicting against nothing.
    const cardId = typeof input.card_id === 'string' ? input.card_id : null;
    if (!cardId || !candidates.some(c => c.id === cardId)) {
      return { verdict: 'new', cardId: null, reason: '' };
    }

    return {
      verdict,
      cardId,
      reason: typeof input.reason === 'string' ? input.reason : '',
    };
  } catch (error) {
    console.error('Knowledge card adjudication failed:', error);
    // Unreachable model must not spawn a duplicate card on every send:
    // doing nothing is the safe failure.
    return { verdict: 'new', cardId: null, reason: '' };
  }
}

// --- Stage 3: applying the verdict ---

export interface RecordSentReplyInput {
  tenantId: string;
  ticketId: string;
  subject: string;
  // The customer's question, already stripped of the thread and of direct
  // identifiers by the caller.
  question: string;
  // What the agent actually sent.
  answer: string;
  category?: string | null;
}

export type RecordOutcome =
  | { action: 'created'; cardId: string }
  | { action: 'confirmed'; cardId: string }
  | { action: 'conflict'; cardId: string; conflictId: string }
  | { action: 'skipped'; reason: string };

// Called after a reply has been sent. NEVER throws.
export async function recordSentReply(
  input: RecordSentReplyInput,
  deps: AdjudicateDeps = {}
): Promise<RecordOutcome> {
  const { tenantId, ticketId, subject, question, answer, category } = input;

  try {
    if (!question.trim() || !answer.trim()) {
      return { action: 'skipped', reason: 'empty question or answer' };
    }

    // Archived cards are excluded: an agent retired them deliberately, and
    // resurrecting one through a confirmation would undo that decision.
    const existing = await prisma.knowledgeCard.findMany({
      where: { tenantId, status: { in: [CARD_STATUS.active, CARD_STATUS.review] } },
      select: { id: true, question: true, answer: true, category: true, tags: true },
    });

    const candidates = selectCandidates(existing, `${subject} ${question}`);
    const decision = await adjudicate(question, answer, candidates, deps);

    if (decision.verdict === 'new' || !decision.cardId) {
      const card = await prisma.knowledgeCard.create({
        data: {
          tenantId,
          question: question.slice(0, MAX_QUESTION_CHARS),
          answer,
          category: category ?? null,
          tags: deriveTags(subject),
          status: CARD_STATUS.active,
          sources: {
            create: { ticketId, subject, role: 'created' },
          },
        },
      });
      return { action: 'created', cardId: card.id };
    }

    if (decision.verdict === 'confirms') {
      const [card] = await prisma.$transaction([
        prisma.knowledgeCard.update({
          where: { id: decision.cardId },
          data: {
            confirmedCount: { increment: 1 },
            lastConfirmedAt: new Date(),
          },
        }),
        prisma.knowledgeCardSource.upsert({
          where: { cardId_ticketId: { cardId: decision.cardId, ticketId } },
          create: { cardId: decision.cardId, ticketId, subject, role: 'confirmed' },
          update: {},
        }),
      ]);
      return { action: 'confirmed', cardId: card.id };
    }

    // contradicts — park the card and queue the disagreement for a human.
    const current = await prisma.knowledgeCard.findUnique({
      where: { id: decision.cardId },
      select: { answer: true },
    });
    if (!current) return { action: 'skipped', reason: 'card disappeared' };

    const [conflict] = await prisma.$transaction([
      prisma.knowledgeCardConflict.create({
        data: {
          tenantId,
          cardId: decision.cardId,
          ticketId,
          subject,
          currentAnswer: current.answer,
          proposedAnswer: answer,
          reason: decision.reason || 'Svaren skiljer sig i sak.',
          status: CONFLICT_STATUS.open,
        },
      }),
      prisma.knowledgeCard.update({
        where: { id: decision.cardId },
        data: { status: CARD_STATUS.review },
      }),
      prisma.knowledgeCardSource.upsert({
        where: { cardId_ticketId: { cardId: decision.cardId, ticketId } },
        create: { cardId: decision.cardId, ticketId, subject, role: 'contested' },
        update: { role: 'contested' },
      }),
    ]);

    return { action: 'conflict', cardId: decision.cardId, conflictId: conflict.id };
  } catch (error) {
    console.error('Failed to record sent reply as knowledge card:', error);
    return { action: 'skipped', reason: 'error' };
  }
}

// Cheap topical tags from the subject, for lexical candidate matching. Not
// meant to be a taxonomy — Ticket.category already carries that.
export function deriveTags(subject: string): string[] {
  return questionTerms(subject).slice(0, 5);
}

// --- Resolution (agent-driven) ---

export interface ResolveConflictInput {
  tenantId: string;
  conflictId: string;
  resolution: (typeof CONFLICT_RESOLUTION)[keyof typeof CONFLICT_RESOLUTION];
  // Required for 'merged': the answer the agent wrote by hand.
  mergedAnswer?: string;
  resolvedBy: string;
}

// Settles one conflict and writes the agreed answer back to the card. The
// card returns to 'active' only when it has no other open conflicts, so a
// card contested twice is not quietly trusted again after one resolution.
export async function resolveConflict(input: ResolveConflictInput) {
  const { tenantId, conflictId, resolution, mergedAnswer, resolvedBy } = input;

  const conflict = await prisma.knowledgeCardConflict.findFirst({
    where: { id: conflictId, tenantId },
  });
  if (!conflict) return { ok: false as const, error: 'not_found' };
  if (conflict.status !== CONFLICT_STATUS.open) {
    return { ok: false as const, error: 'already_resolved' };
  }

  let answer: string;
  if (resolution === CONFLICT_RESOLUTION.keptCurrent) {
    answer = conflict.currentAnswer;
  } else if (resolution === CONFLICT_RESOLUTION.acceptedProposed) {
    answer = conflict.proposedAnswer;
  } else {
    if (!mergedAnswer?.trim()) return { ok: false as const, error: 'missing_merged_answer' };
    answer = mergedAnswer;
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.knowledgeCardConflict.update({
      where: { id: conflictId },
      data: {
        status: CONFLICT_STATUS.resolved,
        resolution,
        resolvedAnswer: answer,
        resolvedBy,
        resolvedAt: now,
      },
    }),
    // The agent has now made a judgement call on this answer, so the card
    // counts as curated: later replies that disagree raise a new conflict
    // instead of overwriting what a human decided.
    prisma.knowledgeCard.update({
      where: { id: conflict.cardId },
      data: { answer, curatedAt: now, curatedBy: resolvedBy },
    }),
  ]);

  await reactivateIfSettled(conflict.cardId);
  return { ok: true as const, cardId: conflict.cardId };
}

// Dismiss: the conflict was noise (the model misread two compatible
// answers). The card keeps the answer it had.
export async function dismissConflict(tenantId: string, conflictId: string, resolvedBy: string) {
  const conflict = await prisma.knowledgeCardConflict.findFirst({
    where: { id: conflictId, tenantId, status: CONFLICT_STATUS.open },
  });
  if (!conflict) return { ok: false as const, error: 'not_found' };

  await prisma.knowledgeCardConflict.update({
    where: { id: conflictId },
    data: {
      status: CONFLICT_STATUS.dismissed,
      resolvedBy,
      resolvedAt: new Date(),
    },
  });

  await reactivateIfSettled(conflict.cardId);
  return { ok: true as const, cardId: conflict.cardId };
}

async function reactivateIfSettled(cardId: string) {
  const stillOpen = await prisma.knowledgeCardConflict.count({
    where: { cardId, status: CONFLICT_STATUS.open },
  });
  if (stillOpen === 0) {
    // Only lift a card out of review — never drag an archived card back.
    await prisma.knowledgeCard.updateMany({
      where: { id: cardId, status: CARD_STATUS.review },
      data: { status: CARD_STATUS.active },
    });
  }
}
