'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PublicArticle } from '@/lib/types';

// Debounced search box for the help center. Hits the public search API and
// shows live results; no auth required. Colors come from the help-center
// theme via CSS variables (see globals.css .kb-root).
export default function HelpSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/public/kb/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Sök i hjälpcentret…"
        className="w-full px-4 py-3 rounded-xl border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] text-[color:var(--kb-text)] outline-none focus:ring-2"
        style={{ ['--tw-ring-color' as string]: 'var(--kb-accent)' } as React.CSSProperties}
        aria-label="Sök"
      />
      {query.trim().length >= 2 && (
        <div className="mt-3 rounded-xl border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] overflow-hidden">
          {loading && <div className="p-4 text-sm text-[color:var(--kb-muted)]">Söker…</div>}
          {!loading && searched && results.length === 0 && (
            <div className="p-4 text-sm text-[color:var(--kb-muted)]">Inga träffar för ”{query}”.</div>
          )}
          {results.map((a) => (
            <Link
              key={a.slug}
              href={`/help/${a.slug}`}
              className="block p-4 border-t border-[color:var(--kb-border)] first:border-t-0 hover:bg-[color:var(--kb-hover)]"
            >
              <div className="font-medium">{a.title}</div>
              {a.excerpt && <div className="text-sm text-[color:var(--kb-muted)] mt-0.5">{a.excerpt}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
