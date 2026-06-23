'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, X, Send } from 'lucide-react';
import Markdown from '@/components/Markdown';

// Floating AI assistant for the help center. It answers strictly from the
// public knowledge base (see /api/public/kb/chat) and shows the source
// articles behind every answer. Colors come from the help-center theme via
// the --kb-* CSS variables, so it always matches the surrounding hjälpcenter.

interface Source {
  slug: string;
  title: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

interface HelpChatProps {
  title?: string;
  welcome?: string;
  placeholder?: string;
  suggestions?: string[];
}

export default function HelpChat({
  title = 'Fråga hjälpcentret',
  welcome = 'Hej! Ställ en fråga så söker jag svar i vårt hjälpcenter.',
  placeholder = 'Skriv din fråga…',
  suggestions = [],
}: HelpChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: welcome }]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Suggestions are offered until the visitor asks their first question.
  const started = messages.length > 1;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    const nextMessages: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    // Send prior turns (excluding the welcome at index 0 and the just-added
    // question) so follow-ups keep context.
    const history = nextMessages
      .slice(1, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    // Placeholder assistant message we stream tokens into.
    const botIndex = nextMessages.length;
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    const update = (fn: (m: Message) => Message) =>
      setMessages((prev) => prev.map((m, i) => (i === botIndex ? fn(m) : m)));

    try {
      const res = await fetch('/api/public/kb/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });
      if (!res.ok || !res.body) throw new Error('request failed');

      // Read the NDJSON stream line by line, appending deltas as they arrive.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: { type?: string; text?: string; sources?: Source[] };
        try {
          evt = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (evt.type === 'delta' && typeof evt.text === 'string') {
          update((m) => ({ ...m, content: m.content + evt.text }));
        } else if (evt.type === 'done') {
          update((m) => ({ ...m, sources: Array.isArray(evt.sources) ? evt.sources : [] }));
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
      if (buffer.trim()) handleLine(buffer);

      update((m) => (m.content ? m : { ...m, content: 'Något gick fel. Försök igen om en liten stund.' }));
    } catch {
      update((m) => ({ ...m, content: 'Något gick fel. Försök igen om en liten stund.' }));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Stäng chatt' : 'Öppna chatt'}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
        style={{ background: 'var(--kb-accent)', color: '#fff' }}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-5 z-50 flex max-h-[70vh] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{
            background: 'var(--kb-surface)',
            color: 'var(--kb-text)',
            borderColor: 'var(--kb-border)',
          }}
          role="dialog"
          aria-label="Hjälpchatt"
        >
          <div
            className="px-4 py-3 text-sm font-semibold"
            style={{ background: 'var(--kb-accent)', color: '#fff' }}
          >
            {title}
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) =>
              m.role === 'assistant' && m.content === '' ? null : (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
                  style={
                    m.role === 'user'
                      ? { background: 'var(--kb-accent)', color: '#fff' }
                      : { background: 'var(--kb-hover)', color: 'var(--kb-text)' }
                  }
                >
                  {m.role === 'assistant' ? (
                    <Markdown>{m.content}</Markdown>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}

                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--kb-border)' }}>
                      <div className="mb-1 text-xs font-medium" style={{ color: 'var(--kb-muted)' }}>
                        Källor
                      </div>
                      <ul className="space-y-1">
                        {m.sources.map((s) => (
                          <li key={s.slug}>
                            <Link
                              href={`/help/${s.slug}`}
                              className="text-xs hover:underline"
                              style={{ color: 'var(--kb-accent)' }}
                              onClick={() => setOpen(false)}
                            >
                              {s.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div
                  className="rounded-2xl px-3 py-2 text-sm"
                  style={{ background: 'var(--kb-hover)', color: 'var(--kb-muted)' }}
                >
                  Söker i hjälpcentret…
                </div>
              </div>
            )}

            {!started && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border px-3 py-1.5 text-xs text-left transition-colors hover:bg-[color:var(--kb-hover)]"
                    style={{ borderColor: 'var(--kb-border)', color: 'var(--kb-text)' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t p-3" style={{ borderColor: 'var(--kb-border)' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={1000}
              placeholder={placeholder}
              className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2"
              style={
                {
                  background: 'var(--kb-bg)',
                  color: 'var(--kb-text)',
                  borderColor: 'var(--kb-border)',
                  ['--tw-ring-color' as string]: 'var(--kb-accent)',
                } as React.CSSProperties
              }
              aria-label="Din fråga"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={loading || input.trim().length === 0}
              aria-label="Skicka"
              className="flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
              style={{ background: 'var(--kb-accent)', color: '#fff' }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
