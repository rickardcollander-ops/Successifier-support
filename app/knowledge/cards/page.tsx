'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Archive, FileText, Sparkles } from 'lucide-react';

interface Card {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  tags: string[];
  status: string;
  confirmedCount: number;
  lastConfirmedAt: string;
  curatedAt: string | null;
  curatedBy: string | null;
  sourceCount: number;
  openConflicts: number;
}

interface Conflict {
  id: string;
  cardId: string;
  ticketId: string;
  subject: string;
  currentAnswer: string;
  proposedAnswer: string;
  reason: string;
  createdAt: string;
  card: {
    id: string;
    question: string;
    category: string | null;
    confirmedCount: number;
    curatedBy: string | null;
  };
}

const card = 'bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-5';
const heading = 'flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100 mb-4';

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktivt',
  review: 'Granskas',
  archived: 'Arkiverat',
};

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  archived: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

export default function KnowledgeCardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mergeFor, setMergeFor] = useState<string | null>(null);
  const [mergeText, setMergeText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cardsRes, conflictsRes] = await Promise.all([
        fetch('/api/knowledge/cards'),
        fetch('/api/knowledge/conflicts?status=open'),
      ]);
      if (cardsRes.ok) setCards((await cardsRes.json()).cards ?? []);
      if (conflictsRes.ok) setConflicts((await conflictsRes.json()).conflicts ?? []);
    } catch (error) {
      console.error('Error loading knowledge cards:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const settle = async (conflictId: string, body: Record<string, unknown>) => {
    setBusyId(conflictId);
    try {
      const res = await fetch(`/api/knowledge/conflicts/${conflictId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMergeFor(null);
        setMergeText('');
        await load();
      }
    } catch (error) {
      console.error('Error resolving conflict:', error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/knowledge" className="text-sm text-[#7C5CFF] hover:underline">
          ← Kunskapsbas
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">Kunskapskort</h1>
        <p className="text-sm text-slate-500 mt-1">
          Varje kort är en återkommande fråga med ett svar som handläggare har bekräftat. När ett
          skickat svar motsäger ett kort hamnar det här för granskning – AI:n slutar använda kortet
          tills någon har avgjort vilken version som gäller.
        </p>
      </div>

      {loading ? (
        <div className="text-slate-600 dark:text-slate-400">Laddar kunskapskort…</div>
      ) : (
        <>
          <div className={card}>
            <h2 className={heading}>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Att granska
              {conflicts.length > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  {conflicts.length}
                </span>
              )}
            </h2>

            {conflicts.length === 0 ? (
              <p className="text-sm text-slate-500">
                Inga motsägelser att granska. Kunskapen är samstämmig.
              </p>
            ) : (
              <div className="space-y-5">
                {conflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 bg-amber-50/50 dark:bg-amber-900/10"
                  >
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {conflict.card.question}
                    </div>
                    <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">{conflict.reason}</p>
                    <div className="text-xs text-slate-500 mt-1">
                      Från ärende{' '}
                      <Link href={`/tickets/${conflict.ticketId}`} className="text-[#7C5CFF] hover:underline">
                        {conflict.subject}
                      </Link>
                      {conflict.card.curatedBy && ` · kortet redigerades senast av ${conflict.card.curatedBy}`}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 mt-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Nuvarande svar ({conflict.card.confirmedCount} bekräftelser)
                        </div>
                        <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 p-3">
                          {conflict.currentAnswer}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Nyss skickat svar
                        </div>
                        <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 p-3">
                          {conflict.proposedAnswer}
                        </div>
                      </div>
                    </div>

                    {mergeFor === conflict.id ? (
                      <div className="mt-4">
                        <textarea
                          value={mergeText}
                          onChange={(e) => setMergeText(e.target.value)}
                          rows={6}
                          placeholder="Skriv det svar som ska gälla framöver…"
                          className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            disabled={busyId === conflict.id || !mergeText.trim()}
                            onClick={() =>
                              settle(conflict.id, { resolution: 'merged', mergedAnswer: mergeText })
                            }
                            className="px-3 py-1.5 text-sm rounded-md bg-[#7C5CFF] text-white disabled:opacity-50"
                          >
                            Spara som gällande svar
                          </button>
                          <button
                            onClick={() => {
                              setMergeFor(null);
                              setMergeText('');
                            }}
                            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
                          >
                            Avbryt
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-4">
                        <button
                          disabled={busyId === conflict.id}
                          onClick={() => settle(conflict.id, { resolution: 'kept_current' })}
                          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 disabled:opacity-50"
                        >
                          Behåll nuvarande
                        </button>
                        <button
                          disabled={busyId === conflict.id}
                          onClick={() => settle(conflict.id, { resolution: 'accepted_proposed' })}
                          className="px-3 py-1.5 text-sm rounded-md bg-[#7C5CFF] text-white disabled:opacity-50"
                        >
                          Använd det nya svaret
                        </button>
                        <button
                          disabled={busyId === conflict.id}
                          onClick={() => {
                            setMergeFor(conflict.id);
                            setMergeText(conflict.proposedAnswer);
                          }}
                          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 disabled:opacity-50"
                        >
                          Skriv eget svar
                        </button>
                        <button
                          disabled={busyId === conflict.id}
                          onClick={() => settle(conflict.id, { action: 'dismiss' })}
                          className="px-3 py-1.5 text-sm rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-50"
                        >
                          Ingen motsägelse
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={card}>
            <h2 className={heading}>
              <Sparkles className="w-4 h-4 text-[#7C5CFF]" /> Alla kort ({cards.length})
            </h2>
            {cards.length === 0 ? (
              <p className="text-sm text-slate-500">
                Inga kort ännu. De skapas automatiskt när handläggare skickar svar.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {cards.map((c) => (
                  <div key={c.id} className="py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {c.question}
                      </div>
                      <div className="text-sm text-slate-500 line-clamp-2 mt-0.5">{c.answer}</div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1.5">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> {c.confirmedCount} bekräftelser
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" /> {c.sourceCount} ärenden
                        </span>
                        {c.curatedBy && <span>Redigerat av {c.curatedBy}</span>}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-0.5 text-xs rounded-full ${STATUS_CLASS[c.status] ?? STATUS_CLASS.archived}`}
                    >
                      {c.status === 'archived' && <Archive className="w-3 h-3 inline mr-1" />}
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
