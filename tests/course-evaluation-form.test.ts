import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CourseEvaluationMetric, CourseEvaluationQuestionType } from '@prisma/client';
import { CourseEvaluationsService } from '../src/lms/course-evaluations.service';

function makeHarness() {
    const saved: any[] = [];
    const questions = [
        {
            id: 'rating-course',
            promptAr: 'قيّم الدورة',
            promptEn: 'Rate the course',
            type: CourseEvaluationQuestionType.RATING,
            metric: CourseEvaluationMetric.COURSE,
            isRequired: true,
            options: null,
        },
        {
            id: 'single',
            promptAr: 'اختر واحدًا',
            promptEn: 'Choose one',
            type: CourseEvaluationQuestionType.SINGLE_CHOICE,
            metric: CourseEvaluationMetric.GENERAL,
            isRequired: true,
            options: [{ value: 'a', labelAr: 'أ', labelEn: 'A' }, { value: 'b', labelAr: 'ب', labelEn: 'B' }],
        },
        {
            id: 'multiple',
            promptAr: 'اختر عدة',
            promptEn: 'Choose several',
            type: CourseEvaluationQuestionType.MULTIPLE_CHOICE,
            metric: CourseEvaluationMetric.GENERAL,
            isRequired: true,
            options: [{ value: 'x', labelAr: 'س', labelEn: 'X' }, { value: 'y', labelAr: 'ص', labelEn: 'Y' }],
        },
        {
            id: 'yes-no',
            promptAr: 'هل توصي بها؟',
            promptEn: 'Would you recommend it?',
            type: CourseEvaluationQuestionType.YES_NO,
            metric: CourseEvaluationMetric.GENERAL,
            isRequired: true,
            options: null,
        },
        {
            id: 'comment',
            promptAr: 'ملاحظة',
            promptEn: 'Comment',
            type: CourseEvaluationQuestionType.TEXT,
            metric: CourseEvaluationMetric.GENERAL,
            isRequired: false,
            options: null,
        },
    ];
    const prisma: any = {
        enrollment: {
            findUnique: async () => ({
                id: 'enrollment-1',
                status: 'APPROVED',
                openingId: 'opening-1',
                course: { id: 'course-1', titleAr: 'دورة', titleEn: 'Course', instructorId: 'instructor-1' },
                opening: { id: 'opening-1', instructorId: 'instructor-1' },
                courseEvaluation: null,
            }),
        },
        module: { findMany: async () => [{ id: 'module-1' }] },
        lessonProgress: { findMany: async () => [{ moduleId: 'module-1' }] },
        courseTask: { findMany: async () => [] },
        quiz: { findMany: async () => [] },
        courseEvaluationForm: {
            upsert: async () => ({ id: 'form-1', questions }),
            findUnique: async () => ({ id: 'form-1', questions }),
        },
        courseEvaluation: {
            create: async ({ data }: any) => {
                saved.push(data);
                return { id: 'evaluation-1', createdAt: new Date('2026-01-01T00:00:00.000Z') };
            },
        },
    };
    const service = new CourseEvaluationsService(
        prisma,
        { logAction: async () => undefined } as any,
        { addPoints: async () => undefined } as any,
    );
    return { service, saved };
}

describe('custom course evaluation forms', () => {
    test('validates and stores all supported answer types with question snapshots', async () => {
        const harness = makeHarness();
        await harness.service.submit('course-1', 'student-1', {
            answers: [
                { questionId: 'rating-course', value: 4 },
                { questionId: 'single', value: 'a' },
                { questionId: 'multiple', value: ['x', 'y'] },
                { questionId: 'yes-no', value: false },
                { questionId: 'comment', value: 'Helpful course' },
            ],
        });

        assert.equal(harness.saved.length, 1);
        assert.equal(harness.saved[0].formId, 'form-1');
        assert.equal(harness.saved[0].courseRating, 4);
        assert.equal(harness.saved[0].instructorRating, null);
        assert.equal(harness.saved[0].commentAr, 'Helpful course');
        assert.deepEqual(harness.saved[0].answers.map((answer: any) => answer.value), [4, 'a', ['x', 'y'], false, 'Helpful course']);
        assert.equal(harness.saved[0].answers[0].promptEn, 'Rate the course');
    });

    test('rejects missing required answers and choices outside the configured options', async () => {
        const missing = makeHarness();
        await assert.rejects(
            () => missing.service.submit('course-1', 'student-1', { answers: [{ questionId: 'rating-course', value: 5 }] }),
            (error: any) => error.getStatus?.() === 400,
        );
        assert.equal(missing.saved.length, 0);

        const invalidChoice = makeHarness();
        await assert.rejects(
            () => invalidChoice.service.submit('course-1', 'student-1', {
                answers: [
                    { questionId: 'rating-course', value: 5 },
                    { questionId: 'single', value: 'not-an-option' },
                    { questionId: 'multiple', value: ['x'] },
                    { questionId: 'yes-no', value: true },
                ],
            }),
            (error: any) => error.getStatus?.() === 400,
        );
        assert.equal(invalidChoice.saved.length, 0);
    });

    test('rejects duplicate and foreign question ids', async () => {
        const duplicate = makeHarness();
        await assert.rejects(
            () => duplicate.service.submit('course-1', 'student-1', {
                answers: [
                    { questionId: 'rating-course', value: 4 },
                    { questionId: 'rating-course', value: 5 },
                ],
            }),
            (error: any) => error.getStatus?.() === 400,
        );

        const foreign = makeHarness();
        await assert.rejects(
            () => foreign.service.submit('course-1', 'student-1', {
                answers: [
                    { questionId: 'rating-course', value: 4 },
                    { questionId: 'foreign-question', value: 'anything' },
                ],
            }),
            (error: any) => error.getStatus?.() === 400,
        );
    });
});
