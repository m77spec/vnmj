import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LessonsService } from '../src/lms/lessons.service';

/**
 * Completion gate for a lesson that carries required work.
 *
 * `markComplete` wrote `LessonProgress` unconditionally, so a module with an
 * assignment or a quiz in it could be claimed without submitting anything, and
 * hitting 100% paid out the `course_complete` points. A disabled button in the
 * player is not a gate — this service is the only writer of that row — so these
 * drive the real service against a recording double and assert both halves of
 * the contract: the refusal when work is owed, and the write when it is not.
 */

type Rec = { model: string; op: string; args: any };

function makeHarness(h: {
    enrollment?: any;
    modules?: any[];
    tasks?: { moduleId: string | null; submissions: any[] }[];
    quizzes?: {
        id?: string;
        moduleId: string | null;
        titleAr?: string;
        titleEn?: string;
        gateNextLessons?: boolean;
        attempts: { passed: boolean }[];
    }[];
    enrolled?: boolean;
    contentType?: string;
    progress?: { moduleId: string; completedAt: Date | null }[];
    evaluation?: { id: string } | null;
}) {
    const calls: Rec[] = [];
    const awarded: string[] = [];
    let upserted: any = null;

    const prisma: any = {
        course: {
            findUnique: async (args: any) => {
                calls.push({ model: 'course', op: 'findUnique', args });
                return { contentType: h.contentType ?? 'LIVE' };
            },
        },
        courseOpening: {
            findUnique: async () => null,
        },
        enrollment: {
            findUnique: async (args: any) => {
                calls.push({ model: 'enrollment', op: 'findUnique', args });
                if (h.enrolled === false) return null;
                return h.enrollment ?? {
                    id: 'enr-1',
                    studentId: 'stu-1',
                    courseId: 'crs-1',
                    openingId: 'opn-1',
                    status: 'APPROVED',
                };
            },
        },
        module: {
            findMany: async (args: any) => {
                calls.push({ model: 'module', op: 'findMany', args });
                return h.modules ?? [];
            },
            findUnique: async (args: any) => {
                calls.push({ model: 'module', op: 'findUnique', args });
                return (h.modules ?? []).find((m) => m.id === args.where.id) ?? null;
            },
        },
        courseTask: {
            findMany: async (args: any) => {
                calls.push({ model: 'courseTask', op: 'findMany', args });
                return h.tasks ?? [];
            },
        },
        quiz: {
            findMany: async (args: any) => {
                calls.push({ model: 'quiz', op: 'findMany', args });
                return h.quizzes ?? [];
            },
        },
        lessonProgress: {
            findMany: async (args: any) => {
                calls.push({ model: 'lessonProgress', op: 'findMany', args });
                return h.progress ?? [];
            },
            upsert: async (args: any) => {
                calls.push({ model: 'lessonProgress', op: 'upsert', args });
                upserted = args;
                // Mirror the write so a second call in the same test sees it.
                if (!h.progress) h.progress = [];
                if (args.create && !h.progress.some((p) => p.moduleId === args.create.moduleId)) {
                    h.progress.push({ moduleId: args.create.moduleId, completedAt: new Date() });
                }
                return args;
            },
            deleteMany: async (args: any) => {
                calls.push({ model: 'lessonProgress', op: 'deleteMany', args });
                return { count: 1 };
            },
        },
        courseEvaluation: {
            findUnique: async (args: any) => {
                calls.push({ model: 'courseEvaluation', op: 'findUnique', args });
                return h.evaluation ?? null;
            },
        },
    };

    const gamification: any = {
        addPoints: async (_userId: string, reason: string) => {
            awarded.push(reason);
        },
    };
    const service = new LessonsService(prisma, gamification);
    return { service, calls, awarded, get upserted() { return upserted; } };
}

const module1 = { id: 'mod-1', courseId: 'crs-1', titleAr: 'درس', titleEn: 'Lesson', orderIndex: 1 };
const module2 = { id: 'mod-2', courseId: 'crs-1', titleAr: 'الدرس التالي', titleEn: 'Next lesson', orderIndex: 2 };

