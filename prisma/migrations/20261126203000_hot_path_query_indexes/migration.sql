CREATE INDEX CONCURRENTLY IF NOT EXISTS "Course_instructorId_createdAt_idx"
    ON "Course"("instructorId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Enrollment_openingId_createdAt_idx"
    ON "Enrollment"("openingId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupportTicket_userId_idx"
    ON "SupportTicket"("userId");

DROP INDEX CONCURRENTLY IF EXISTS "Message_recipientId_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_recipientId_readAt_idx"
    ON "Message"("recipientId", "readAt");
