CREATE TABLE "GradeCategory" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "weightPercent" DOUBLE PRECISION NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "openingId" TEXT NOT NULL,
    CONSTRAINT "GradeCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GradebookItem" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "openingId" TEXT NOT NULL,
    "categoryId" TEXT,
    CONSTRAINT "GradebookItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GradeOverride" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "originalScore" DOUBLE PRECISION,
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    CONSTRAINT "GradeOverride_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GradeCategory_openingId_orderIndex_idx" ON "GradeCategory"("openingId", "orderIndex");
CREATE UNIQUE INDEX "GradebookItem_openingId_sourceType_sourceId_key" ON "GradebookItem"("openingId", "sourceType", "sourceId");
CREATE INDEX "GradebookItem_categoryId_idx" ON "GradebookItem"("categoryId");
CREATE UNIQUE INDEX "GradeOverride_enrollmentId_sourceType_sourceId_key" ON "GradeOverride"("enrollmentId", "sourceType", "sourceId");
CREATE INDEX "GradeOverride_sourceType_sourceId_idx" ON "GradeOverride"("sourceType", "sourceId");

ALTER TABLE "GradeCategory" ADD CONSTRAINT "GradeCategory_openingId_fkey"
    FOREIGN KEY ("openingId") REFERENCES "CourseOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GradebookItem" ADD CONSTRAINT "GradebookItem_openingId_fkey"
    FOREIGN KEY ("openingId") REFERENCES "CourseOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GradebookItem" ADD CONSTRAINT "GradebookItem_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "GradeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GradeOverride" ADD CONSTRAINT "GradeOverride_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
