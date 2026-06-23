# Vercel Environment Variables Setup

## Kritiska Miljövariabler

Lägg till följande i Vercel Dashboard → Settings → Environment Variables:

### 1. Database
> ⚠️ Hämta de faktiska värdena från Neon-konsolen. Lägg ALDRIG riktiga
> lösenord i den här filen — den är committad i git. Databasen ska ligga i
> EU (t.ex. eu-central-1 Frankfurt) av GDPR-skäl.
```
DATABASE_URL=postgresql://neondb_owner:<DB_PASSWORD>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require
DATABASE_URL_UNPOOLED=postgresql://neondb_owner:<DB_PASSWORD>@<endpoint>.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

### 2. Security - Encryption Key ⚠️ KRITISK
> ⚠️ Hämta värdet ENBART från Vercel Environment Variables. Lägg ALDRIG den
> riktiga nyckeln i den här filen.
```
ENCRYPTION_KEY=<32-byte hex, finns i Vercel env>
```

**VIKTIGT:** Denna nyckel krypterar alla API-nycklar och integration credentials i databasen. Utan den kommer appen inte fungera. Om nyckeln roteras måste alla lagrade credentials krypteras om — gör inte det utan en migreringsplan.

### 3. NextAuth
```
NEXTAUTH_URL=https://doldadress.successifier.com
NEXTAUTH_SECRET=[generera med: openssl rand -base64 32]
AUTH_SECRET=[samma som NEXTAUTH_SECRET]
```

### 4. OpenAI
```
OPENAI_API_KEY=sk-...
```

### 5. Google OAuth
```
GOOGLE_CLIENT_ID=461289086029-7vbhlhcm56he55u1mm9gikalepfdlugt.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=[från Google Cloud Console]
GOOGLE_OAUTH_BASE_URL=https://doldadress.successifier.com
```

**VIKTIGT - Google Cloud Console Konfiguration:**

Gå till [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) och lägg till följande **Authorized redirect URIs** för OAuth 2.0 Client:

**Production:**
- `https://doldadress.successifier.com/api/auth/callback/google` (NextAuth sign-in)
- `https://doldadress.successifier.com/api/auth/gmail/callback` (Gmail account linking)

**Development (Lokal):**
- `http://localhost:3001/api/auth/callback/google`
- `http://localhost:3001/api/auth/gmail/callback`

Utan dessa redirect URIs kommer Gmail OAuth att misslyckas med "Safari kan inte ansluta till servern" eller liknande fel.

## Deployment Checklist

- [x] Kryptering implementerad för credentials
- [x] Befintliga credentials krypterade i databasen
- [x] ENCRYPTION_KEY tillagd i .env.local
- [ ] **ENCRYPTION_KEY tillagd i Vercel Environment Variables**
- [ ] Alla andra miljövariabler verifierade i Vercel
- [ ] Deploy och testa att integrations fungerar

## Säkerhetsnoteringar

1. **ENCRYPTION_KEY** är 64 hex-tecken (32 bytes) för AES-256-GCM kryptering
2. Credentials krypteras automatiskt vid sparande i Settings
3. Credentials dekrypteras automatiskt vid läsning
4. Gamla okrypterade credentials stöds fortfarande (fallback)
5. Migrations-script har kört och krypterat alla befintliga credentials

## Om du behöver rotera ENCRYPTION_KEY

1. Generera ny nyckel: `openssl rand -hex 32`
2. Dekryptera alla credentials med gamla nyckeln
3. Uppdatera ENCRYPTION_KEY
4. Kryptera om alla credentials med nya nyckeln
5. Använd `scripts/encrypt-existing-credentials.cjs` för bulk-uppdatering