describe('lesson completion gate', () => {
    test('refuses completion while the lesson has an unsubmitted assignment', async () => {
        const h = makeHarness({
            modules: [module1],
            tasks: [{ moduleId: 'mod-1', submissions: [] }],
        });

        await assert.rejects(
            () => h.service.markComplete('enr-1', 'mod-1', 'stu-1'),
            (err: any) => {
                assert.equal(err.getStatus?.(), 409);
                assert.equal(err.response?.code, 'LESSON_REQUIREMENTS_PENDING');
                assert.equal(err.response?.pendingTasks, 1);
                assert.equal(err.response?.failedQuizzes, 0);
                return true;
            },
        );

        // The whole point: no progress row may be written.
        assert.equal(h.upserted, null, 'LessonProgress was written despite owed work');
    });

    test('refuses completion while a published quiz in the lesson is unpassed', async () => {
        const h = makeHarness({
            modules: [module1],
            quizzes: [{ moduleId: 'mod-1', attempts: [{ passed: false }] }],
        });

        await assert.rejects(
            () => h.service.markComplete('enr-1', 'mod-1', 'stu-1'),
            (err: any) => {
                assert.equal(err.getStatus?.(), 409);
                assert.equal(err.response?.failedQuizzes, 1);
                return true;
            },
        );
        assert.equal(h.upserted, null);
    });

    test('a passed attempt clears the quiz block', async () => {
        const h = makeHarness({
            modules: [module1],
            quizzes: [{ moduleId: 'mod-1', attempts: [{ passed: false }, { passed: true }] }],
        });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.ok(h.upserted, 'expected the progress row to be written');
        assert.equal(h.upserted.create.moduleId, 'mod-1');
    });

    test('an existing submission clears the assignment block', async () => {
        const h = makeHarness({
            modules: [module1],
            tasks: [{ moduleId: 'mod-1', submissions: [{ id: 'sub-1' }] }],
        });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.ok(h.upserted, 'expected the progress row to be written');
    });

    test('a lesson with no tasks or quizzes completes normally', async () => {
        const h = makeHarness({ modules: [module1], tasks: [], quizzes: [] });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.ok(h.upserted);
    });

    test('work owed in a different lesson does not block this one', async () => {
        const h = makeHarness({
            modules: [module1],
            tasks: [{ moduleId: 'mod-OTHER', submissions: [] }],
            quizzes: [{ moduleId: 'mod-OTHER', attempts: [] }],
        });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.ok(h.upserted, 'a sibling module’s work must not block this one');
    });

    test('an unpassed gated quiz blocks completion of every subsequent lesson', async () => {
        const h = makeHarness({
            modules: [module1, module2],
            quizzes: [{
                id: 'quiz-1',
                moduleId: 'mod-1',
                titleAr: 'اختبار الدرس',
                titleEn: 'Lesson quiz',
                gateNextLessons: true,
                attempts: [],
            }],
        });

        await assert.rejects(
            () => h.service.markComplete('enr-1', 'mod-2', 'stu-1'),
            (err: any) => {
                assert.equal(err.getStatus?.(), 409);
                assert.equal(err.response?.code, 'LESSON_LOCKED_BY_QUIZ');
                assert.equal(err.response?.quizId, 'quiz-1');
                return true;
            },
        );
        assert.equal(h.upserted, null);
    });

    test('passing a gated quiz unlocks the following lesson', async () => {
        const h = makeHarness({
            modules: [module1, module2],
            quizzes: [{
                id: 'quiz-1',
                moduleId: 'mod-1',
                titleAr: 'اختبار الدرس',
                titleEn: 'Lesson quiz',
                gateNextLessons: true,
                attempts: [{ passed: true }],
            }],
        });

        await h.service.markComplete('enr-1', 'mod-2', 'stu-1');
        assert.ok(h.upserted, 'the following lesson should unlock after a pass');
        assert.equal(h.upserted.create.moduleId, 'mod-2');
    });

    test('assignments are scoped to the enrollment opening, and only published quizzes count', async () => {
        const h = makeHarness({ modules: [module1] });
        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');

        const taskQuery = h.calls.find((c) => c.model === 'courseTask');
        assert.ok(taskQuery, 'expected the assignment check to be scoped to the opening');
        assert.equal(taskQuery.args.where.openingId, 'opn-1');

        const quizQuery = h.calls.find((c) => c.model === 'quiz');
        assert.ok(quizQuery, 'expected the quiz check to be scoped to the course');
        assert.equal(quizQuery.args.where.isPublished, true);
        assert.equal(quizQuery.args.where.courseId, 'crs-1');
    });

    test('a legacy enrollment with no opening does not inherit every opening’s assignments', async () => {
        const h = makeHarness({
            modules: [module1],
            enrollment: { id: 'enr-1', studentId: 'stu-1', courseId: 'crs-1', openingId: null, status: 'APPROVED' },
        });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.equal(
            h.calls.find((c) => c.model === 'courseTask'),
            undefined,
            'must not guess which opening a NULL openingId meant',
        );
        assert.ok(h.upserted);
    });

    test('progress reports the outstanding work so the player can explain the block', async () => {
        const h = makeHarness({
            modules: [module1],
            tasks: [{ moduleId: 'mod-1', submissions: [] }],
            quizzes: [{ moduleId: 'mod-1', attempts: [{ passed: true }] }],
        });

        const p: any = await h.service.courseProgress('crs-1', 'stu-1');
        assert.equal(p.modules[0].pendingTasks, 1);
        assert.equal(p.modules[0].failedQuizzes, 0);
        assert.equal(p.modules[0].canComplete, false);
    });

    test('a clear lesson is marked canComplete', async () => {
        const h = makeHarness({ modules: [module1] });
        const p: any = await h.service.courseProgress('crs-1', 'stu-1');
        assert.equal(p.modules[0].canComplete, true);
    });

    test('someone else’s enrollment is refused before any check runs', async () => {
        const h = makeHarness({ modules: [module1], tasks: [{ moduleId: 'mod-1', submissions: [] }] });
        await assert.rejects(() => h.service.markComplete('enr-1', 'mod-1', 'someone-else'));
        assert.equal(h.upserted, null);
    });
});

