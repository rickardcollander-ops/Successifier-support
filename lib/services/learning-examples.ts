// Selection + formatting of learning examples for the AI draft generator.
//
// The signal we learn from is what agents actually DO with drafts, not what
// they explicitly rate: every send logs an AIResponseFeedback row (usually
// with rating: null), while the thumbs up/down buttons are optional and
// rarely used. The old implementation only looked at rating='positive' rows,
// so in practice the generator almost never saw an example — and the richest
// signal of all, drafts an agent rewrote before sending, was never used.
//
// Rules:
// - Sent verbatim (wasEdited=false)            → exemplar: the AI got it right.
// - Lightly edited (most of the draft kept)    → exemplar: the SENT version.
// - Rewritten (most of the sent text is new)   → corrective pair: show the bad
//   draft next to what the agent actually sent, so the model stops making the
//   same mistake on similar questions.
// - Explicit negative rating                    → always corrective.
// - Explicit positive rating                    → never corrective, boosts rank.
//
// Pure functions (no prisma) so the logic is unit-testable; the generator
// does the query and hands rows here.

import { keptFromDraftRatio } from '@/lib/text-diff';

export interface LearningFeedbackRow {
  ticketId: string;
  subject: string;
  originalMessage: string;
  aiResponse: string;
  finalResponse: string | null;
  wasEdited: boolean;
  rating: string | null; // 'positive' | 'negative' | null
}

export interface SelectedExemplar {
  row: LearningFeedbackRow;
  verbatim: boolean; // sent exactly as the AI wrote it
}

export interface SelectedCorrective {
  row: LearningFeedbackRow;
}

export interface SelectedLearningExamples {
  exemplars: SelectedExemplar[];
  correctives: SelectedCorrective[];
}

// Below this share of the sent reply coming from the draft, the agent
// effectively rewrote it — that's a corrective example, not an exemplar.
const REWRITE_KEPT_THRESHOLD = 0.5;

const MAX_EXEMPLARS = 3;
const MAX_CORRECTIVES = 2;

// Strip sync metadata headers so examples don't teach the model to emit them.
const GMAIL_META = /\[Gmail ID:.*?\]\n?(\[Message-Id:.*?\]\n?)?(\[Inbox account:.*?\]\n?)?\n?/g;

function questionExcerpt(originalMessage: string, maxLen: number): string {
  // Merged tickets accumulate the whole thread; the first segment before a
  // "---" separator is the customer's original question.
  return originalMessage
    .replace(GMAIL_META, '')
    .split(/\n---\n/)[0]
    .substring(0, maxLen)
    .trim();
}

// Newest-first dedupe to one row per ticket. A ticket can log several rows
// (a thumbs rating while composing + the automatic row at send); we keep the
// newest row's text but carry over the newest explicit rating from any of
// the ticket's rows, so a thumbs-down isn't erased by the unrated send row.
export function dedupeByTicket(rowsNewestFirst: LearningFeedbackRow[]): LearningFeedbackRow[] {
  const byTicket = new Map<string, LearningFeedbackRow>();
  for (const row of rowsNewestFirst) {
    const existing = byTicket.get(row.ticketId);
    if (!existing) {
      byTicket.set(row.ticketId, { ...row });
    } else if (existing.rating == null && row.rating != null) {
      existing.rating = row.rating;
    }
  }
  return Array.from(byTicket.values());
}

export function selectLearningExamples(
  rowsNewestFirst: LearningFeedbackRow[],
  searchTerms: string[]
): SelectedLearningExamples {
  const empty: SelectedLearningExamples = { exemplars: [], correctives: [] };
  if (searchTerms.length === 0) return empty;

  const deduped = dedupeByTicket(rowsNewestFirst);

  const exemplarScored: { ex: SelectedExemplar; score: number }[] = [];
  const correctiveScored: { c: SelectedCorrective; score: number }[] = [];

  for (const row of deduped) {
    if (!row.finalResponse || row.finalResponse.trim() === '') continue;

    const haystack = `${row.subject} ${row.originalMessage}`.toLowerCase();
    const matchCount = searchTerms.filter((t) => haystack.includes(t)).length;
    if (matchCount === 0) continue;

    if (row.rating === 'negative') {
      correctiveScored.push({ c: { row }, score: matchCount });
      continue;
    }

    if (!row.wasEdited) {
      exemplarScored.push({
        ex: { row, verbatim: true },
        score: matchCount + 0.5 + (row.rating === 'positive' ? 1 : 0),
      });
      continue;
    }

    const kept = keptFromDraftRatio(row.aiResponse, row.finalResponse);
    if (row.rating !== 'positive' && kept != null && kept < REWRITE_KEPT_THRESHOLD) {
      correctiveScored.push({ c: { row }, score: matchCount });
    } else {
      // Lightly edited (or explicitly approved): the sent version is a good
      // example of the desired answer.
      exemplarScored.push({
        ex: { row, verbatim: false },
        score: matchCount + (row.rating === 'positive' ? 1 : 0),
      });
    }
  }

  exemplarScored.sort((a, b) => b.score - a.score);
  correctiveScored.sort((a, b) => b.score - a.score);

  return {
    exemplars: exemplarScored.slice(0, MAX_EXEMPLARS).map((s) => s.ex),
    correctives: correctiveScored.slice(0, MAX_CORRECTIVES).map((s) => s.c),
  };
}

export function formatLearningExamples(selected: SelectedLearningExamples): string {
  const { exemplars, correctives } = selected;
  if (exemplars.length === 0 && correctives.length === 0) return '';

  let formatted = '';

  if (exemplars.length > 0) {
    formatted +=
      '\n\n=== GODKÄNDA EXEMPELSVAR (Skickade till riktiga kunder — använd som riktlinje för ton, format, längd och innehåll) ===\n';
    exemplars.forEach(({ row, verbatim }, index) => {
      formatted += `\nExempel ${index + 1}${verbatim ? ' (AI-svar, skickat oförändrat)' : ' (redigerat av agent — detta är den skickade versionen)'}:\n`;
      formatted += `Ämne: ${row.subject}\n`;
      formatted += `Kund: ${questionExcerpt(row.originalMessage, 300)}\n`;
      formatted += `Skickat svar: ${row.finalResponse!.substring(0, 500).trim()}\n`;
    });
  }

  if (correctives.length > 0) {
    formatted +=
      '\n=== UNDVIK (AI-utkast som agenten skrev om innan de skickades — lär dig av skillnaden och svara som det skickade svaret) ===\n';
    correctives.forEach(({ row }, index) => {
      formatted += `\nUndvik-exempel ${index + 1} (ämne: ${row.subject}):\n`;
      formatted += `Kund: ${questionExcerpt(row.originalMessage, 200)}\n`;
      formatted += `AI:s utkast (skickades INTE): ${row.aiResponse.substring(0, 300).trim()}\n`;
      formatted += `Vad agenten faktiskt skickade: ${row.finalResponse!.substring(0, 400).trim()}\n`;
    });
  }

  return formatted;
}
