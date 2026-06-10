'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, Search, ThumbsUp, AlertTriangle } from 'lucide-react';

interface Analytics {
  days: number;
  topArticles: Array<{ articleId: string | null; title: string; slug: string | null; views: number }>;
  topSearches: Array<{ query: string; count: number }>;
  noResultSearches: Array<{ query: string; count: number }>;
  feedback: Array<{ articleId: string; title: string; slug: string | null; helpful: number; unhelpful: number; ratio: number | null }>;
}

const card = 'bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-5';
const heading = 'flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100 mb-4';

export default function KnowledgeAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/knowledge/analytics?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/knowledge" className="text-sm text-[#7C5CFF] hover:underline">
            ← Kunskapsbas
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">Hjälpcenter – statistik</h1>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value={7}>7 dagar</option>
          <option value={30}>30 dagar</option>
          <option value={90}>90 dagar</option>
        </select>
      </div>

      {loading ? (
        <div className="text-slate-600 dark:text-slate-400">Laddar statistik…</div>
      ) : !data ? (
        <div className="text-slate-600 dark:text-slate-400">Kunde inte ladda statistik.</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className={card}>
            <h2 className={heading}><Eye className="w-4 h-4 text-[#4DA3FF]" /> Mest visade artiklar</h2>
            {data.topArticles.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen data ännu.</p>
            ) : (
              <ul className="space-y-2">
                {data.topArticles.map((a) => (
                  <li key={a.articleId} className="flex justify-between text-sm">
                    <span className="truncate pr-2">
                      {a.slug ? <Link href={`/help/${a.slug}`} target="_blank" className="hover:underline">{a.title}</Link> : a.title}
                    </span>
                    <span className="text-slate-500 tabular-nums">{a.views}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={card}>
            <h2 className={heading}><Search className="w-4 h-4 text-[#2FE0A7]" /> Vanligaste sökningar</h2>
            {data.topSearches.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen data ännu.</p>
            ) : (
              <ul className="space-y-2">
                {data.topSearches.map((s) => (
                  <li key={s.query} className="flex justify-between text-sm">
                    <span className="truncate pr-2">{s.query}</span>
                    <span className="text-slate-500 tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={card}>
            <h2 className={heading}><AlertTriangle className="w-4 h-4 text-[#FFB020]" /> Sökningar utan träff (innehållsluckor)</h2>
            {data.noResultSearches.length === 0 ? (
              <p className="text-sm text-slate-500">Inga sökningar utan träff. 🎉</p>
            ) : (
              <ul className="space-y-2">
                {data.noResultSearches.map((s) => (
                  <li key={s.query} className="flex justify-between text-sm">
                    <span className="truncate pr-2">{s.query}</span>
                    <span className="text-slate-500 tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={card}>
            <h2 className={heading}><ThumbsUp className="w-4 h-4 text-[#7C5CFF]" /> Hjälpsam-betyg</h2>
            {data.feedback.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen feedback ännu.</p>
            ) : (
              <ul className="space-y-2">
                {data.feedback.map((f) => (
                  <li key={f.articleId} className="flex justify-between text-sm">
                    <span className="truncate pr-2">{f.title}</span>
                    <span className="text-slate-500 tabular-nums">
                      {f.ratio != null ? `${f.ratio}%` : '—'} ({f.helpful}/{f.helpful + f.unhelpful})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
