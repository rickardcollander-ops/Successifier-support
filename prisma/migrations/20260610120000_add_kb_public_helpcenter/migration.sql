-- AlterTable: extend KnowledgeBase with public help-center fields
ALTER TABLE "KnowledgeBase" ADD COLUMN     "slug" TEXT;
ALTER TABLE "KnowledgeBase" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KnowledgeBase" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "KnowledgeBase" ADD COLUMN     "excerpt" TEXT;
ALTER TABLE "KnowledgeBase" ADD COLUMN     "relatedIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "KnowledgeBase" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KnowledgeBase" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KnowledgeBase" ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "excerpt" TEXT,
    "editedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "articleId" TEXT,
    "query" TEXT,
    "resultsCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeBase_tenantId_isPublic_status_idx" ON "KnowledgeBase"("tenantId", "isPublic", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCategory_tenantId_slug_key" ON "KnowledgeCategory"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "KnowledgeCategory_tenantId_idx" ON "KnowledgeCategory"("tenantId");

-- CreateIndex
CREATE INDEX "KnowledgeRevision_articleId_createdAt_idx" ON "KnowledgeRevision"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeEvent_tenantId_type_createdAt_idx" ON "KnowledgeEvent"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeEvent_articleId_idx" ON "KnowledgeEvent"("articleId");

-- Backfill slugs from titles. Appending the full (unique) id guarantees the
-- (tenantId, slug) uniqueness index below can never be violated by backfill.
UPDATE "KnowledgeBase"
SET "slug" = trim(both '-' from
  regexp_replace(
    regexp_replace(
      lower(translate("title", 'åäöÅÄÖéèü', 'aaoaaoeeu')),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-+', '-', 'g'
  )
) || '-' || "id"
WHERE "slug" IS NULL;

-- CreateIndex (after backfill so existing rows satisfy uniqueness)
CREATE UNIQUE INDEX "KnowledgeBase_tenantId_slug_key" ON "KnowledgeBase"("tenantId", "slug");

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KnowledgeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCategory" ADD CONSTRAINT "KnowledgeCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvent" ADD CONSTRAINT "KnowledgeEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search: generated tsvector column (Swedish config) + GIN index.
ALTER TABLE "KnowledgeBase"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('swedish', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''))
  ) STORED;

CREATE INDEX "KnowledgeBase_searchVector_idx" ON "KnowledgeBase" USING GIN ("searchVector");
