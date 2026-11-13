import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Role, EnrollmentStatus } from '@prisma/client';
import { RubricsService } from '../src/rubrics/rubrics.service';
import { QuizzesService } from '../src/lms/quizzes.service';
import { CoursesService } from '../src/courses/courses.service';
import { AuthService } from '../src/auth/auth.service';
import { GamificationService } from '../src/gamification/gamification.service';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';

/**
 * Regression tests for authorization holes that let one user act on another
 * user's data. Each drives the real service with a Prisma double, so a future
 * refactor that drops a guard fails here rather than in production.
 */

const audit = { logAction: async () => {} } as never;
const gamification = { addPoints: async () => {} } as never;

describe('SECURITY: peer review cannot cross submissions or bypass self-review', () => {
    const build = (over: {
        rubricTaskId?: string;
        submissionTaskId?: string;
        ownerId?: string;
        ownerStatus?: EnrollmentStatus;
        reviewerEnrolled?: boolean;
        criteria?: { id: string; maxScore: number }[];
    } = {}) => {
        let createdData: any;
        const prisma = {
            rubric: { findUnique: async () => ({ id: 'r1', taskId: over.rubricTaskId ?? 'task-1' }) },
            taskSubmission: {
                findUnique: async () => ({
                    id: 'sub-1',
                    taskId: over.submissionTaskId ?? 'task-1',
                    enrollment: {
                        studentId: over.ownerId ?? 'student-b',
                        courseId: 'course-1',
                        status: over.ownerStatus ?? EnrollmentStatus.APPROVED,
                    },
                }),
            },
            enrollment: {
                findFirst: async () => (over.reviewerEnrolled === false ? null : { id: 'e-reviewer' }),
            },
            rubricCriterion: {
                findMany: async () => over.criteria ?? [{ id: 'c1', maxScore: 10 }, { id: 'c2', maxScore: 5 }],
            },
            peerReview: {
                findUnique: async () => null,
                create: async (args: any) => { createdData = args.data; return args.data; },
            },
        };
        const courses = {
            assertCanManageOpening: async () => ({ id: 'opening-1' }),
        };
        const svc = new RubricsService(prisma as never, audit, gamification, courses as never);
        return { svc, created: () => createdData };
    };

    const scores = [{ criterionId: 'c1', score: 5 }];

    test('rejects a submission that belongs to a different task', async () => {
        // The core IDOR: any submission id in the platform, any rubric id.
        const { svc } = build({ submissionTaskId: 'task-OTHER' });
        await assert.rejects(
            () => svc.submitReview('r1', 'sub-1', 'student-a', { scores }),
            /Submission not found for this task/,
        );
    });

    test('rejects self-review: enrollment.studentId is a User.id, not an Enrollment.id', async () => {
        // The old guard compared submission.enrollmentId (Enrollment.id) with
        // reviewerId (User.id). Different tables, so it never fired.
        const { svc } = build({ ownerId: 'student-a' });
        await assert.rejects(
            () => svc.submitReview('r1', 'sub-1', 'student-a', { scores }),
            (err: unknown) => err instanceof ForbiddenException && /your own submission/i.test(err.message),
        );
    });

    test('rejects a submission whose enrolment is not approved', async () => {
        const { svc } = build({ ownerStatus: EnrollmentStatus.REVOKED });
        await assert.rejects(
            () => svc.submitReview('r1', 'sub-1', 'student-a', { scores }),
            /Only approved students/,
        );
    });

    test('rejects a reviewer who is not approved-enrolled in the same course', async () => {
        const { svc } = build({ reviewerEnrolled: false });
        await assert.rejects(
            () => svc.submitReview('r1', 'sub-1', 'outsider', { scores }),
            /Not enrolled in this course/,
        );
    });

    test('clamps a score above the criterion maximum', async () => {
        const { svc, created } = build();
        const review: any = await svc.submitReview('r1', 'sub-1', 'student-a', {
            scores: [{ criterionId: 'c1', score: 9999 }],
        });
        assert.equal(review.score, 10, 'must clamp to maxScore');
        assert.equal(created().criterionScores.create[0].score, 10, 'the stored row is clamped too');
    });

    test('clamps a negative score to zero', async () => {
        const { svc } = build();
        const review: any = await svc.submitReview('r1', 'sub-1', 'student-a', {
            scores: [{ criterionId: 'c1', score: -50 }],
        });
        assert.equal(review.score, 0);
    });

    test('rejects a criterion that is not part of the rubric', async () => {
        const { svc } = build();
        await assert.rejects(
            () => svc.submitReview('r1', 'sub-1', 'student-a', {
                scores: [{ criterionId: 'criterion-from-another-rubric', score: 10 }],
            }),
            /Unknown criterion/,
        );
    });
});

