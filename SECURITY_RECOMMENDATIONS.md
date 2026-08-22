# Säkerhetsmodell

Senast uppdaterad: 2026-08-22 (tredje passet: inbjudningsgrind, magisk länk,
återkallningsbara sessioner).

## Vem som får logga in

- **`lib/auth-policy.ts`** är den enda platsen som avgör åtkomst. Både
  NextAuths `signIn`-callback och inbjudnings-API:t (`POST /api/users`)
  läser den, så regeln kan inte glida isär mellan "vem släpps in" och
  "vem bjuds in".
- Ordningen är medvetet fail-closed: avstängt konto avvisas före allt
  annat, korsande tenant avvisas alltid, och utan resolvad tenant sker
  ingen domän-autojoin.
- **`User`-raden är sanningen**, providern bevisar bara identiteten. Att
  byta en kund från Google till magisk länk (eller senare till egen OIDC)
  ändrar därför inte vem som har åtkomst.
- **Sessioner är återkallningsbara.** JWT-strategin läser om roll, tenant
  och status var femte minut (`SESSION_REFRESH_SECONDS`) och returnerar
  `null` för raderade/avstängda konton, så borttag i user-adminen biter
  inom minuter i stället för vid tokenutgång. Total livslängd 12 timmar
  i stället för NextAuths 30 dygn.
- **Magisk länk avslöjar inte vilka adresser som finns.** Avvisade adresser
  får aldrig något mejl (`signIn` returnerar false på verificationRequest-
  benet) och inloggningssidan visar samma bekräftelse oavsett.
- `allowDangerousEmailAccountLinking` är kvar men är inte längre farlig i
  praktiken: båda providrarna bevisar kontroll över SAMMA adress (Google
  verifierar e-post — vilket dessutom kontrolleras explicit via
  `profile.email_verified` — och en magisk länk är per definition bevis på
  mejlåtkomst). Den behövs för att inbjudningar ska fungera, eftersom ett
  inbjudet konto saknar `Account`-rad tills personen loggar in första
  gången. **Innan en provider som kan returnera overifierad e-post läggs
  till måste den bort, eller den providern undantas från länkning.**

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
- **Regressionstest**: `tests/route-guards.test.ts` verifierar statiskt att
  varje `app/api/**/route.ts` innehåller en guard (eller står på en
  motiverad allowlist). Ny route utan guard ⇒ rött CI.

## Tenant-isolering

- API-nycklar valideras mot deploymentets tenant: en nyckel utfärdad för en
  annan tenant avvisas även om databasen delas (`lib/api-auth.ts`).
- Alla `[id]`-rutter slår upp objekt via tenant-skopade hjälpare i
  `lib/db/scoped.ts` (`findScopedTicket`/`findScopedKnowledge`/
  `findScopedEmailAccount`). Slå ALDRIG upp på bart `id` i en route.
- `PATCH /api/tickets/[id]` och `PATCH /api/knowledge/[id]` tillåter endast
  vitlistade fält — `tenantId`, timestamps m.m. är serverstyrda.

## Inkommande kundinnehåll

- Konversationer lagras som textblock med markörer (`[Gmail Thread: …]`,
  `[Inbox account: …]` osv). All kundtext saneras med
  `lib/services/sanitize.ts` innan den lagras, så injicerade markörer i
  mejlkroppar inte kan kapa trådmatchning eller utskicksparsning.
  Långsiktigt bör konversationer flyttas till en egen Message-tabell.

## API-nycklar

- Genereras med `crypto.randomBytes` (`lib/api-keys.ts`).
- Lagras som **SHA-256-hash** i `ApiKey.key`; visningsformen ligger i
  `ApiKey.maskedKey`. Klartextnyckeln returneras exakt en gång, vid skapande.
- Äldre rader med klartextnycklar uppgraderas automatiskt (hashas) första
  gången de används.

## Hemligheter i databasen

- **Integration.credentials**: krypteras med AES-256-GCM (`lib/crypto.ts`,
  nyckel i `ENCRYPTION_KEY`, 64 hex-tecken — `openssl rand -hex 32`).
  API:et returnerar aldrig dekrypterade värden till klienten. Läs alltid via
  `decryptCredentials` (`lib/integrations/credentials.ts`).
- **EmailAccount.accessToken/refreshToken** (Gmail OAuth): krypteras vid
  skrivning (`lib/integrations/gmail-account.ts` + callback-routen).
- **Inloggningen begär inte längre Gmail-scopes.** Gmail-åtkomst ges enbart
  per inkorg via `/api/auth/gmail`-flödet (krypterade tokens). NextAuths
  `Account`-tabell innehåller därmed bara identitetstokens. Äldre rader kan
  fortfarande innehålla Gmail-tokens i klartext — rensa dem
  (`UPDATE "Account" SET access_token = NULL, refresh_token = NULL`) och
  återkalla appens äldre grants i Google-kontona.

## AI och kunddata

- Lär-artiklarna som skapas vid utskick (`/api/tickets/[id]/send`) innehåller
  inte längre kundens mejladress och bara ett utdrag av frågan — de matas in
  i AI-svar till andra kunder. `AIResponseFeedback` innehåller däremot full
  kunddata; den används bara internt men behöver en gallringspolicy (GDPR).
- AI-generering och utskick rate-limitas per klient-IP (`lib/rate-limit.ts`).

## Kvarstående rekommendationer

- **Rotera** alla integrationsnycklar (Stripe/Billecta/Resend) och API-nycklar
  som skapats före 2026-06-10 — de kan ha exponerats medan API:et saknade auth.
- Rensa Gmail-tokens ur `Account`-tabellen (se ovan).
- Debugloggar med kunddata är borttagna ur arbetsträdet men finns kvar i
  git-historiken; överväg en historiktvätt (t.ex. `git filter-repo`) om repot
  delas externt.
- Rate-limitern och presence-störet är per serverless-instans (best effort).
  Byt till en delad store (Upstash/Vercel KV/Redis) innan horisontell skalning.
- Gmail-synk triggas av öppna webbflikar. Flytta synk + AI-generering till
  cron/jobbkö (Inngest, Trigger.dev, BullMQ) så mejl tas emot även när ingen
  har fliken öppen. `after()` används redan så AI-jobb överlever svaret på
  serverless.
- Bilagor lagras som data-URL:er i `Ticket.contextData`. Flytta till
  objektlagring (S3/motsv.) när volymen växer.
- Magisk länk är rate-limitad av `lib/rate-limit.ts`, som är per serverless-
  instans. Byt till en delad store innan volymen växer, annars kan en
  angripare mejlbomba en känd adress genom att träffa flera instanser.
- Kunder som kör magisk länk har e-postkontot som enda faktor. Där MFA
  krävs, styr kunden mot Google/M365 (eller egen OIDC) i stället.
- Superadmin-listan styrs av `SUPERADMIN_EMAILS` (env, kommaseparerad) med
  nuvarande adresser som fallback.
