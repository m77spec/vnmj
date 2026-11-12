import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LessonsService } from '../src/lms/lessons.service';

test('lesson listing removes stale and repeated lesson rows without collapsing distinct lessons', async () => {
    const modules = [
        { id: 'legacy-root', courseId: 'course-1', titleAr: 'الدرس الأول', titleEn: 'Lesson One', orderIndex: 1, chapterId: null, openingContents: [] },
        { id: 'chapter-copy', courseId: 'course-1', titleAr: '  الدرس   الأول ', titleEn: 'Lesson One', orderIndex: 1, chapterId: 'chapter-1', openingContents: [] },
        { id: 'chapter-duplicate', courseId: 'course-1', titleAr: 'الدرس الأول', titleEn: 'Lesson One', orderIndex: 1, chapterId: 'chapter-1', openingContents: [] },
        { id: 'same-title-next-lesson', courseId: 'course-1', titleAr: 'الدرس الأول', titleEn: 'Lesson One', orderIndex: 2, chapterId: 'chapter-1', openingContents: [] },
        { id: 'hidden-opening-lesson', courseId: 'course-1', titleAr: 'درس مخفي', titleEn: 'Hidden lesson', orderIndex: 3, chapterId: null, openingContents: [{ isHidden: true }] },
    ];
    const service = new LessonsService(
        { module: { findMany: async () => modules } } as any,
        {} as any,
    );

    const lessons = await service.listCourseModules('course-1', 'opening-1');

    assert.deepEqual(lessons.map(({ id }) => id), ['chapter-copy', 'same-title-next-lesson']);
});
