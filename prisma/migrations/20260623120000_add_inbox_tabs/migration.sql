-- CreateTable
CREATE TABLE "InboxTab" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxTab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxTab_tenantId_idx" ON "InboxTab"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxTab_tenantId_key_key" ON "InboxTab"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "InboxTab" ADD CONSTRAINT "InboxTab_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