/**
 * Points are paid for the transition, not for the request.
 *
 * `markComplete` awarded `lesson_complete` on every call and `course_complete`
 * on every call made while the course sat at 100%. Both routes are unauthenticated
 * by anything but "you own this enrollment", so re-posting one completion farmed
 * an unbounded score and pinned the leaderboard. The service is the only place
 * that knows whether the lesson just became complete, so that is where the award
 * belongs.
 */
describe('completion points are awarded once per transition', () => {
    // Two modules, so completing one is not also the end of the course and the
    // `course_complete` award stays out of these assertions.
    const mod1 = { id: 'mod-1', courseId: 'crs-1', titleAr: 'درس', titleEn: 'Lesson' };
    const mod2 = { id: 'mod-2', courseId: 'crs-1', titleAr: 'درس ٢', titleEn: 'Lesson 2' };

    test('the first completion pays lesson_complete', async () => {
        const h = makeHarness({ modules: [mod1, mod2], tasks: [], quizzes: [] });
        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.deepEqual(h.awarded, ['lesson_complete']);
    });

    test('re-posting the same completion pays nothing the second time', async () => {
        const h = makeHarness({ modules: [mod1, mod2], tasks: [], quizzes: [] });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');

        assert.deepEqual(h.awarded, ['lesson_complete'], 'a replayed request must not pay again');
    });

    test('a lesson already recorded as complete pays nothing', async () => {
        const h = makeHarness({
            modules: [mod1, mod2],
            tasks: [],
            quizzes: [],
            progress: [{ moduleId: 'mod-1', completedAt: new Date() }],
        });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.deepEqual(h.awarded, []);
    });

    test('course_complete waits until the final evaluation is submitted', async () => {
        const h = makeHarness({ modules: [mod1, mod2], tasks: [], quizzes: [] });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.deepEqual(h.awarded, ['lesson_complete'], 'partial progress must not pay course_complete');

        await h.service.markComplete('enr-1', 'mod-2', 'stu-1');
        assert.deepEqual(h.awarded, ['lesson_complete', 'lesson_complete']);

        // Anything further now sits at 100% and must be silent.
        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        await h.service.markComplete('enr-1', 'mod-2', 'stu-1');
        assert.deepEqual(
            h.awarded,
            ['lesson_complete', 'lesson_complete'],
            'course completion points are deferred until the required evaluation',
        );
    });

    test('the last module of a single-lesson course defers course points', async () => {
        const h = makeHarness({ modules: [module1], tasks: [], quizzes: [] });

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.deepEqual(h.awarded, ['lesson_complete']);

        await h.service.markComplete('enr-1', 'mod-1', 'stu-1');
        assert.deepEqual(h.awarded, ['lesson_complete']);
    });

    test('the final evaluation makes lesson progress immutable', async () => {
        const h = makeHarness({ modules: [module1], tasks: [], quizzes: [], evaluation: { id: 'evaluation-1' } });
        await assert.rejects(
            () => h.service.markIncomplete('enr-1', 'mod-1', 'stu-1'),
            /cannot be changed after submitting the final evaluation/,
        );
        assert.equal(h.calls.some((call) => call.model === 'lessonProgress' && call.op === 'deleteMany'), false);
    });

    test('a refused completion pays nothing at all', async () => {
        const h = makeHarness({ modules: [mod1, mod2], tasks: [{ moduleId: 'mod-1', submissions: [] }] });

        await assert.rejects(() => h.service.markComplete('enr-1', 'mod-1', 'stu-1'));
        assert.deepEqual(h.awarded, []);
    });
});