describe('SECURITY: reading reviews requires standing on the submission', () => {
    const build = (over: { ownerId?: string; courseId?: string; teaches?: boolean } = {}) => {
        const prisma = {
            taskSubmission: {
                findUnique: async () => ({
                    id: 'sub-1',
                    enrollment: { studentId: over.ownerId ?? 'student-b', courseId: over.courseId ?? 'course-1' },
                task: { openingId: 'opening-1' },
            }),
            },
            courseOpening: { findFirst: async () => (over.teaches ? { id: 'o1' } : null) },
            peerReview: { findMany: async () => [{ id: 'pr1', commentAr: 'feedback' }] },
        };
        const courses = {
            assertCanManageOpening: async () => {
                if (!over.teaches) throw new ForbiddenException('Not your opening');
                return { id: 'opening-1' };
            },
        };
        const svc = new RubricsService(prisma as never, audit, gamification, courses as never);
        return svc;
    };

    test('a random authenticated student cannot read another student reviews', async () => {
        // Reviews carry reviewer emails and free-text comments; iterating
        // submission ids used to read anyone's feedback.
        const svc = build();
        await assert.rejects(
            () => svc.getReviewsForSubmission('sub-1', 'outsider', Role.STUDENT),
            (err: unknown) => err instanceof ForbiddenException,
        );
    });

    test('the owner can read their own', async () => {
        const svc = build({ ownerId: 'student-b' });
        const out: any = await svc.getReviewsForSubmission('sub-1', 'student-b', Role.STUDENT);
        assert.equal(out.count, 1);
        assert.equal(out.reviews[0].commentAr, 'feedback');
    });

    test('an instructor of that course can read', async () => {
        const svc = build({ teaches: true });
        await svc.getReviewsForSubmission('sub-1', 'instructor-x', Role.INSTRUCTOR);
    });

    test('an instructor from another course cannot', async () => {
        const svc = build({ teaches: false });
        await assert.rejects(
            () => svc.getReviewsForSubmission('sub-1', 'instructor-elsewhere', Role.INSTRUCTOR),
            (err: unknown) => err instanceof ForbiddenException,
        );
    });

    test('ADMIN keeps oversight', async () => {
        const svc = build({ teaches: false });
        await svc.getReviewsForSubmission('sub-1', 'admin', Role.ADMIN);
    });
});

