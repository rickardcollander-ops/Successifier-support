'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Send, Sparkles } from 'lucide-react';
import Markdown from '@/components/Markdown';

// The AI contact form (/help/kontakt). Flow:
//
//   1. The customer fills in name, email and their question.
//   2. On submit the question is answered INSTANTLY by the AI, streamed
//      token-by-token from the public knowledge base — no ticket yet.
//   3. Under the answer the customer chooses: "det löste min fråga" (logged,
//      done — a deflected ticket) or "skicka till kundservice" (the question
//      plus the answer they already saw becomes a ticket).
//
// When the operator has disabled the AI (chatEnabled=false) the same form
// submits straight to customer service like a classic contact form.

interface Source {
  slug: string;
  title: string;
}

type Phase = 'form' | 'answering' | 'answered' | 'submitting' | 'submitted' | 'resolved';

export default function ContactForm({ aiEnabled }: { aiEnabled: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = {
    background: 'var(--kb-surface)',
    color: 'var(--kb-text)',
    borderColor: 'var(--kb-border)',
    ['--tw-ring-color' as string]: 'var(--kb-accent)',
  };

  function validate(): boolean {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Ange en giltig e-postadress.');
      return false;
    }
    if (message.trim().length < 5) {
      setError('Beskriv din fråga med minst några ord.');
      return false;
    }
    setError(null);
    return true;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (aiEnabled) await streamAnswer();
    else await submitTicket('');
  }

  // Ask the AI first. Streams NDJSON deltas into `answer`; on any failure we
  // fall through to a normal submission so the customer is never stuck.
  async function streamAnswer() {
    setPhase('answering');
    setAnswer('');
    setSources([]);
    try {
      const res = await fetch('/api/public/contact/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: message.trim() }),
      });
      if (!res.ok || !res.body) throw new Error('answer failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

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
          full += evt.text;
          setAnswer(full);
        } else if (evt.type === 'done') {
          setSources(Array.isArray(evt.sources) ? evt.sources : []);
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

      if (!full.trim()) throw new Error('empty answer');
      setPhase('answered');
    } catch {
      // AI unavailable → behave like a plain contact form.
      await submitTicket('');
    }
  }

  async function submitTicket(aiAnswer: string) {
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch('/api/public/contact/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          aiAnswer,
          company: honeypot,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'submit failed');
      setPhase('submitted');
    } catch (err) {
      setError(err instanceof Error && err.message !== 'submit failed' ? err.message : 'Något gick fel. Försök igen om en liten stund.');
      setPhase(aiAnswer ? 'answered' : 'form');
    }
  }

  function markResolved() {
    setPhase('resolved');
    // Fire-and-forget deflection statistics — never blocks the UI.
    void fetch('/api/public/contact/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: message.trim() }),
    }).catch(() => {});
  }

  function reset() {
    setMessage('');
    setAnswer('');
    setSources([]);
    setError(null);
    setPhase('form');
  }

  // Terminal states: a thank-you card instead of the form.
  if (phase === 'submitted' || phase === 'resolved') {
    return (
      <div
        className="rounded-xl border p-6 text-center space-y-3"
        style={{ borderColor: 'var(--kb-border)', background: 'var(--kb-surface)' }}
      >
        <CheckCircle2 className="mx-auto" size={32} style={{ color: 'var(--kb-accent)' }} />
        {phase === 'submitted' ? (
          <>
            <h2 className="text-lg font-semibold">Tack! Vi har tagit emot ditt ärende.</h2>
            <p className="text-sm text-[color:var(--kb-muted)]">
              Kundservice svarar dig via e-post på <strong>{email.trim()}</strong> så snart som möjligt.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Vad kul att det löste sig!</h2>
            <p className="text-sm text-[color:var(--kb-muted)]">Inget ärende skickades — du är klar.</p>
          </>
        )}
        <button
          type="button"
          onClick={reset}
          className="text-sm hover:underline"
          style={{ color: 'var(--kb-accent)' }}
        >
          Ställ en ny fråga
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Namn</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoComplete="name"
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              style={inputStyle}
              disabled={phase !== 'form'}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">E-post *</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
              style={inputStyle}
              disabled={phase !== 'form'}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Vad vill du ha hjälp med? *</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={5}
            maxLength={5000}
            rows={5}
            placeholder="Beskriv din fråga så utförligt du kan…"
            className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
            style={inputStyle}
            disabled={phase !== 'form'}
          />
        </label>

        {/* Honeypot: hidden from humans, filled in by naive bots. */}
        <div className="hidden" aria-hidden="true">
          <label>
            Företag
            <input
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              name="company"
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {phase === 'form' && (
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--kb-accent)' }}
          >
            {aiEnabled ? <Sparkles size={16} /> : <Send size={16} />}
            {aiEnabled ? 'Få svar direkt' : 'Skicka till kundservice'}
          </button>
        )}
      </form>

      {(phase === 'answering' || phase === 'answered' || phase === 'submitting') && (
        <div
          className="rounded-xl border p-5 space-y-4"
          style={{ borderColor: 'var(--kb-border)', background: 'var(--kb-surface)' }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} style={{ color: 'var(--kb-accent)' }} />
            Direktsvar
          </div>

          {answer ? (
            <div className="text-sm">
              <Markdown>{answer}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-[color:var(--kb-muted)]">Söker svar på din fråga…</p>
          )}

          {sources.length > 0 && (
            <div className="border-t pt-3" style={{ borderColor: 'var(--kb-border)' }}>
              <div className="mb-1 text-xs font-medium text-[color:var(--kb-muted)]">Källor</div>
              <ul className="space-y-1">
                {sources.map((s) => (
                  <li key={s.slug}>
                    <Link
                      href={`/help/${s.slug}`}
                      className="text-xs hover:underline"
                      style={{ color: 'var(--kb-accent)' }}
                    >
                      {s.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(phase === 'answered' || phase === 'submitting') && (
            <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--kb-border)' }}>
              <p className="text-sm font-medium">Löste det här din fråga?</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={markResolved}
                  disabled={phase === 'submitting'}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'var(--kb-accent)' }}
                >
                  Ja, det löste sig
                </button>
                <button
                  type="button"
                  onClick={() => submitTicket(answer)}
                  disabled={phase === 'submitting'}
                  className="rounded-xl border px-4 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--kb-hover)] disabled:opacity-40"
                  style={{ borderColor: 'var(--kb-border)', color: 'var(--kb-text)' }}
                >
                  {phase === 'submitting' ? 'Skickar…' : 'Nej, skicka till kundservice'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
