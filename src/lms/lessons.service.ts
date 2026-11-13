import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseContentType, CourseOpeningStatus, DeliveryMode, EnrollmentStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { Classroom, resolveClassroom } from '../common/classroom';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LessonsService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService,
    private audit?: AuditService,
  ) {}

  async syllabus(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          where: { openingId: null },
          orderBy: { orderIndex: 'asc' },
          include: {
            outcomes: { orderBy: { createdAt: 'asc' } },
            quizzes: {
              where: { isPublished: true, openingId: null },
              orderBy: { orderIndex: 'asc' },
              select: { id: true, titleAr: true, titleEn: true, orderIndex: true, passScore: true, _count: { select: { questions: true } } },
            },
          },
        },
        chapters: {
          where: { openingId: null },
          orderBy: { orderIndex: 'asc' },
          include: {
            modules: {
              where: { openingId: null },
              orderBy: { orderIndex: 'asc' },
              include: {
                outcomes: { orderBy: { createdAt: 'asc' } },
                quizzes: {
                  where: { isPublished: true, openingId: null },
                  orderBy: { orderIndex: 'asc' },
                  select: { id: true, titleAr: true, titleEn: true, orderIndex: true, passScore: true, _count: { select: { questions: true } } },
                },
              },
            },
          },
        },
        },
    });
    if (!course) throw new NotFoundException('Course not found');
    const redactAssets = (module: typeof course.modules[number]) => ({
      ...module,
      videoUrl: null,
      files: [],
      links: [],
    });
    return {
      ...course,
      modules: course.modules.map(redactAssets),
      chapters: course.chapters.map((chapter) => ({
        ...chapter,
        modules: chapter.modules.map(redactAssets),
      })),
    };
  }

  async listCourseModules(courseId: string, openingId: string | null = null) {
    const modules = await this.prisma.module.findMany({
      where: {
        courseId,
        OR: openingId ? [{ openingId: null }, { openingId }] : [{ openingId: null }],
      },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      include: {
        outcomes: { orderBy: { createdAt: 'asc' } },
        openingContents: openingId ? { where: { openingId } } : false,
      },
    });
    const lessons = modules.flatMap((module) => {
      const { openingContents, ...base } = module;
      const override = openingContents?.[0];
      if (override?.isHidden) return [];
      const content = override?.content && typeof override.content === 'object' && !Array.isArray(override.content)
        ? override.content as Record<string, unknown>
        : {};
      return [{
        ...base,
        ...content,
        outcomes: content.outcomes ?? base.outcomes,
      }];
    });
    const lessonKey = (lesson: typeof lessons[number]) => [
      lesson.orderIndex ?? 0,
      (typeof lesson.titleAr === 'string' ? lesson.titleAr : '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
      (typeof lesson.titleEn === 'string' ? lesson.titleEn : '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
    ].join('|');
    const chapterLessonKeys = new Set(
      lessons.filter((lesson) => lesson.chapterId).map(lessonKey),
    );
    const seenIds = new Set<string>();
    const seenLessonKeys = new Set<string>();

    return lessons.filter((lesson) => {
      if (seenIds.has(lesson.id)) return false;
      seenIds.add(lesson.id);

      const key = lessonKey(lesson);
      // Replaced syllabi can leave old root lessons beside their chapter-linked copies.
      if (!lesson.chapterId && chapterLessonKeys.has(key)) return false;
      const structuralKey = `${lesson.chapterId || 'root'}|${key}`;
      if (seenLessonKeys.has(structuralKey)) return false;
      seenLessonKeys.add(structuralKey);
      return true;
    });
  }

  private async assertCanEditOpening(openingId: string, actorId: string, role: Role) {
    const opening = await this.prisma.courseOpening.findUnique({
      where: { id: openingId },
      include: { instructorGrants: { where: { instructorId: actorId } } },
    });
    if (!opening || opening.archivedAt) throw new NotFoundException('Opening not found');
    if (opening.status !== CourseOpeningStatus.OPEN && opening.status !== CourseOpeningStatus.STARTED) {
      throw new ForbiddenException('Learning content can only be edited for open or started courses');
    }
    if (role === Role.ADMIN || role === Role.COURSE_MANAGER) return opening;
    const grant = opening.instructorGrants[0];
    if (role !== Role.INSTRUCTOR || (opening.instructorId !== actorId && !grant?.canReadContent)) {
      throw new ForbiddenException('You are not allowed to edit this opening content');
    }
    return opening;
  }

  async openingModulesForInstructor(openingId: string, actorId: string, role: Role) {
    const opening = await this.assertCanEditOpening(openingId, actorId, role);
    return this.listCourseModules(opening.courseId, openingId);
  }

  async assertCanUploadOpeningFile(openingId: string, actorId: string, role: Role) {
    await this.assertCanEditOpening(openingId, actorId, role);
  }

  async updateOpeningModule(openingId: string, moduleId: string, data: Record<string, unknown>, actorId: string, role: Role) {
    const opening = await this.assertCanEditOpening(openingId, actorId, role);
    const module = await this.prisma.module.findUnique({ where: { id: moduleId } });
    if (!module || module.courseId !== opening.courseId || (module.openingId && module.openingId !== openingId)) {
      throw new NotFoundException('Lesson not found in this opening');
    }
    const allowed = ['titleAr', 'titleEn', 'descriptionAr', 'descriptionEn', 'videoUrl', 'durationMinutes', 'files', 'links', 'outcomes'];
    const content = Object.fromEntries(Object.entries(data).filter(([key]) => allowed.includes(key)));
    if (typeof content.titleAr !== 'string' || !content.titleAr.trim() || typeof content.titleEn !== 'string' || !content.titleEn.trim()) {
      throw new BadRequestException('Lesson titles are required in Arabic and English');
    }
    if (content.durationMinutes !== null && content.durationMinutes !== undefined &&
      (!Number.isInteger(content.durationMinutes) || Number(content.durationMinutes) < 0 || Number(content.durationMinutes) > 10000)) {
      throw new BadRequestException('Lesson duration is invalid');
    }
    this.validateLearningContentArrays(content);
    const current = await this.prisma.openingModuleContent.findUnique({
      where: { openingId_moduleId: { openingId, moduleId } },
    });
    const existing = current?.content && typeof current.content === 'object' && !Array.isArray(current.content)
      ? current.content as Record<string, unknown>
      : {};
    const updated = await this.prisma.openingModuleContent.upsert({
      where: { openingId_moduleId: { openingId, moduleId } },
      create: { openingId, moduleId, content: { ...this.moduleContent(module), ...content } as Prisma.InputJsonValue },
      update: { content: { ...existing, ...content } as Prisma.InputJsonValue },
    });
    await this.audit?.logOpeningActivity?.(openingId, actorId, 'lesson_updated', {
      entityType: 'lesson',
      entityId: moduleId,
      titleAr: typeof content.titleAr === 'string' ? content.titleAr : module.titleAr,
      changedFields: Object.keys(content),
      filesCount: Array.isArray(content.files) ? content.files.length : null,
      linksCount: Array.isArray(content.links) ? content.links.length : null,
    });
    return updated;
  }

  private moduleContent(module: {
    titleAr: string; titleEn: string; descriptionAr: string | null; descriptionEn: string | null;
    videoUrl: string | null; durationMinutes: number | null; files: unknown; links: unknown;
  }) {
    return {
      titleAr: module.titleAr,
      titleEn: module.titleEn,
      descriptionAr: module.descriptionAr,
      descriptionEn: module.descriptionEn,
      videoUrl: module.videoUrl,
      durationMinutes: module.durationMinutes,
      files: module.files,
      links: module.links,
    };
  }

  private validateLearningContentArrays(content: Record<string, unknown>) {
    for (const key of ['files', 'links', 'outcomes']) {
      if (content[key] !== undefined && !Array.isArray(content[key])) {
        throw new BadRequestException(`${key} must be an array`);
      }
    }
    if (Array.isArray(content.files) && content.files.some((file) =>
      !file || typeof file !== 'object' || typeof (file as { url?: unknown }).url !== 'string',
    )) {
      throw new BadRequestException('Each file must include a URL');
    }
    if (Array.isArray(content.links) && content.links.some((link) =>
      !link || typeof link !== 'object' || typeof (link as { url?: unknown }).url !== 'string',
    )) {
      throw new BadRequestException('Each link must include a URL');
    }
    if (Array.isArray(content.outcomes) && content.outcomes.some((outcome) =>
      !outcome || typeof outcome !== 'object' ||
      typeof (outcome as { descriptionAr?: unknown }).descriptionAr !== 'string' ||
      typeof (outcome as { descriptionEn?: unknown }).descriptionEn !== 'string',
    )) {
      throw new BadRequestException('Each learning outcome must include Arabic and English descriptions');
    }
  }

  async createOpeningModule(openingId: string, data: Record<string, unknown>, actorId: string, role: Role) {
    const opening = await this.assertCanEditOpening(openingId, actorId, role);
    if (typeof data.titleAr !== 'string' || typeof data.titleEn !== 'string' || !data.titleAr.trim() || !data.titleEn.trim()) {
      throw new BadRequestException('Lesson titles are required in Arabic and English');
    }
    if (data.durationMinutes !== null && data.durationMinutes !== undefined &&
      (!Number.isInteger(data.durationMinutes) || Number(data.durationMinutes) < 0 || Number(data.durationMinutes) > 10000)) {
      throw new BadRequestException('Lesson duration is invalid');
    }
    const learningContent = {
      files: data.files ?? [],
      links: data.links ?? [],
      outcomes: data.outcomes ?? [],
    };
    this.validateLearningContentArrays(learningContent);
    const count = await this.prisma.module.count({ where: { courseId: opening.courseId, OR: [{ openingId: null }, { openingId }] } });
    const outcomes = learningContent.outcomes as { descriptionAr: string; descriptionEn: string }[];
    const created = await this.prisma.module.create({
      data: {
        titleAr: data.titleAr.trim(),
        titleEn: data.titleEn.trim(),
        descriptionAr: typeof data.descriptionAr === 'string' ? data.descriptionAr : null,
        descriptionEn: typeof data.descriptionEn === 'string' ? data.descriptionEn : null,
        videoUrl: typeof data.videoUrl === 'string' && data.videoUrl ? data.videoUrl : null,
        durationMinutes: Number.isInteger(data.durationMinutes) ? Number(data.durationMinutes) : null,
        files: learningContent.files as object,
        links: learningContent.links as object,
        orderIndex: count,
        courseId: opening.courseId,
        openingId,
        outcomes: { create: outcomes },
      },
    });
    await this.audit?.logOpeningActivity?.(openingId, actorId, 'lesson_created', {
      entityType: 'lesson',
      entityId: created.id,
      titleAr: created.titleAr,
      filesCount: Array.isArray(learningContent.files) ? learningContent.files.length : 0,
      linksCount: Array.isArray(learningContent.links) ? learningContent.links.length : 0,
    });
    return created;
  }

  /**
   * The work a student still owes before a module can count as complete.
   *
   * A module can carry assignments (`CourseTask`, scoped to the opening) and
   * quizzes (`Quiz`, scoped to the course). `markComplete` used to record the
   * module unconditionally, so claiming a lesson — and the `course_complete`
   * points that go with 100% — never required submitting the assignment or
   * passing the quiz. The gate belongs here rather than in the UI: a disabled
   * button is cosmetic, and this is the only writer of `LessonProgress`.
   */
  private async moduleRequirements(
    courseId: string,
    enrollment: { id: string; openingId: string | null },
  ): Promise<Map<string, {
    pendingTasks: number;
    failedQuizzes: number;
    lockedByQuiz?: { id: string; titleAr: string; titleEn: string };
  }>> {
    // Assignments belong to an opening. A legacy `openingId = NULL` row cannot
    // be scoped to one, so counting every opening's tasks would invent work
    // this student was never given; there is nothing to check in that case.
    const tasks = enrollment.openingId
      ? await this.prisma.courseTask.findMany({
          where: { moduleId: { not: null }, openingId: enrollment.openingId },
          select: {
            moduleId: true,
            submissions: { where: { enrollmentId: enrollment.id }, select: { id: true } },
          },
        })
      : [];

    const quizzes = await this.prisma.quiz.findMany({
      where: {
        moduleId: { not: null },
        courseId,
        isPublished: true,
        OR: enrollment.openingId ? [{ openingId: null }, { openingId: enrollment.openingId }] : [{ openingId: null }],
      },
      select: {
        id: true,
        moduleId: true,
        titleAr: true,
        titleEn: true,
        gateNextLessons: true,
        attempts: { where: { enrollmentId: enrollment.id }, select: { passed: true } },
      },
    });

    const modules = await this.listCourseModules(courseId, enrollment.openingId);
    const moduleIndexes = new Map(modules.map((module, index) => [module.id, index]));
    const map = new Map<string, {
      pendingTasks: number;
      failedQuizzes: number;
      lockedByQuiz?: { id: string; titleAr: string; titleEn: string };
    }>();
    const slot = (moduleId: string) => {
      let entry = map.get(moduleId);
      if (!entry) {
        entry = { pendingTasks: 0, failedQuizzes: 0 };
        map.set(moduleId, entry);
      }
      return entry;
    };

    for (const t of tasks) {
      if (!t.submissions.length) slot(t.moduleId as string).pendingTasks += 1;
    }
    for (const q of quizzes) {
      if (!q.attempts.some((a: { passed: boolean }) => a.passed)) slot(q.moduleId as string).failedQuizzes += 1;
      if (!q.gateNextLessons || !q.moduleId || q.attempts.some((attempt) => attempt.passed)) continue;
      const gateIndex = moduleIndexes.get(q.moduleId);
      if (gateIndex === undefined) continue;
      for (const module of modules.slice(gateIndex + 1)) {
        const entry = slot(module.id);
        entry.lockedByQuiz ??= { id: q.id, titleAr: q.titleAr, titleEn: q.titleEn };
      }
    }
    return map;
  }

  async courseProgress(courseId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled in this course');
    const canViewAssets = enrollment.status === EnrollmentStatus.APPROVED;

    // The classroom link follows the same rule as /enrollments/my: an approved
    // student in an online batch gets the room, a PENDING applicant or a
    // REVOKED one does not. Read only, never selected into the module list.
    // The content type travels with it so the player can lead with the meeting
    // schedule on a live course instead of an empty video area.
    const classroom = await this.classroomFor(enrollment);

    const modules = await this.listCourseModules(courseId, enrollment.openingId);
    const progress = await this.prisma.lessonProgress.findMany({
      where: { enrollmentId: enrollment.id },
      select: { moduleId: true, completedAt: true },
    });
    const completedMap = new Map(progress.map((p) => [p.moduleId, p.completedAt]));
    const requirements = await this.moduleRequirements(courseId, enrollment);

    const list = modules.map((m: any) => {
      const owed = requirements.get(m.id) ?? { pendingTasks: 0, failedQuizzes: 0 };
      const locked = !!owed.lockedByQuiz;
      return {
        id: m.id,
        titleAr: m.titleAr,
        titleEn: m.titleEn,
        descriptionAr: m.descriptionAr,
        descriptionEn: m.descriptionEn,
        videoUrl: canViewAssets && !locked ? m.videoUrl : null,
        orderIndex: m.orderIndex,
        isFree: m.isFree,
        durationMinutes: m.durationMinutes,
        files: canViewAssets && !locked ? (m.files ?? null) : [],
        links: canViewAssets && !locked ? (m.links ?? null) : [],
        chapterId: m.chapterId,
        outcomes: m.outcomes,
        completed: completedMap.has(m.id),
        completedAt: completedMap.get(m.id) ?? null,
        // Surfaced so the player can explain the block instead of showing a
        // dead button, and so a client cannot pretend the gate does not exist.
        pendingTasks: owed.pendingTasks,
        failedQuizzes: owed.failedQuizzes,
        locked,
        lockedByQuiz: owed.lockedByQuiz ?? null,
        canComplete: !locked && owed.pendingTasks === 0 && owed.failedQuizzes === 0,
      };
    });

    const completedCount = list.filter((m) => m.completed).length;
    const percent = modules.length === 0 ? 0 : Math.round((completedCount / modules.length) * 100);
    return {
      enrollmentId: enrollment.id,
      openingId: enrollment.openingId,
      total: modules.length,
      completed: completedCount,
      percent,
      modules: list,
      ...classroom,
    };
  }

  /**
   * Online-classroom details for the player: the batch's room plus its schedule
   * of live sessions. Empty unless the enrollment is APPROVED and the batch is
   * ONLINE, so neither the join button nor a session link can appear to
   * somebody who has not been admitted. See `resolveClassroom` for the rule.
   *
   * The course's content type rides along on the same query. It is NOT part of
   * the gate -- it only tells the player which surface to lead with -- and it
   * defaults to LIVE, which is what a course created before the field was.
   */
  private async classroomFor(enrollment: {
    status: string;
    openingId: string | null;
    courseId: string;
  }): Promise<Classroom & { contentType: CourseContentType }> {
    if (enrollment.status !== EnrollmentStatus.APPROVED || !enrollment.openingId) {
      // No room and no schedule for somebody who is not admitted, but the format
      // is still read: a pending applicant opening a pre-recorded course should
      // see that it is videos rather than an empty "meeting schedule".
      return {
        deliveryMode: null,
        meetLink: null,
        liveSessions: [],
        contentType: await this.contentTypeOf(enrollment.courseId),
      };
    }
    const opening = await this.prisma.courseOpening.findUnique({
      where: { id: enrollment.openingId },
      select: {
        deliveryMode: true,
        meetLink: true,
        course: { select: { contentType: true } },
        liveSessions: {
          orderBy: { scheduledAt: 'asc' },
          select: {
            id: true,
            titleAr: true,
            titleEn: true,
            scheduledAt: true,
            durationMinutes: true,
            meetLink: true,
          },
        },
      },
    });
    if (!opening) {
      return {
        deliveryMode: null,
        meetLink: null,
        liveSessions: [],
        contentType: await this.contentTypeOf(enrollment.courseId),
      };
    }

    return {
      ...resolveClassroom(enrollment.status, opening, opening.liveSessions),
      contentType: opening.course?.contentType ?? CourseContentType.LIVE,
    };
  }

  /** The teaching format, defaulting to LIVE for a course row that predates it. */
  private async contentTypeOf(courseId: string): Promise<CourseContentType> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { contentType: true },
    });
    return course?.contentType ?? CourseContentType.LIVE;
  }

  async myNotes(courseId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });
    if (!enrollment || enrollment.status !== EnrollmentStatus.APPROVED) {
      throw new ForbiddenException('You are not enrolled in this course');
    }
    const notes = await this.prisma.lessonNote.findMany({
      where: { enrollmentId: enrollment.id },
      select: { moduleId: true, content: true, updatedAt: true },
    });
    return { enrollmentId: enrollment.id, notes };
  }

  async saveNote(moduleId: string, content: string, studentId: string) {
    const module = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true, openingId: true },
    });
    if (!module) throw new NotFoundException('Module not found');
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId: module.courseId,
        status: EnrollmentStatus.APPROVED,
        ...(module.openingId ? { openingId: module.openingId } : {}),
      },
      select: { id: true },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled in this course');
    await this.prisma.lessonNote.upsert({
      where: { enrollmentId_moduleId: { enrollmentId: enrollment.id, moduleId } },
      update: { content },
      create: { enrollmentId: enrollment.id, moduleId, content },
    });
    return { savedAt: new Date() };
  }

  async markComplete(enrollmentId: string, moduleId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment || enrollment.studentId !== studentId || enrollment.status !== EnrollmentStatus.APPROVED) {
      throw new ForbiddenException('Not your enrollment');
    }

    const module = await this.prisma.module.findUnique({ where: { id: moduleId } });
    if (!module || module.courseId !== enrollment.courseId || (module.openingId && module.openingId !== enrollment.openingId)) {
      throw new NotFoundException('Module not found in this course');
    }

    const owed = (await this.moduleRequirements(enrollment.courseId, enrollment)).get(moduleId);
    if (owed?.lockedByQuiz) {
      throw new ConflictException({
        message: 'Pass the required quiz before opening this lesson',
        code: 'LESSON_LOCKED_BY_QUIZ',
        quizId: owed.lockedByQuiz.id,
        quizTitleAr: owed.lockedByQuiz.titleAr,
        quizTitleEn: owed.lockedByQuiz.titleEn,
      });
    }
    if (owed && (owed.pendingTasks > 0 || owed.failedQuizzes > 0)) {
      throw new ConflictException({
        message: 'Finish the required work for this lesson first',
        code: 'LESSON_REQUIREMENTS_PENDING',
        pendingTasks: owed.pendingTasks,
        failedQuizzes: owed.failedQuizzes,
      });
    }

    const before = await this.courseProgress(enrollment.courseId, studentId);
    const firstCompletion = !before.modules.some((m: any) => m.id === moduleId && m.completed);

    await this.prisma.lessonProgress.upsert({
      where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
      update: { completedAt: new Date() },
      create: { enrollmentId, moduleId },
    });

    // Points belong to the transition, not to the request. Re-posting the same
    // completion used to hand out `lesson_complete` again on every call, and
    // `course_complete` again on every call made once the course sat at 100%,
    // so a student could farm an unbounded score and sit on the leaderboard.
    if (firstCompletion) {
      try { await this.gamification.addPoints(studentId, 'lesson_complete'); } catch {}
    }

    const progress = await this.courseProgress(enrollment.courseId, studentId);
    const nowComplete = progress.total > 0 && progress.completed >= progress.total;
    const wasComplete = before.total > 0 && before.completed >= before.total;
    if (nowComplete && !wasComplete) {
      const evaluation = await this.prisma.courseEvaluation.findUnique({
        where: { enrollmentId },
        select: { id: true },
      });
      if (evaluation) {
        try { await this.gamification.addPoints(studentId, 'course_complete'); } catch {}
      }
    }
    return progress;
  }

  async markIncomplete(enrollmentId: string, moduleId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment || enrollment.studentId !== studentId || enrollment.status !== EnrollmentStatus.APPROVED) {
      throw new ForbiddenException('Not your enrollment');
    }
    const evaluation = await this.prisma.courseEvaluation.findUnique({
      where: { enrollmentId },
      select: { id: true },
    });
    if (evaluation) {
      throw new ConflictException('Course progress cannot be changed after submitting the final evaluation');
    }
    await this.prisma.lessonProgress.deleteMany({ where: { enrollmentId, moduleId } });
    return this.courseProgress(enrollment.courseId, studentId);
  }
}