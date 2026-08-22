'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Mail } from 'lucide-react';
import { product } from '@/lib/products';

// Which sign-in methods this tenant offers comes from its configuration, so
// a customer on neither Google nor Microsoft sees only the magic-link form
// and never a button that would be refused server-side.
function GoogleMark() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function MagicLinkForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setSendFailed(false);
    try {
      const result = await signIn('resend', { email: email.trim(), callbackUrl, redirect: false });
      // 'EmailSignin' means the mail could not be sent at all — a broken or
      // missing Resend route, identical for every address, so surfacing it
      // reveals nothing about who exists. Every OTHER outcome (including a
      // refused address) shows the same confirmation below, so the form can't
      // be used to enumerate who works at the customer.
      if (result && typeof result === 'object' && 'error' in result && result.error === 'EmailSignin') {
        setSendFailed(true);
        return;
      }
      setSent(true);
    } catch {
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  };

  if (sendFailed) {
    return (
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 text-center">
        Det gick inte att skicka inloggningslänken. Kontakta en administratör —
        e-postutskicket är inte konfigurerat för den här kunden.
      </div>
    );
  }

  if (sent) {
    return (
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 text-center">
        Om adressen har åtkomst har vi skickat en inloggningslänk till{' '}
        <span className="font-medium">{email}</span>. Länken gäller i 10 minuter.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="din@adress.se"
        autoComplete="email"
        className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        type="submit"
        disabled={sending}
        className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg px-6 py-3 text-white font-medium transition-colors shadow-sm"
      >
        <Mail className="w-5 h-5" />
        {sending ? 'Skickar…' : 'Skicka inloggningslänk'}
      </button>
    </form>
  );
}

function SignInContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/tickets';

  // Read lazily inside the component — `product` is a live view of the active
  // tenant, never something to capture at module level.
  const providers = product.authProviders?.length ? product.authProviders : ['google'];
  const showGoogle = providers.includes('google');
  const showMagicLink = providers.includes('resend');
  const allowedDomain = product.allowedDomains?.[0];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 w-full max-w-md border border-slate-200 dark:border-slate-700">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            {product.displayName} Support
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Logga in för att hantera kundärenden
          </p>
        </div>

        {error === 'AccessDenied' && (
          <div className="mb-6 p-3 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 text-center">
            Åtkomst nekad. Kontakta en administratör för att bli inbjuden
            {allowedDomain ? ` eller logga in med ett @${allowedDomain}-konto.` : '.'}
          </div>
        )}

        {error === 'ProviderDisabled' && (
          <div className="mb-6 p-3 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300 text-center">
            Det inloggningssättet är inte aktiverat för den här kunden.
          </div>
        )}

        {error === 'EmailSignin' && (
          <div className="mb-6 p-3 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 text-center">
            Det gick inte att skicka inloggningslänken. Kontakta en administratör.
          </div>
        )}

        {error === 'Verification' && (
          <div className="mb-6 p-3 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300 text-center">
            Länken har gått ut eller redan använts. Begär en ny nedan.
          </div>
        )}

        {error === 'OAuthAccountNotLinked' && (
          <div className="mb-6 p-3 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300 text-center">
            Det gick inte att logga in. Försök igen.
          </div>
        )}

        <div className="space-y-4">
          {showGoogle && (
            <button
              onClick={() => signIn('google', { callbackUrl })}
              className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-700 border-2 border-slate-300 dark:border-slate-600 rounded-lg px-6 py-3 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors shadow-sm"
            >
              <GoogleMark />
              Sign in with Google
            </button>
          )}

          {showGoogle && showMagicLink && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-slate-400 dark:text-slate-500">eller</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            </div>
          )}

          {showMagicLink && <MagicLinkForm callbackUrl={callbackUrl} />}
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-6">
          Powered by{' '}
          <span className="font-semibold bg-gradient-to-r from-[#7C5CFF] to-[#9F7BFF] bg-clip-text text-transparent">
            Successifier
          </span>
        </p>
      </div>
    </div>
  );
}

export default function SignIn() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
