'use client';

import { useState } from 'react';

// "Was this helpful?" widget on a help article. Posts a single anonymous
// helpful/unhelpful event to the public feedback API.
export default function ArticleFeedback({ slug }: { slug: string }) {
  const [submitted, setSubmitted] = useState(false);

  const send = async (helpful: boolean) => {
    setSubmitted(true);
    try {
      await fetch(`/api/public/kb/articles/${encodeURIComponent(slug)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
      });
    } catch {
      /* best-effort; the UI already thanked the user */
    }
  };

  if (submitted) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Tack för din feedback!</p>;
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-600 dark:text-slate-300">Var detta till hjälp?</span>
      <button
        onClick={() => send(true)}
        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm"
      >
        👍 Ja
      </button>
      <button
        onClick={() => send(false)}
        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm"
      >
        👎 Nej
      </button>
    </div>
  );
}
