-- Add display form for API keys. Existing plaintext keys are hashed lazily
-- on first use (see lib/api-auth.ts validateApiKey).
ALTER TABLE "ApiKey" ADD COLUMN "maskedKey" TEXT;
