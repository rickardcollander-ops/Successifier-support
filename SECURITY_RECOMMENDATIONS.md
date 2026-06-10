# Säkerhetsmodell

Senast uppdaterad: 2026-06-10.

## Autentisering av API-rutter

- **Middleware** (`middleware.ts`) skyddar alla sidor (session krävs) och
  avvisar API-anrop som varken har session eller nyckel-header. Den validerar
  INTE API-nycklar (ingen DB-åtkomst i edge-runtime) — det gör varje route.
- **Varje API-route** anropar en guard från `lib/api-auth.ts`:
  - `requireApiAuth(request)` — session ELLER giltig API-nyckel
    (tickets, knowledge, reports, billecta-sök, gmail-sync m.fl.)
  - `requireSession()` — endast session (integrations- och API-nyckelhantering)
  - `requireSuperadmin()` — session med rollen `superadmin` (`/api/admin/*`,
    `/api/tickets/test`)
  - `validateApiKey(request)` — endast giltig API-nyckel (`/api/webhook/ticket`,
    som dessutom rate-limitas via `lib/rate-limit.ts`)

Ny route? **Lägg alltid till en guard.** Middlewaren räcker inte.

## API-nycklar

- Genereras med `crypto.randomBytes` (`lib/api-auth.ts`).
- Lagras som **SHA-256-hash** i `ApiKey.key`; visningsformen ligger i
  `ApiKey.maskedKey`. Klartextnyckeln returneras exakt en gång, vid skapande.
- Äldre rader med klartextnycklar uppgraderas automatiskt (hashas) första
  gången de används.

## Hemligheter i databasen

- **Integration.credentials**: krypteras med AES-256-GCM (`lib/crypto.ts`,
  nyckel i `ENCRYPTION_KEY`, 64 hex-tecken — `openssl rand -hex 32`).
  API:et returnerar aldrig dekrypterade värden till klienten; svaren är
  maskerade och redigeringsformuläret skickar bara fält som ändrats.
- **EmailAccount.accessToken/refreshToken** (Gmail OAuth): krypteras vid
  skrivning (`lib/integrations/gmail-account.ts` + callback-routen). Äldre
  klartextrader läses transparent och omkrypteras när Google roterar tokens.

## Kvarstående rekommendationer

- **Rotera** alla integrationsnycklar (Stripe/Billecta/Resend) och API-nycklar
  som skapats före 2026-06-10 — de kan ha exponerats medan API:et saknade auth.
- Debugloggar med kunddata är borttagna ur arbetsträdet men finns kvar i
  git-historiken; överväg en historiktvätt (t.ex. `git filter-repo`) om repot
  delas externt.
- Rate-limitern är per serverless-instans (best effort). Byt till en delad
  store (Upstash/Vercel KV) om belastningen ökar.
- `allowDangerousEmailAccountLinking: true` i `lib/auth.ts` är acceptabelt så
  länge Google är enda providern — ta bort den innan fler providers läggs till.
