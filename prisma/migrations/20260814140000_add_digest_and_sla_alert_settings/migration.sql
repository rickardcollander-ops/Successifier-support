-- Scheduled report digest + SLA alert settings (Phase 2 of the reports plan).
ALTER TABLE "ReportSettings"
ADD COLUMN "digestFrequency" TEXT,
ADD COLUMN "digestRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "slaAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "alertRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "digestLastSentAt" TIMESTAMP(3);
