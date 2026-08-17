-- AI-classified ticket category (Phase 3 of the reports plan).
ALTER TABLE "Ticket" ADD COLUMN "category" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_tenantId_category_idx" ON "Ticket"("tenantId", "category");
