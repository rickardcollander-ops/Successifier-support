-- CreateTable
CREATE TABLE "ReportSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentHourlyCost" DOUBLE PRECISION,
    "baselineResponseHours" DOUBLE PRECISION,
    "baselineHandlingMinutes" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSettings_tenantId_key" ON "ReportSettings"("tenantId");

-- AddForeignKey
ALTER TABLE "ReportSettings" ADD CONSTRAINT "ReportSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
