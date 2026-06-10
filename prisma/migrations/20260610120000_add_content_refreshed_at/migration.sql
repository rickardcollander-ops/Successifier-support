-- Timestamp for content changes written via raw SQL (AI drafts, context
-- refresh) that intentionally do not bump "updatedAt". Used by the delta
-- ticket poll to detect changed rows.
ALTER TABLE "Ticket" ADD COLUMN "contentRefreshedAt" TIMESTAMP(3);

CREATE INDEX "Ticket_tenantId_updatedAt_idx" ON "Ticket"("tenantId", "updatedAt");
