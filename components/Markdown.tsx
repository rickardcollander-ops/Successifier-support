'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Shared markdown renderer used by the public help center and the admin
// editor preview. react-markdown does NOT render raw HTML (no rehype-raw),
// so user content can't inject markup — safe by default.
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="kb-prose max-w-none text-slate-700 dark:text-slate-200 leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="text-2xl font-bold mt-6 mb-3 text-slate-900 dark:text-slate-100" {...props} />,
          h2: (props) => <h2 className="text-xl font-semibold mt-6 mb-2 text-slate-900 dark:text-slate-100" {...props} />,
          h3: (props) => <h3 className="text-lg font-semibold mt-4 mb-2 text-slate-900 dark:text-slate-100" {...props} />,
          p: (props) => <p className="my-3" {...props} />,
          ul: (props) => <ul className="list-disc pl-6 my-3 space-y-1" {...props} />,
          ol: (props) => <ol className="list-decimal pl-6 my-3 space-y-1" {...props} />,
          a: (props) => <a className="text-[#7C5CFF] underline hover:brightness-110" target="_blank" rel="noopener noreferrer" {...props} />,
          code: (props) => <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-sm" {...props} />,
          pre: (props) => <pre className="p-4 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-x-auto my-3 text-sm" {...props} />,
          blockquote: (props) => <blockquote className="border-l-4 border-[#7C5CFF] pl-4 italic my-3 text-slate-600 dark:text-slate-300" {...props} />,
          table: (props) => <table className="border-collapse my-3 w-full text-sm" {...props} />,
          th: (props) => <th className="border border-slate-300 dark:border-slate-600 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-left" {...props} />,
          td: (props) => <td className="border border-slate-300 dark:border-slate-600 px-3 py-1.5" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
