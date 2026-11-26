import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { deduplicateCourseModules } from '../src/common/course-modules';
import { CoursesService } from '../src/courses/courses.service';

describe('course module options', () => {
    test('removes stale root lessons when their chapter-linked replacements exist', () => {
        const lessons = [
            { id: 'old-root', titleAr: 'الدرس الأول', titleEn: 'Lesson one', orderIndex: 0, chapterId: null },
            { id: 'chapter-copy', titleAr: ' الدرس   الأول ', titleEn: ' lesson one ', orderIndex: 0, chapterId: 'chapter-1' },
            { id: 'next', titleAr: 'الدرس الثاني', titleEn: 'Lesson two', orderIndex: 1, chapterId: 'chapter-1' },
        ];

        assert.deepEqual(
            deduplicateCourseModules(lessons).map(({ id }) => id),
            ['chapter-copy', 'next'],
        );
    });

    test('keeps same-title lessons in different chapters and preserves stable options', () => {
        const lessons = [
            { id: 'lesson-a', titleAr: 'مراجعة', titleEn: 'Review', orderIndex: 0, chapterId: 'chapter-a' },
            { id: 'lesson-b', titleAr: 'مراجعة', titleEn: 'Review', orderIndex: 0, chapterId: 'chapter-b' },
            { id: 'lesson-a-duplicate', titleAr: 'مراجعة', titleEn: 'Review', orderIndex: 0, chapterId: 'chapter-a' },
        ];

        assert.deepEqual(
            deduplicateCourseModules(lessons).map(({ id }) => id),
            ['lesson-a', 'lesson-b'],
        );
    });

    test('the task lesson endpoint returns unique lessons in deterministic syllabus order', async () => {
        const modules = [
            {
                id: 'old-root',
                titleAr: 'الدرس الأول',
                titleEn: 'Lesson one',
                orderIndex: 0,
                chapterId: null,
                createdAt: new Date('2026-01-01'),
                openingContents: [],
                outcomes: [],
            },
            {
                id: 'chapter-copy',
                titleAr: 'الدرس الأول',
                titleEn: 'Lesson one',
                orderIndex: 0,
                chapterId: 'chapter-1',
                createdAt: new Date('2026-01-02'),
                openingContents: [],
                outcomes: [],
            },
        ];
        let query: any;
        const service = new CoursesService(
            {
                courseOpening: {
                    findUnique: async () => ({
                        id: 'opening-1',
                        courseId: 'course-1',
                        archivedAt: null,
                        instructorId: 'instructor-1',
                        instructorGrants: [],
                    }),
                },
                module: {
                    findMany: async (args: any) => {
                        query = args;
                        return modules;
                    },
                },
            } as any,
            {} as any,
            {} as any,
            {} as any,
        );

        const options = await service.listOpeningModules('opening-1', 'admin-1', Role.ADMIN);

        assert.deepEqual(options.map((module) => module.id), ['chapter-copy']);
        assert.deepEqual(query.orderBy, [
            { chapter: { orderIndex: 'asc' } },
            { orderIndex: 'asc' },
            { createdAt: 'asc' },
            { id: 'asc' },
        ]);
    });
});
