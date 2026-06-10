'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Shared markdown renderer used by the public help center and the admin
// editor preview. react-markdown does NOT render raw HTML (no rehype-raw),
// so user content can't inject markup — safe by default.
//
// IMPORTANT: this component must NOT use Tailwind `dark:` variants. The app's
// root <html> always carries the `dark` class, so `dark:` would activate even
// inside the help center's light theme. Instead it inherits the surrounding
// text color and uses theme-neutral, semi-transparent surfaces plus the
// --kb-accent variable (falling back to the brand purple in the admin).
const accent = 'var(--kb-accent, #7C5CFF)';
const surface = 'rgb(128 128 128 / 0.14)';

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="max-w-none leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="text-2xl font-bold mt-6 mb-3" {...props} />,
          h2: (props) => <h2 className="text-xl font-semibold mt-6 mb-2" {...props} />,
          h3: (props) => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
          p: (props) => <p className="my-3" {...props} />,
          ul: (props) => <ul className="list-disc pl-6 my-3 space-y-1" {...props} />,
          ol: (props) => <ol className="list-decimal pl-6 my-3 space-y-1" {...props} />,
          a: (props) => (
            <a className="underline hover:opacity-80" style={{ color: accent }} target="_blank" rel="noopener noreferrer" {...props} />
          ),
          code: (props) => (
            <code className="px-1.5 py-0.5 rounded text-sm" style={{ background: surface }} {...props} />
          ),
          pre: (props) => (
            <pre className="p-4 rounded-lg overflow-x-auto my-3 text-sm" style={{ background: surface }} {...props} />
          ),
          blockquote: (props) => (
            <blockquote className="pl-4 italic my-3 opacity-80" style={{ borderLeft: `4px solid ${accent}` }} {...props} />
          ),
          table: (props) => <table className="border-collapse my-3 w-full text-sm" {...props} />,
          th: (props) => (
            <th className="px-3 py-1.5 text-left" style={{ border: '1px solid rgb(128 128 128 / 0.3)', background: surface }} {...props} />
          ),
          td: (props) => (
            <td className="px-3 py-1.5" style={{ border: '1px solid rgb(128 128 128 / 0.3)' }} {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
