import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeightedGrades } from '../src/grades/gradebook-calculation';

describe('weighted gradebook calculation', () => {
    test('normalizes each item and weights only categories with published grades', () => {
        const summary = calculateWeightedGrades(
            [
                { id: 'assignments', weightPercent: 40 },
                { id: 'quizzes', weightPercent: 40 },
                { id: 'attendance', weightPercent: 20 },
            ],
            [
                { categoryId: 'assignments', maxScore: 50, scores: { student: { score: 40 } } },
                { categoryId: 'quizzes', maxScore: 100, scores: { student: { score: 80 } } },
                { categoryId: 'attendance', maxScore: 1, scores: { student: { score: null } } },
            ],
            ['student'],
        );

        assert.deepEqual(summary.student, { percentage: 80, coveragePercent: 80 });
    });

    test('counts zero as a real grade and leaves wholly ungraded students without a final score', () => {
        const summary = calculateWeightedGrades(
            [{ id: 'work', weightPercent: 100 }],
            [{ categoryId: 'work', maxScore: 10, scores: { zero: { score: 0 }, missing: { score: null } } }],
            ['zero', 'missing'],
        );

        assert.deepEqual(summary.zero, { percentage: 0, coveragePercent: 100 });
        assert.deepEqual(summary.missing, { percentage: null, coveragePercent: 0 });
    });
});
