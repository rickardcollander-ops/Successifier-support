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
    return <p className="text-sm text-[color:var(--kb-muted)]">Tack för din feedback!</p>;
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-[color:var(--kb-text)]">Var detta till hjälp?</span>
      <button
        onClick={() => send(true)}
        className="px-3 py-1.5 rounded-lg border border-[color:var(--kb-border)] hover:bg-[color:var(--kb-hover)] text-sm"
      >
        👍 Ja
      </button>
      <button
        onClick={() => send(false)}
        className="px-3 py-1.5 rounded-lg border border-[color:var(--kb-border)] hover:bg-[color:var(--kb-hover)] text-sm"
      >
        👎 Nej
      </button>
    </div>
  );
}
