import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QuizzesService } from '../src/lms/quizzes.service';

function makeHarness(options: {
    maxAttempts?: number | null;
    attemptsUsed?: number;
    extraAttempts?: number;
    previousPasses?: number;
    previousPerfects?: number;
} = {}) {
    const created: any[] = [];
    const awarded: string[] = [];
    const quizAttempt = {
        count: async (args: any) => {
            if (args.where?.passed === true) return options.previousPasses ?? 0;
            if (args.where?.score === 100) return options.previousPerfects ?? 0;
            return options.attemptsUsed ?? 0;
        },
        create: async (args: any) => {
            const attempt = { id: `attempt-${created.length + 1}`, submittedAt: new Date(), ...args.data };
            created.push(attempt);
            return attempt;
        },
    };
    const quizAttemptGrant = {
        findUnique: async () => options.extraAttempts ? { extraAttempts: options.extraAttempts } : null,
    };
    const prisma: any = {
        quiz: {
            findUnique: async () => ({
                id: 'quiz-1',
                courseId: 'course-1',
                openingId: null,
                moduleId: null,
                isPublished: true,
                passScore: 60,
                maxAttempts: options.maxAttempts === undefined ? 2 : options.maxAttempts,
                questions: [{ id: 'question-1', correctIndex: 0, options: ['Correct', 'Incorrect'] }],
            }),
        },
        enrollment: {
            findUnique: async () => ({
                id: 'enrollment-1',
                studentId: 'student-1',
                courseId: 'course-1',
                openingId: null,
                status: 'APPROVED',
            }),
        },
        quizAttempt,
        quizAttemptGrant,
        $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({ quizAttempt, quizAttemptGrant }),
    };
    const gamification: any = {
        addPoints: async (_studentId: string, action: string) => { awarded.push(action); },
    };
    return {
        service: new QuizzesService(prisma, gamification),
        created,
        awarded,
    };
}

const correctAnswer = [{ questionId: 'question-1', selected: [0] }];

describe('quiz attempt policy', () => {
    test('records separate attempts within the configured limit', async () => {
        const harness = makeHarness({ maxAttempts: 2, attemptsUsed: 1 });
        const result = await harness.service.attempt('quiz-1', 'enrollment-1', correctAnswer, 'student-1');

        assert.equal(harness.created.length, 1);
        assert.equal(result.attemptsUsed, 2);
        assert.equal(result.attemptsAllowed, 2);
        assert.equal(result.score, 100);
    });

    test('counts instructor-granted attempts on top of the quiz limit', async () => {
        const harness = makeHarness({ maxAttempts: 1, attemptsUsed: 1, extraAttempts: 1 });
        const result = await harness.service.attempt('quiz-1', 'enrollment-1', correctAnswer, 'student-1');

        assert.equal(result.attemptsUsed, 2);
        assert.equal(result.attemptsAllowed, 2);
        assert.equal(harness.created.length, 1);
    });

    test('refuses another attempt after the effective limit is exhausted', async () => {
        const harness = makeHarness({ maxAttempts: 1, attemptsUsed: 2, extraAttempts: 1 });

        await assert.rejects(
            () => harness.service.attempt('quiz-1', 'enrollment-1', correctAnswer, 'student-1'),
            (error: any) => {
                assert.equal(error.getStatus?.(), 409);
                assert.equal(error.response?.code, 'QUIZ_ATTEMPTS_EXHAUSTED');
                return true;
            },
        );
        assert.equal(harness.created.length, 0);
    });

    test('supports unlimited attempts and does not award repeat perfect-score points', async () => {
        const harness = makeHarness({ maxAttempts: null, attemptsUsed: 9, previousPasses: 1, previousPerfects: 1 });
        const result = await harness.service.attempt('quiz-1', 'enrollment-1', correctAnswer, 'student-1');

        assert.equal(result.attemptsUsed, 10);
        assert.equal(result.attemptsAllowed, null);
        assert.deepEqual(harness.awarded, []);
    });
});