describe('SECURITY: quiz answers are never handed back', () => {
    const build = () => {
        let created: any;
        const quizAttempt = {
            count: async () => 0,
            create: async (args: any) => {
                created = args;
                return { id: 'a1', ...args.data };
            },
        };
        const quizAttemptGrant = {
            findUnique: async () => null,
        };
        const prisma = {
            quiz: {
                findUnique: async () => ({
                    id: 'q1',
                    isPublished: true,
                    passScore: 70,
                    maxAttempts: 1,
                    moduleId: null,
                    courseId: 'course-1',
                    questions: [
                        { id: 'q1a', orderIndex: 0, correctIndex: 2, options: ['a', 'b', 'c', 'd'] },
                        { id: 'q1b', orderIndex: 1, options: [{ text: 'x', isCorrect: true }, { text: 'y' }] },
                    ],
                }),
            },
            enrollment: {
                findUnique: async () => ({ id: 'e1', studentId: 'student-a', courseId: 'course-1' }),
            },
            quizAttempt,
            quizAttemptGrant,
            $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({ quizAttempt, quizAttemptGrant }),
        };
        const svc = new QuizzesService(prisma as never, gamification);
        return { svc, created: () => created };
    };

    test('the per-question breakdown has no correctAnswer', async () => {
        // Submit nonsense, read the key, resubmit for a perfect score.
        const { svc } = build();
        const out: any = await svc.attempt('q1', 'e1', [
            { questionId: 'q1a', selected: [0] },
            { questionId: 'q1b', selected: [1] },
        ], 'student-a');
        const json = JSON.stringify(out.details);
        assert.ok(!json.includes('correctAnswer'), 'the key must not be in the response');
        for (const d of out.details) {
            assert.ok('isCorrect' in d, 'per-question feedback is still allowed');
        }
    });

    test('grading itself is unaffected: isCorrect still computed', async () => {
        const { svc } = build();
        const right: any = await svc.attempt('q1', 'e1', [
            { questionId: 'q1a', selected: [2] },
            { questionId: 'q1b', selected: [0] },
        ], 'student-a');
        assert.equal(right.score, 100, 'a correct submission still scores 100');
        assert.equal(right.passed, true);
    });

    test('the public quiz payload strips options[].isCorrect as well as correctIndex', async () => {
        // GET /lms/quizzes/:id is public, and parseCorrectIndices reads both
        // shapes, so stripping only correctIndex left the key in the payload.
        const { svc } = build();
        const quiz: any = await svc.getPublic('q1');
        const json = JSON.stringify(quiz);
        assert.ok(!json.includes('correctIndex'), 'correctIndex must be stripped');
        assert.ok(!/"isCorrect"/.test(json), 'options[].isCorrect must be stripped');
        assert.ok(json.includes('"options"'), 'the options themselves stay public');
    });
});

describe('SECURITY: openings are only writable by someone who manages them', () => {
    const build = () => {
        const updates: any[] = [];
        const notified: any[] = [];
        const prisma = {
            courseOpening: {
                findUnique: async () => ({
                    id: 'o1',
                    instructorId: 'instructor-owner',
                    courseId: 'course-1',
                    status: 'DRAFT',
                }),
                update: async (a: any) => { updates.push(a); return { id: 'o1' }; },
                findMany: async () => [],
                updateMany: async () => ({ count: 0 }),
            },
            user: { findUnique: async () => ({ id: 'instructor-x' }) },
            wishlist: { findMany: async () => [{ userId: 'watcher-1' }] },
            reservation: { updateMany: async () => ({ count: 0 }) },
            enrollment: { findMany: async () => [] },
        };
        const notifications = { notify: async (n: any) => { notified.push(n); } };
        const svc = new CoursesService(prisma as never, audit, {} as never, notifications as never);
        return { svc, updates, notified };
    };

    test('a different instructor cannot edit the batch', async () => {
        // The IDOR: rewrite instructorId, price, dates and capacity of a batch
        // that is not yours, and take its roster with it.
        const { svc } = build();
        await assert.rejects(
            () => svc.updateOpening('o1', { price: '1' } as any, 'instructor-attacker', Role.INSTRUCTOR),
            (err: unknown) => err instanceof ForbiddenException,
        );
    });

    test('a different instructor cannot publish the batch', async () => {
        // Publishing emails every wishlist user and flips PENDING reservations
        // to "payment due".
        const { svc, notified } = build();
        await assert.rejects(
            () => svc.setOpeningPublished('o1', true, 'instructor-attacker', Role.INSTRUCTOR),
            (err: unknown) => err instanceof ForbiddenException,
        );
        assert.equal(notified.length, 0, 'nobody may be notified of a hijacked publish');
    });

    test('the owning instructor still can edit', async () => {
        const { svc, updates } = build();
        await svc.updateOpening('o1', { nameAr: 'اسمي' } as any, 'instructor-owner', Role.INSTRUCTOR);
        assert.equal(updates.length, 1, 'the legitimate write still lands');
    });

    test('ADMIN and COURSE_MANAGER keep their override', async () => {
        for (const role of [Role.ADMIN, Role.COURSE_MANAGER]) {
            const { svc } = build();
            await svc.updateOpening('o1', { maxStudents: 10 } as any, 'anyone', role);
        }
    });
});

