-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "assignedTo" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "sentBy" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_tenantId_assignedTo_idx" ON "Ticket"("tenantId", "assignedTo");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_sentBy_idx" ON "Ticket"("tenantId", "sentBy");
