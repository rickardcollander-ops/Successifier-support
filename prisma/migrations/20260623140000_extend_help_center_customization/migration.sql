-- Extend HelpCenterConfig with more appearance options and chatbot controls
ALTER TABLE "HelpCenterConfig"
  ADD COLUMN "footerText" TEXT,
  ADD COLUMN "supportUrl" TEXT,
  ADD COLUMN "supportLabel" TEXT,
  ADD COLUMN "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "chatTitle" TEXT,
  ADD COLUMN "chatWelcome" TEXT,
  ADD COLUMN "chatPlaceholder" TEXT,
  ADD COLUMN "chatInstructions" TEXT,
  ADD COLUMN "chatFallback" TEXT,
  ADD COLUMN "chatSuggestions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
