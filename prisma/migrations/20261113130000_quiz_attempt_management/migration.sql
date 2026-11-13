ALTER TABLE "Quiz"
ADD COLUMN "maxAttempts" INTEGER DEFAULT 1,
ADD COLUMN "gateNextLessons" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Quiz" SET "maxAttempts" = NULL;

DROP INDEX IF EXISTS "QuizAttempt_quizId_enrollmentId_key";

CREATE INDEX "QuizAttempt_quizId_enrollmentId_submittedAt_idx"
ON "QuizAttempt"("quizId", "enrollmentId", "submittedAt");

CREATE TABLE "QuizAttemptGrant" (
    "id" TEXT NOT NULL,
    "extraAttempts" INTEGER NOT NULL DEFAULT 0,
    "quizId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    CONSTRAINT "QuizAttemptGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuizAttemptGrant_quizId_enrollmentId_key"
ON "QuizAttemptGrant"("quizId", "enrollmentId");

ALTER TABLE "QuizAttemptGrant"
ADD CONSTRAINT "QuizAttemptGrant_quizId_fkey"
FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuizAttemptGrant"
ADD CONSTRAINT "QuizAttemptGrant_enrollmentId_fkey"
FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
