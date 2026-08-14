-- AlterTable
ALTER TABLE "ReportSettings" ADD COLUMN "slaFirstResponseHours" DOUBLE PRECISION,
ADD COLUMN "staffingOccupancy" DOUBLE PRECISION,
ADD COLUMN "staffingShrinkage" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "responseSeconds" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentWorkSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentEmail" TEXT NOT NULL,
    "agentName" TEXT,
    "ticketId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentWorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketEvent_tenantId_type_createdAt_idx" ON "TicketEvent"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentWorkSession_tenantId_agentEmail_lastSeenAt_idx" ON "AgentWorkSession"("tenantId", "agentEmail", "lastSeenAt");

-- CreateIndex
CREATE INDEX "AgentWorkSession_tenantId_startedAt_idx" ON "AgentWorkSession"("tenantId", "startedAt");

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentWorkSession" ADD CONSTRAINT "AgentWorkSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