describe('SECURITY: login does not disclose that an account exists', () => {
    const build = (user: any) => {
        const prisma = {
            user: { findUnique: async () => user },
            refreshToken: { create: async () => ({}) },
        };
        const svc = new AuthService(
            prisma as never,
            { sign: () => 'tok' } as never,
            { sendPasswordReset: async () => {} } as never,
            { } as never,
            { invalidate: async () => {} } as never,
        );
        return svc;
    };

    const inactive = { id: 'u1', email: 'a@b.test', passwordHash: 'x', isActive: false, role: Role.STUDENT };

    test('a suspended account is indistinguishable from an unknown address', async () => {
        // A distinct Forbidden('Account is suspended') — thrown before the
        // bcrypt comparison, so also the fast path — confirmed that an address
        // was registered and that it was disabled.
        await assert.rejects(
            () => build(inactive).login({ email: 'a@b.test', password: 'anything' } as any),
            (err: unknown) =>
                err instanceof UnauthorizedException && /invalid credentials/i.test(err.message),
        );
    });

    test('an unknown address gets the identical error', async () => {
        await assert.rejects(
            () => build(null).login({ email: 'nobody@b.test', password: 'anything' } as any),
            (err: unknown) =>
                err instanceof UnauthorizedException && /invalid credentials/i.test(err.message),
        );
    });
});

describe('SECURITY: gamification lookup is limited to the owner or an admin', () => {
    const build = (points: Record<string, unknown> | null) => {
        const prisma = {
            userPoints: {
                findUnique: async () => points,
                create: async () => points ?? { id: 'p0', userId: 'u0', points: 0, level: 1, streak: 0 },
            },
            userBadge: { findMany: async () => [] },
        };
        return new GamificationService(prisma as never);
    };

    test('a user may read their own gamification', async () => {
        const svc = build({ id: 'p1', userId: 'u1', points: 10, level: 1, streak: 0 });
        const out = await svc.getUserGamificationForViewer('u1', 'u1', Role.STUDENT);
        assert.equal(out.points, 10);
    });

    test('an admin may read another user gamification', async () => {
        const svc = build({ id: 'p2', userId: 'u2', points: 55, level: 1, streak: 3 });
        const out = await svc.getUserGamificationForViewer('u2', 'admin', Role.ADMIN);
        assert.equal(out.points, 55);
    });

    test('another student cannot read a stranger gamification', async () => {
        const svc = build(null);
        await assert.rejects(
            () => svc.getUserGamificationForViewer('u2', 'u1', Role.STUDENT),
            (err: unknown) => err instanceof ForbiddenException && /access denied/i.test(err.message),
        );
    });

    test('the lookup exposes no badge until one is actually earned', async () => {
        const svc = build({ id: 'p3', userId: 'u3', points: 0, level: 1, streak: 0 });
        const out = await svc.getUserGamificationForViewer('u3', 'u3', Role.STUDENT);
        assert.ok(Array.isArray(out.allBadges));
        assert.equal(out.allBadges.every((b: { earned: boolean }) => b.earned === false), true);
    });
});

describe('SECURITY: /enrollments/all can be narrowed to one student', () => {
    test('a studentId filter is passed through to the query', async () => {
        let where: unknown;
        const prisma = {
            enrollment: {
                findMany: async (args: any) => {
                    where = args.where;
                    return [];
                },
            },
        };
        const svc = new EnrollmentsService(prisma as never, { logAction: async () => {} } as never, { notify: async () => {} } as never, {} as never, {} as never);
        await svc.getAllEnrollments('student-9');
        assert.deepEqual(where, { studentId: 'student-9' });
    });

    test('omitting the filter keeps listing every enrollment', async () => {
        let where: unknown = 'unset';
        const prisma = {
            enrollment: {
                findMany: async (args: any) => {
                    where = args.where;
                    return [];
                },
            },
        };
        const svc = new EnrollmentsService(prisma as never, { logAction: async () => {} } as never, { notify: async () => {} } as never, {} as never, {} as never);
        await svc.getAllEnrollments();
        assert.equal(where, undefined);
    });
});
