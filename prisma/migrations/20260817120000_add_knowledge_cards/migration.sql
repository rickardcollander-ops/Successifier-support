-- Knowledge cards: a knowledge identity per recurring question, the sent
-- replies that confirm it, and the contradictions awaiting human review.
-- Replaces the one-article-per-sent-reply auto-learning that never merged
-- or reconciled anything.

-- CreateTable
CREATE TABLE "KnowledgeCard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "confirmedCount" INTEGER NOT NULL DEFAULT 1,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "curatedAt" TIMESTAMP(3),
    "curatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCardSource" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'confirmed',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCardSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCardConflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "currentAnswer" TEXT NOT NULL,
    "proposedAnswer" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolvedAnswer" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCardConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeCard_tenantId_status_idx" ON "KnowledgeCard"("tenantId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeCard_tenantId_lastConfirmedAt_idx" ON "KnowledgeCard"("tenantId", "lastConfirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCardSource_cardId_ticketId_key" ON "KnowledgeCardSource"("cardId", "ticketId");

-- CreateIndex
CREATE INDEX "KnowledgeCardSource_cardId_sentAt_idx" ON "KnowledgeCardSource"("cardId", "sentAt");

-- CreateIndex
CREATE INDEX "KnowledgeCardConflict_tenantId_status_createdAt_idx" ON "KnowledgeCardConflict"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeCardConflict_cardId_createdAt_idx" ON "KnowledgeCardConflict"("cardId", "createdAt");

-- AddForeignKey
ALTER TABLE "KnowledgeCard" ADD CONSTRAINT "KnowledgeCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCardSource" ADD CONSTRAINT "KnowledgeCardSource_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KnowledgeCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCardConflict" ADD CONSTRAINT "KnowledgeCardConflict_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCardConflict" ADD CONSTRAINT "KnowledgeCardConflict_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KnowledgeCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
