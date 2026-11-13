CREATE TYPE "CourseEvaluationQuestionType" AS ENUM (
    'RATING',
    'SINGLE_CHOICE',
    'MULTIPLE_CHOICE',
    'TEXT',
    'YES_NO'
);

CREATE TYPE "CourseEvaluationMetric" AS ENUM (
    'COURSE',
    'INSTRUCTOR',
    'GENERAL'
);

ALTER TABLE "CourseEvaluation"
    ALTER COLUMN "courseRating" DROP NOT NULL,
    ALTER COLUMN "instructorRating" DROP NOT NULL,
    ADD COLUMN "answers" JSONB,
    ADD COLUMN "formId" TEXT;

CREATE TABLE "CourseEvaluationForm" (
    "id" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "courseId" TEXT NOT NULL,
    CONSTRAINT "CourseEvaluationForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseEvaluationQuestion" (
    "id" TEXT NOT NULL,
    "promptAr" TEXT NOT NULL,
    "promptEn" TEXT NOT NULL,
    "type" "CourseEvaluationQuestionType" NOT NULL,
    "metric" "CourseEvaluationMetric" NOT NULL DEFAULT 'GENERAL',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "formId" TEXT NOT NULL,
    CONSTRAINT "CourseEvaluationQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseEvaluationForm_courseId_key" ON "CourseEvaluationForm"("courseId");
CREATE INDEX "CourseEvaluationQuestion_formId_orderIndex_idx" ON "CourseEvaluationQuestion"("formId", "orderIndex");
CREATE INDEX "CourseEvaluation_formId_createdAt_idx" ON "CourseEvaluation"("formId", "createdAt");

ALTER TABLE "CourseEvaluationForm"
    ADD CONSTRAINT "CourseEvaluationForm_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseEvaluationQuestion"
    ADD CONSTRAINT "CourseEvaluationQuestion_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "CourseEvaluationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseEvaluation"
    ADD CONSTRAINT "CourseEvaluation_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "CourseEvaluationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CourseEvaluationForm" (
    "id", "titleAr", "titleEn", "descriptionAr", "descriptionEn", "updatedAt", "courseId"
)
SELECT
    'default-course-evaluation-' || "id",
    'تقييم الدورة والمدرّب',
    'Course and instructor evaluation',
    'يساعدنا رأيك على تحسين محتوى الدورة وتجربة التعلّم.',
    'Your feedback helps us improve the course content and learning experience.',
    CURRENT_TIMESTAMP,
    "id"
FROM "Course";

INSERT INTO "CourseEvaluationQuestion" (
    "id", "promptAr", "promptEn", "type", "metric", "isRequired", "orderIndex", "formId", "updatedAt"
)
SELECT
    'default-course-rating-' || "courseId",
    'كيف تقيّم محتوى الدورة؟',
    'How would you rate the course content?',
    'RATING',
    'COURSE',
    true,
    0,
    "id",
    CURRENT_TIMESTAMP
FROM "CourseEvaluationForm";

INSERT INTO "CourseEvaluationQuestion" (
    "id", "promptAr", "promptEn", "type", "metric", "isRequired", "orderIndex", "formId", "updatedAt"
)
SELECT
    'default-instructor-rating-' || "courseId",
    'كيف تقيّم أداء المدرّب؟',
    'How would you rate the instructor?',
    'RATING',
    'INSTRUCTOR',
    true,
    1,
    "id",
    CURRENT_TIMESTAMP
FROM "CourseEvaluationForm";

INSERT INTO "CourseEvaluationQuestion" (
    "id", "promptAr", "promptEn", "type", "metric", "isRequired", "orderIndex", "formId", "updatedAt"
)
SELECT
    'default-course-comment-' || "courseId",
    'ما اقتراحك لتحسين الدورة؟',
    'What would you suggest to improve this course?',
    'TEXT',
    'GENERAL',
    false,
    2,
    "id",
    CURRENT_TIMESTAMP
FROM "CourseEvaluationForm";

UPDATE "CourseEvaluation" AS evaluation
SET "formId" = form."id",
    "answers" = jsonb_build_array(
        jsonb_build_object(
            'questionId', 'legacy-course-rating',
            'promptAr', 'كيف تقيّم محتوى الدورة؟',
            'promptEn', 'How would you rate the course content?',
            'type', 'RATING',
            'metric', 'COURSE',
            'value', evaluation."courseRating"
        ),
        jsonb_build_object(
            'questionId', 'legacy-instructor-rating',
            'promptAr', 'كيف تقيّم أداء المدرّب؟',
            'promptEn', 'How would you rate the instructor?',
            'type', 'RATING',
            'metric', 'INSTRUCTOR',
            'value', evaluation."instructorRating"
        ),
        jsonb_build_object(
            'questionId', 'legacy-course-comment',
            'promptAr', 'ملاحظات إضافية',
            'promptEn', 'Additional comments',
            'type', 'TEXT',
            'metric', 'GENERAL',
            'value', COALESCE(evaluation."commentAr", evaluation."commentEn", '')
        )
    )
FROM "CourseEvaluationForm" AS form
WHERE form."courseId" = evaluation."courseId";
