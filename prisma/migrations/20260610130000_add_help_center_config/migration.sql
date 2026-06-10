-- CreateTable
CREATE TABLE "HelpCenterConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accentColor" TEXT NOT NULL DEFAULT '#7C5CFF',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "logoUrl" TEXT,
    "headline" TEXT,
    "intro" TEXT,
    "layout" TEXT NOT NULL DEFAULT 'grid',
    "showSearch" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpCenterConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelpCenterConfig_tenantId_key" ON "HelpCenterConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "HelpCenterConfig" ADD CONSTRAINT "HelpCenterConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
