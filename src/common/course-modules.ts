export type CourseModuleOption = {
    id: string;
    titleAr: string;
    titleEn: string;
    orderIndex: number | null;
    chapterId?: string | null;
};

function lessonKey(lesson: CourseModuleOption) {
    return [
        lesson.orderIndex ?? 0,
        lesson.titleAr.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
        lesson.titleEn.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
    ].join('|');
}

export function deduplicateCourseModules<T extends CourseModuleOption>(modules: T[]): T[] {
    const chapterLessonKeys = new Set(
        modules.filter((lesson) => lesson.chapterId).map(lessonKey),
    );
    const seenIds = new Set<string>();
    const seenLessonKeys = new Set<string>();

    return modules.filter((lesson) => {
        if (seenIds.has(lesson.id)) return false;
        seenIds.add(lesson.id);

        const key = lessonKey(lesson);
        if (!lesson.chapterId && chapterLessonKeys.has(key)) return false;

        const structuralKey = `${lesson.chapterId || 'root'}|${key}`;
        if (seenLessonKeys.has(structuralKey)) return false;
        seenLessonKeys.add(structuralKey);
        return true;
    });
}
