-- One-click CSAT ratings + per-tenant toggle (Phase 4 of the reports plan).
ALTER TABLE "ReportSettings" ADD COLUMN "csatEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CsatResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsatResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CsatResponse_ticketId_key" ON "CsatResponse"("ticketId");
CREATE INDEX "CsatResponse_tenantId_createdAt_idx" ON "CsatResponse"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
