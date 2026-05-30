# Lägga till en ny produkt (multi-product-upplägg)

Det här systemet kör **en kodbas** för flera produkter (Doldadress, Serus, …).
All logik delas — en gemensam fix slår automatiskt på alla produkter nästa
gång de deployas. Det som får skilja sig per produkt ligger samlat i
`lib/products/`.

## Hur det hänger ihop

- **En deploy + en databas per produkt.** Varje produkt är en egen tenant och
  körs som ett eget Vercel-projekt mot en egen Neon-databas. Deployen "pinnas"
  till sin produkt med miljövariabeln `PRODUCT` (och `NEXT_PUBLIC_PRODUCT` för
  klientsidan). Det ger garanterad dataisolering mellan varumärkena (GDPR).
- **Delad kod.** Samma repo/branch bygger båda produkterna. Ändrar du logik en
  gång får alla produkter den vid nästa deploy.
- **Per-produkt-anpassning.** Namn, signaturer, AI-promptens varumärke,
  tillåtna inloggningsdomäner och autosvar bor i en config-fil per produkt:
  `lib/products/<produkt>.ts`. Integrationer (Stripe, Billecta, Resend, Gmail)
  lagras krypterat per tenant i databasen och sätts via Inställningar-vyn.

```
lib/products/
  types.ts        # ProductConfig-typen (delad)
  index.ts        # väljer aktiv produkt via PRODUCT-env, registret över produkter
  tenant.ts       # server-only: getTenant() / getTenantId() (slår upp tenant-raden)
  doldadress.ts   # Doldadress config
  serus.ts        # Serus config  ← fyll i riktiga värden
```

## Steg för att lägga till en produkt

Exemplet använder Serus, som redan är scaffoldad i `lib/products/serus.ts`.

1. **Config-fil.** Skapa `lib/products/<produkt>.ts` (kopiera `serus.ts`) och
   registrera den i `lib/products/index.ts` i `PRODUCTS`-objektet. Fyll i:
   - `displayName`, `brandName`, `supportName`, `fromName`
   - `allowedDomains` — domän(er) som agenterna loggar in med
   - `agents`, `agentSignatures`, `agentColors` — supportteamet
   - `confirmation` — texten i autosvaret

2. **Databas.** Skapa en ny Neon-databas och kör migrationerna:
   ```bash
   DATABASE_URL="<nya-db-url>" npx prisma migrate deploy
   ```

3. **Seed:a tenant-raden.** Skapa tenanten med `id` = `subdomain` = produktnyckeln
   (samma konvention som Doldadress, så ev. id-baserad kod fortsätter funka):
   ```sql
   INSERT INTO "Tenant" (id, subdomain, name, "createdAt", "updatedAt")
   VALUES ('serus', 'serus', 'Serus', now(), now());
   ```

4. **Vercel-projekt.** Skapa ett nytt Vercel-projekt från **samma repo/branch**
   och sätt miljövariabler (egna per produkt):
   ```
   PRODUCT=serus
   NEXT_PUBLIC_PRODUCT=serus
   DATABASE_URL=...                 # den nya databasen
   ENCRYPTION_KEY=...               # egen nyckel
   NEXTAUTH_URL=https://...         # produktens domän
   NEXTAUTH_SECRET=...  AUTH_SECRET=...
   GOOGLE_OAUTH_BASE_URL=https://... # produktens domän
   GOOGLE_CLIENT_ID=...  GOOGLE_CLIENT_SECRET=...
   ANTHROPIC_API_KEY=...
   RESEND_API_KEY=...  RESEND_FROM_EMAIL=support@...
   # + ev. STRIPE/BILLECTA/RETOOL
   ```

5. **Integrationer.** Logga in i den nya deployen och lägg in integrationerna
   under Inställningar (sparas krypterat på tenanten).

6. **Verifiera.** `PRODUCT` styr branding, tillåtna domäner, AI-prompt och vilken
   tenant all data hör till. Sätt fel värde och appen pekar mot fel databas/tenant.

## Att tänka på

- `PRODUCT` och `NEXT_PUBLIC_PRODUCT` ska alltid vara samma värde.
- Är produkten okänd (ingen config) faller appen tillbaka på `doldadress` och
  loggar en varning.
- Lokalt: sätt variablerna i `.env.local` (default är `doldadress` om de saknas).
