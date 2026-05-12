-- CreateTable
CREATE TABLE "BlockedSender" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedSender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedSender_tenantId_pattern_key" ON "BlockedSender"("tenantId", "pattern");

-- CreateIndex
CREATE INDEX "BlockedSender_tenantId_idx" ON "BlockedSender"("tenantId");

-- AddForeignKey
ALTER TABLE "BlockedSender" ADD CONSTRAINT "BlockedSender_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
