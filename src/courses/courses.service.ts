import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma, CourseContentType, CourseOpeningStatus, DeliveryMode, EnrollmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CertificatesService } from '../certificates/certificates.service';
import { NotificationsService } from '../notifications/notifications.service';
import { mapPublicCourse, publicInstructorSelect } from '../common/public-instructor';
import { assertLessonVideosAllowed } from '../common/course-content-type';
import { deduplicateCourseModules } from '../common/course-modules';
import { normalizeMeetLink } from '../common/meeting-links';
import { CreateCourseDto, UpdateCourseDto } from './dto/create-course.dto';
import { CreateOpeningDto } from './dto/create-opening.dto';
import { UpdateOpeningDto } from './dto/update-opening.dto';
import { OpeningInstructorGrantDto } from './dto/opening-instructor-grants.dto';

type CourseViewer = { userId?: string; role?: Role };
type OpeningPermission =
    | 'canReadContent'
    | 'canManageTasks'
    | 'canGrade'
    | 'canManageSessions'
    | 'canManageAnnouncements'
    | 'canViewAnalytics';

type ModuleDraft = {
    titleAr: string; titleEn: string; descriptionAr?: string; descriptionEn?: string; videoUrl?: string;
    orderIndex?: number; durationMinutes?: number;
    outcomes?: { descriptionAr: string; descriptionEn: string }[];
    files?: { url: string; nameAr?: string; nameEn?: string }[];
    links?: { url: string; labelAr?: string; labelEn?: string }[];
};

@Injectable()
export class CoursesService {
    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private certificates: CertificatesService,
        private notifications: NotificationsService,
    ) { }

    async create(data: CreateCourseDto, instructorId: string, importIdentity?: { key: string; payloadHash: string }) {
        const { modules, chapters, objectives, prerequisites, audiences, faqs, gallery, quizzes, ...rest } = data;

        assertLessonVideosAllowed(data.contentType, [
            ...(modules ?? []).map((m) => ({ videoUrl: m.videoUrl })),
            ...(chapters ?? []).flatMap((ch, chapterIndex) =>
                (ch.modules ?? []).map((m) => ({ videoUrl: m.videoUrl, chapterIndex })),
            ),
        ]);

        // The course id is generated up front because lessons nested under a
        // chapter are two levels deep: Prisma links the chapter automatically but
        // leaves Module.course unsatisfied, which fails the whole create with a
        // 500. Creating the id here lets buildChapters connect it explicitly.
        const id = randomUUID();

        const courseData = {
            ...rest,
            id,
            instructorId,
            modules: this.buildModules(modules),
            chapters: this.buildChapters(chapters, id),
            objectives: this.buildObjectives(objectives),
            prerequisites: this.buildPrerequisites(prerequisites),
            audiences: this.buildAudiences(audiences),
            faqs: this.buildFaqs(faqs),
            gallery: this.buildGallery(gallery),
        };
        if (!quizzes?.length && !importIdentity) {
            return this.prisma.course.create({ data: courseData });
        }

        return this.prisma.$transaction(async (transaction) => {
            const course = await transaction.course.create({ data: courseData });
            const importedModules = quizzes?.length ? await transaction.module.findMany({
                where: { courseId: id, chapterId: { not: null } },
                select: {
                    id: true,
                    titleAr: true,
                    titleEn: true,
                    orderIndex: true,
                    chapter: { select: { titleAr: true, titleEn: true, orderIndex: true } },
                },
            }) : [];
            const moduleIds = new Map<string, string>();
            for (const chapter of chapters ?? []) {
                for (const lesson of chapter.modules ?? []) {
                    const match = importedModules.find((created) =>
                        created.chapter?.orderIndex === (chapter.orderIndex ?? 0)
                        && created.chapter.titleAr === chapter.titleAr
                        && created.chapter.titleEn === chapter.titleEn
                        && created.orderIndex === (lesson.orderIndex ?? 0)
                        && created.titleAr === lesson.titleAr
                        && created.titleEn === lesson.titleEn,
                    );
                    if (match && lesson.importKey) moduleIds.set(lesson.importKey, match.id);
                }
            }
            for (const quiz of quizzes ?? []) {
                const moduleId = quiz.isFinal ? undefined : moduleIds.get(quiz.moduleRef ?? '');
                if (!quiz.isFinal && !moduleId) {
                    throw new BadRequestException(`Quiz "${quiz.titleEn}" refers to a lesson that was not created.`);
                }
                await transaction.quiz.create({
                    data: {
                        titleAr: quiz.titleAr,
                        titleEn: quiz.titleEn,
                        descriptionAr: quiz.descriptionAr,
                        descriptionEn: quiz.descriptionEn,
                        passScore: quiz.passScore ?? 60,
                        isFinal: quiz.isFinal ?? false,
                        orderIndex: quiz.orderIndex ?? 0,
                        course: { connect: { id } },
                        ...(moduleId ? { module: { connect: { id: moduleId } } } : {}),
                        questions: {
                            create: quiz.questions.map((question, index) => ({
                                type: question.type,
                                textAr: question.textAr,
                                textEn: question.textEn,
                                options: question.options as Prisma.InputJsonValue,
                                correctIndex: question.correctIndex,
                                explanationAr: question.explanationAr,
                                explanationEn: question.explanationEn,
                                orderIndex: question.orderIndex ?? index,
                            })),
                        },
                    },
                });
            }
            if (importIdentity) {
                await transaction.courseImportRequest.create({
                    data: {
                        idempotencyKey: importIdentity.key,
                        payloadHash: importIdentity.payloadHash,
                        courseId: id,
                    },
                });
            }
            return course;
        });
    }

    async createImported(data: CreateCourseDto, instructorId: string, idempotencyKey: string) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
            throw new BadRequestException('Import idempotency key must be a UUID.');
        }
        const payloadHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
        const findExisting = async () => this.prisma.courseImportRequest.findUnique({
            where: { idempotencyKey },
            include: { course: true },
        });
        const returnExisting = (request: Awaited<ReturnType<typeof findExisting>>) => {
            if (!request) return undefined;
            if (request.payloadHash !== payloadHash) {
                throw new ConflictException('This import key was already used with different course data.');
            }
            return request.course;
        };
        const existing = returnExisting(await findExisting());
        if (existing) return existing;
        try {
            return this.create(data, instructorId, { key: idempotencyKey, payloadHash });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const racedRequest = returnExisting(await findExisting());
                if (racedRequest) return racedRequest;
            }
            throw error;
        }
    }

    async update(id: string, data: UpdateCourseDto, viewer?: CourseViewer) {
        const existing = await this.prisma.course.findUnique({ where: { id } });
        if (!existing || existing.archivedAt) throw new NotFoundException('Course not found');

        const { modules, chapters, objectives, prerequisites, audiences, faqs, gallery, quizzes, ...rest } = data;
        if (quizzes?.length) {
            throw new BadRequestException('Quiz editing is not supported on course updates.');
        }

        // The lesson videos and the meeting schedule are two sides of the same
        // promise, so a type change has to respect what is already stored: a
        // recorded course cannot keep the meetings it already has, and a live one
        // cannot keep lesson videos. Reject with the reason instead of silently
        // dropping a schedule the instructor set up.
        const contentType = data.contentType ?? existing.contentType;
        if (data.contentType !== undefined && data.contentType !== existing.contentType) {
            await this.assertTypeChangeAllowed(id, data.contentType, {
                flatLessonsReplaced: modules !== undefined,
                chapterLessonsReplaced: chapters !== undefined,
            });
        }
        assertLessonVideosAllowed(contentType, [
            ...(modules ?? []).map((m) => ({ videoUrl: m.videoUrl })),
            ...(chapters ?? []).flatMap((ch, chapterIndex) =>
                (ch.modules ?? []).map((m) => ({ videoUrl: m.videoUrl, chapterIndex })),
            ),
        ]);

        // PATCH / PATCH semantics: only replace a nested collection when that
        // field was EXPLICITLY submitted. Editing only { titleAr } or { price }
        // must never wipe modules, chapters, objectives, etc. (or, transitively,
        // students' lesson progress / notes / quiz attempts attached to them).
        // An explicitly submitted empty array clears the collection; an omitted
        // field leaves the existing rows untouched.
        const patch: Prisma.CourseUpdateInput = { ...rest };
        if (modules !== undefined) patch.modules = this.replaceCollection(this.buildModules(modules));
        if (chapters !== undefined) patch.chapters = this.replaceCollection(this.buildChapters(chapters, id));
        if (objectives !== undefined) patch.objectives = this.replaceCollection(this.buildObjectives(objectives));
        if (prerequisites !== undefined) patch.prerequisites = this.replaceCollection(this.buildPrerequisites(prerequisites));
        if (audiences !== undefined) patch.audiences = this.replaceCollection(this.buildAudiences(audiences));
        if (faqs !== undefined) patch.faqs = this.replaceCollection(this.buildFaqs(faqs));
        if (gallery !== undefined) patch.gallery = this.replaceCollection(this.buildGallery(gallery));

        await this.prisma.course.update({ where: { id }, data: patch });

        return this.findOne(id, true, viewer);
    }

    private async assertTypeChangeAllowed(
        courseId: string,
        next: CourseContentType,
        replaced: { flatLessonsReplaced: boolean; chapterLessonsReplaced: boolean },
    ) {
        if (next === CourseContentType.RECORDED) {
            const sessions = await this.prisma.liveSession.count({
                where: { opening: { courseId } },
            });
            if (sessions > 0) {
                throw new BadRequestException(
                    `This course already has ${sessions} live session(s). Delete the schedule before ` +
                    'switching it to pre-recorded.',
                );
            }
            return;
        }

        // The other direction. Only the lessons this request does NOT resubmit can
        // survive the update, so only those can leave a live course holding
        // videos: an untouched `modules` keeps the chapter-less lessons, an
        // untouched `chapters` keeps the ones grouped under a chapter (Prisma
        // detaches them rather than deleting them).
        const survivors: Prisma.ModuleWhereInput[] = [];
        if (!replaced.flatLessonsReplaced) survivors.push({ chapterId: null });
        if (!replaced.chapterLessonsReplaced) survivors.push({ chapter: { isNot: null } });
        if (survivors.length === 0) return;

        const videos = await this.prisma.module.count({
            where: { courseId, videoUrl: { not: null }, OR: survivors },
        });
        if (videos > 0) {
            throw new BadRequestException(
                `This course still has ${videos} lesson video(s). Remove the lesson videos (or resend ` +
                'the lessons without them) before switching it to live.',
            );
        }
    }

    // An explicitly submitted non-empty collection REPLACES the existing rows
    // (delete old ones, then create the new set). An explicitly submitted empty
    // collection clears it. Prisma only allows deleteMany inside an update, so
    // create() keeps using the plain "create" builders.
    private replaceCollection<T>(built: T | undefined): T | { deleteMany: {} } {
        if (!built) return { deleteMany: {} };
        return { deleteMany: {}, ...built };
    }

    private moduleCreatePayload(m: ModuleDraft) {
        return {
            titleAr: m.titleAr,
            titleEn: m.titleEn,
            descriptionAr: m.descriptionAr,
            descriptionEn: m.descriptionEn,
            videoUrl: m.videoUrl,
            orderIndex: m.orderIndex ?? 0,
            durationMinutes: m.durationMinutes,
            files: m.files?.length ? m.files as any : undefined,
            links: m.links?.length ? m.links as any : undefined,
            outcomes: m.outcomes?.length
                ? { create: m.outcomes.map((o) => ({ descriptionAr: o.descriptionAr, descriptionEn: o.descriptionEn })) }
                : undefined,
        };
    }

    private buildModules(
        modules?: ModuleDraft[]
    ): Prisma.ModuleCreateNestedManyWithoutCourseInput | undefined {
        if (!modules?.length) return undefined;
        return {
            create: modules.map((m) => this.moduleCreatePayload(m)),
        };
    }

    private buildChapters(
        chapters?: { titleAr: string; titleEn: string; orderIndex?: number; modules?: ModuleDraft[] }[],
        courseId?: string,
    ): Prisma.ChapterCreateNestedManyWithoutCourseInput | undefined {
        if (!chapters?.length) return undefined;
        return {
            create: chapters.map((ch, i) => ({
                titleAr: ch.titleAr,
                titleEn: ch.titleEn,
                orderIndex: ch.orderIndex ?? i,
                modules: ch.modules?.length
                    ? {
                        create: ch.modules.map(
                            (m) =>
                                ({
                                    ...this.moduleCreatePayload(m),
                                    ...(courseId ? { course: { connect: { id: courseId } } } : {}),
                                }) as Prisma.ModuleCreateWithoutChapterInput,
                        ),
                    }
                    : undefined,
            })),
        };
    }

    private buildObjectives(
        objectives?: { objectiveAr: string; objectiveEn: string; orderIndex?: number }[]
    ): Prisma.CourseObjectiveCreateNestedManyWithoutCourseInput | undefined {
        if (!objectives?.length) return undefined;
        return {
            create: objectives.map((o, i) => ({
                objectiveAr: o.objectiveAr,
                objectiveEn: o.objectiveEn,
                orderIndex: o.orderIndex ?? i,
            })),
        };
    }

    private buildPrerequisites(
        prerequisites?: { prerequisiteAr: string; prerequisiteEn: string; orderIndex?: number }[]
    ): Prisma.CoursePrerequisiteCreateNestedManyWithoutCourseInput | undefined {
        if (!prerequisites?.length) return undefined;
        return {
            create: prerequisites.map((p, i) => ({
                prerequisiteAr: p.prerequisiteAr,
                prerequisiteEn: p.prerequisiteEn,
                orderIndex: p.orderIndex ?? i,
            })),
        };
    }

    private buildAudiences(
        audiences?: { audienceAr: string; audienceEn: string; orderIndex?: number }[]
    ): Prisma.CourseAudienceCreateNestedManyWithoutCourseInput | undefined {
        if (!audiences?.length) return undefined;
        return {
            create: audiences.map((a, i) => ({
                audienceAr: a.audienceAr,
                audienceEn: a.audienceEn,
                orderIndex: a.orderIndex ?? i,
            })),
        };
    }

    private buildFaqs(
        faqs?: { questionAr: string; questionEn: string; answerAr: string; answerEn: string; orderIndex?: number }[]
    ): Prisma.CourseFaqCreateNestedManyWithoutCourseInput | undefined {
        if (!faqs?.length) return undefined;
        return {
            create: faqs.map((f, i) => ({
                questionAr: f.questionAr,
                questionEn: f.questionEn,
                answerAr: f.answerAr,
                answerEn: f.answerEn,
                orderIndex: f.orderIndex ?? i,
            })),
        };
    }

    private buildGallery(
        gallery?: { url: string; altAr?: string; altEn?: string; orderIndex?: number }[]
    ): Prisma.CourseImageCreateNestedManyWithoutCourseInput | undefined {
        if (!gallery?.length) return undefined;
        return {
            create: gallery.map((g, i) => ({
                url: g.url,
                altAr: g.altAr,
                altEn: g.altEn,
                orderIndex: g.orderIndex ?? i,
            })),
        };
    }

    private openingInclude = {
        instructor: { select: publicInstructorSelect },
        _count: { select: { enrollments: true } },
    } satisfies Prisma.CourseOpeningInclude;

    /**
     * Course ids the viewer is entitled to see *closed* batches for: they teach
     * one, or they are enrolled in one. Staff are not handled here — callers
     * short-circuit on the role before asking.
     */
    private async relatedCourseIds(viewer?: CourseViewer): Promise<string[]> {
        if (!viewer?.userId) return [];
        const [taught, enrolled] = await Promise.all([
            this.prisma.courseOpening.findMany({
                where: {
                    OR: [
                        { instructorId: viewer.userId },
                        { instructorGrants: { some: { instructorId: viewer.userId } } },
                    ],
                },
                select: { courseId: true },
                distinct: ['courseId'],
            }),
            this.prisma.enrollment.findMany({
                where: { studentId: viewer.userId },
                select: { courseId: true },
                distinct: ['courseId'],
            }),
        ]);
        return [...new Set([...taught, ...enrolled].map((r) => r.courseId))];
    }

    /**
     * Batches that are open for business. A closed cohort (STARTED / ENDED) is
     * internal detail: its name, price and headcount describe a finished
     * intake, and /courses is reachable without a token, so an anonymous caller
     * sees exactly what /public/courses shows. Someone with a real relationship
     * to the course still sees every batch — an enrolled student keeps the
     * STARTED batch they are sitting in, and an instructor still finds the
     * opening they teach.
     */
    private async visibleOpeningsFilter(
        includeUnpublished: boolean,
        viewer?: CourseViewer,
    ): Promise<Prisma.CourseOpeningWhereInput | undefined> {
        if (includeUnpublished) return { archivedAt: null };
        if (viewer?.role === Role.ADMIN || viewer?.role === Role.COURSE_MANAGER) {
            return { archivedAt: null, isPublished: true };
        }
        const related = await this.relatedCourseIds(viewer);
        if (related.length === 0) {
            return {
                archivedAt: null,
                isPublished: true,
                status: { in: [CourseOpeningStatus.OPEN, CourseOpeningStatus.ANNOUNCEMENT] },
            };
        }
        return {
            archivedAt: null,
            isPublished: true,
            OR: [
                { status: { in: [CourseOpeningStatus.OPEN, CourseOpeningStatus.ANNOUNCEMENT] } },
                { courseId: { in: related } },
            ],
        };
    }

    async findAll(includeUnpublished = false, viewer?: CourseViewer) {
        const openingsWhere = await this.visibleOpeningsFilter(includeUnpublished, viewer);
        const sessionManagedOpeningIds = await this.sessionManagedOpeningIds(viewer);
        const courses = await this.prisma.course.findMany({
            where: {
                archivedAt: null,
                ...(includeUnpublished ? {} : {
                    learningPathCourses: { some: { path: { isPublished: true } } },
                }),
            },
            orderBy: { createdAt: 'desc' },
            include: {
                instructor: { select: publicInstructorSelect },
                openings: {
                    where: openingsWhere,
                    orderBy: { createdAt: 'desc' },
                    include: this.openingInclude,
                },
                _count: { select: { enrollments: true, modules: true } },
            },
        });
        // This route is reachable without a token, so the instructor row is
        // replaced with the derived public card before it leaves the process.
        return courses.map((course) => {
            const shaped = mapPublicCourse(course);
            return {
                ...shaped,
                openings: shaped.openings?.map((o) => this.stripClassroomLink(o, viewer, sessionManagedOpeningIds)),
            };
        });
    }

    async findOne(id: string, includeUnpublished = false, viewer?: CourseViewer) {
        const openingsWhere = await this.visibleOpeningsFilter(includeUnpublished, viewer);
        const sessionManagedOpeningIds = await this.sessionManagedOpeningIds(viewer);
        const courseInclude = {
                instructor: { select: publicInstructorSelect },
                openings: {
                    where: openingsWhere,
                    orderBy: { createdAt: 'desc' },
                    include: this.openingInclude,
                },
                _count: {
                    select: {
                        enrollments: true,
                        modules: { where: { openingId: null } },
                    },
                },
                modules: {
                    where: { openingId: null },
                    orderBy: { orderIndex: 'asc' },
                    include: { outcomes: { orderBy: { createdAt: 'asc' } } },
                },
                chapters: {
                    where: { openingId: null },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        modules: {
                            where: { openingId: null },
                            orderBy: { orderIndex: 'asc' },
                            include: { outcomes: { orderBy: { createdAt: 'asc' } } },
                        },
                    },
                },
                objectives: { orderBy: { orderIndex: 'asc' } },
                prerequisites: { orderBy: { orderIndex: 'asc' } },
                audiences: { orderBy: { orderIndex: 'asc' } },
                faqs: { orderBy: { orderIndex: 'asc' } },
                gallery: { orderBy: { orderIndex: 'asc' } },
        } satisfies Prisma.CourseInclude;
        const course = includeUnpublished
            ? await this.prisma.course.findUnique({ where: { id }, include: courseInclude })
            : await this.prisma.course.findFirst({
                where: {
                    id,
                    archivedAt: null,
                    learningPathCourses: { some: { path: { isPublished: true } } },
                },
                include: courseInclude,
            });
        if (!course || course.archivedAt) throw new NotFoundException('Course not found');
        // Public route: swap the instructor row for the derived public card
        // before either the full or the redacted payload is returned.
        const shaped = await this.canViewPaidContent(course, viewer)
            ? mapPublicCourse(course)
            : mapPublicCourse(this.redactPaidContent(course));
        return {
            ...shaped,
            openings: shaped.openings?.map((o) => this.stripClassroomLink(o, viewer, sessionManagedOpeningIds)),
            viewerAccess: await this.viewerAccess(course.id, viewer),
        };
    }

    /**
     * Drop the classroom link from a batch before it leaves through a public
     * route.
     *
     * `/courses`, `/courses/:id` and `/courses/:id/openings` are all reachable
     * without a token, and Prisma's `include` returns every scalar column — so
     * without this the room an enrolled student is entitled to would be handed
     * to any anonymous visitor who asks. `deliveryMode` stays: "this batch is
     * online" is public syllabus information, the room itself is not.
     */
    private async sessionManagedOpeningIds(viewer?: CourseViewer) {
        if (viewer?.role !== Role.INSTRUCTOR || !viewer.userId) return new Set<string>();
        const grants = await this.prisma.openingInstructorGrant.findMany({
            where: { instructorId: viewer.userId, canManageSessions: true },
            select: { openingId: true },
        });
        return new Set(grants.map((grant) => grant.openingId));
    }

    private stripClassroomLink<T extends { id?: string; meetLink?: string | null; instructorId?: string | null }>(
        opening: T,
        viewer?: CourseViewer,
        sessionManagedOpeningIds: ReadonlySet<string> = new Set(),
    ): Omit<T, 'meetLink'> & Partial<Pick<T, 'meetLink'>> {
        const manages = viewer?.role === Role.ADMIN || viewer?.role === Role.COURSE_MANAGER
            || (viewer?.role === Role.INSTRUCTOR && (
                opening.instructorId === viewer.userId
                || (!!opening.id && sessionManagedOpeningIds.has(opening.id))
            ));
        if (manages) return opening;
        const { meetLink: _drop, ...rest } = opening;
        return rest;
    }

    /**
     * What the caller may do with this course, stated explicitly.
     *
     * The frontend used to infer this from `openings.length` — "the course has
     * a live batch, so the signed-in student belongs here" — which was wrong
     * for every student with no relationship to the course, and silently
     * demoted a student in a STARTED batch to guest once the anonymous
     * render filtered that batch away, taking the chat, tasks and grades tabs
     * with it. The UI now asks instead of guessing.
     */
    private async viewerAccess(courseId: string, viewer?: CourseViewer) {
        const none = { enrolled: false, approved: false, teaches: false, chatEnabled: false };
        if (!viewer?.userId) return none;

        const isStaff = viewer.role === Role.ADMIN || viewer.role === Role.COURSE_MANAGER;

        const enrollment = await this.prisma.enrollment.findFirst({
            where: { courseId, studentId: viewer.userId },
            select: { status: true, openingId: true },
        });

    // An instructor's role is not a claim on every course: it has to be a
    // course they own or a batch assigned to them. Trusting the role alone
    // would hand every instructor in the platform the cohort chat of a course
    // they have never taught. Owning the course counts, because
    // `Course.instructorId` and `CourseOpening.instructorId` are separate
    // columns: the course's own instructor was otherwise locked out of the
    // chat for a course they own whenever the batch belonged to someone else.
    const [owns, teaches] = await Promise.all([
      this.prisma.course.findFirst({
        where: { id: courseId, instructorId: viewer.userId },
        select: { id: true },
      }),
      this.prisma.courseOpening.findFirst({
        where: { courseId, instructorId: viewer.userId },
        select: { id: true },
      }),
    ]);
    const teachesCourse = !!owns || !!teaches;
        // APPROVED and RESERVED both hold a seat and both grant chat access;
        // PENDING does not, which is what "accepted" means here.
        const approved = enrollment?.status === 'APPROVED' || enrollment?.status === 'RESERVED';

        return {
            enrolled: !!enrollment,
            approved,
            openingId: enrollment?.openingId ?? null,
            enrollmentStatus: enrollment?.status ?? null,
            teaches: teachesCourse,
            chatEnabled: approved || teachesCourse || isStaff,
        };
    }

    // GET /courses/:id is public, so paid lesson media must not travel with it.
    // Entitlement mirrors the LMS rule in lessons.service.courseProgress (any
    // enrollment row grants access) so an enrolled student never loses the video
    // they legitimately paid for, while an anonymous visitor sees the syllabus
    // with the assets stripped.
    private async canViewPaidContent(
        course: { id: string; instructorId: string },
        viewer?: CourseViewer,
    ): Promise<boolean> {
        if (!viewer?.userId) return false;
        if (viewer.role === Role.ADMIN || viewer.role === Role.COURSE_MANAGER) return true;
        if (course.instructorId === viewer.userId) return true;
        const [opening, assistantGrant, enrollment] = await Promise.all([
            this.prisma.courseOpening.findFirst({
                where: { courseId: course.id, instructorId: viewer.userId },
                select: { id: true },
            }),
            this.prisma.courseOpening.findFirst({
                where: {
                    courseId: course.id,
                    instructorGrants: {
                        some: { instructorId: viewer.userId, canReadContent: true },
                    },
                },
                select: { id: true },
            }),
            this.prisma.enrollment.findFirst({
                where: { courseId: course.id, studentId: viewer.userId, status: EnrollmentStatus.APPROVED },
                select: { id: true },
            }),
        ]);
        return !!opening || !!assistantGrant || !!enrollment;
    }

    // Titles, descriptions and outcomes stay visible: that is the public
    // syllabus -- what the course covers and what the student takes away from
    // each lesson. Only the actual assets (video, attachments, external links)
    // wait for an enrollment. There is no per-lesson "free preview" tier any
    // more: a lesson was either watchable by anyone or by nobody, and that
    // split taught visitors to read a lock as the normal state of a course.
    private redactModule<T extends { videoUrl?: string | null; files?: unknown; links?: unknown }>(m: T): T {
        return { ...m, videoUrl: null, files: [], links: [] };
    }

    private redactPaidContent<T extends { modules?: any[]; chapters?: any[] }>(course: T): T {
        return {
            ...course,
            modules: course.modules?.map((m) => this.redactModule(m)),
            chapters: course.chapters?.map((c) => ({
                ...c,
                modules: c.modules?.map((m: any) => this.redactModule(m)),
            })),
        };
    }

    async createOpening(courseId: string, dto: CreateOpeningDto & { nameAr?: string; nameEn?: string }) {
        const course = await this.prisma.course.findUnique({ where: { id: courseId } });
        if (!course || course.archivedAt) throw new NotFoundException('Course not found');
        const instructor = await this.prisma.user.findUnique({ where: { id: dto.instructorId } });
        if (!instructor || instructor.role !== Role.INSTRUCTOR) throw new BadRequestException('Select an instructor account');

        const resolved = this.resolveDelivery(dto, DeliveryMode.IN_PERSON);

        const opening = await this.prisma.courseOpening.create({
            data: {
                courseId,
                instructorId: dto.instructorId,
                nameAr: dto.nameAr ?? null,
                nameEn: dto.nameEn ?? null,
                startDate: dto.startDate as unknown as Date | undefined,
                endDate: dto.endDate as unknown as Date | undefined,
                enrollmentDeadline: dto.enrollmentDeadline as unknown as Date | undefined,
                refundWindowDays: dto.refundWindowDays ?? null,
                price: new Prisma.Decimal(dto.price),
                priceOld: dto.priceOld != null ? new Prisma.Decimal(dto.priceOld) : null,
                currency: dto.currency?.trim().toUpperCase() || 'YER',
                maxStudents: dto.maxStudents ?? null,
                deliveryMode: resolved.mode,
                meetLink: resolved.link ?? null,
            },
            include: this.openingInclude,
        });
        return opening;
    }

    private async hasPublishedPath(courseId: string) {
        const pathCourse = await this.prisma.learningPathCourse.findFirst({
            where: { courseId, path: { isPublished: true } },
            select: { id: true },
        });
        return !!pathCourse;
    }

    private async assertCourseHasPublishedPath(courseId: string) {
        if (!(await this.hasPublishedPath(courseId))) {
            throw new BadRequestException('Add this course to a published learning path before publishing registration');
        }
    }

    async listOpenings(courseId: string, includeUnpublished = false, viewer?: CourseViewer) {
        const course = await this.prisma.course.findUnique({ where: { id: courseId } });
        if (!course || course.archivedAt) throw new NotFoundException('Course not found');
        if (!includeUnpublished && !(await this.hasPublishedPath(courseId))) {
            throw new NotFoundException('Course not found');
        }
        const openings = await this.prisma.courseOpening.findMany({
            where: {
                courseId,
                archivedAt: null,
                ...(includeUnpublished ? {} : { isPublished: true }),
            },
            orderBy: { createdAt: 'desc' },
            include: this.openingInclude,
        });
        const sessionManagedOpeningIds = await this.sessionManagedOpeningIds(viewer);
        return openings.map((o) => this.stripClassroomLink(o, viewer, sessionManagedOpeningIds));
    }

    async listMyOpenings(userId: string, actorRole: Role) {
        const isStaff = actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER;
        if (!isStaff && actorRole !== Role.INSTRUCTOR) {
            throw new ForbiddenException('Not allowed to list openings');
        }
        const openings = await this.prisma.courseOpening.findMany({
            where: {
                archivedAt: null,
                course: { archivedAt: null },
                ...(isStaff ? {} : {
                    OR: [
                        { instructorId: userId },
                        { instructorGrants: { some: { instructorId: userId } } },
                    ],
                }),
            },
            orderBy: { createdAt: 'desc' },
            include: {
                // contentType rides along so the teaching page can hide the live
                // sessions tab for a pre-recorded course instead of offering an
                // empty schedule.
                course: { select: { id: true, titleAr: true, titleEn: true, contentType: true } },
                instructor: { select: { id: true, email: true, role: true } },
                _count: { select: { enrollments: true, tasks: true } },
                instructorGrants: {
                    where: { instructorId: userId },
                    select: {
                        canReadContent: true,
                        canManageTasks: true,
                        canGrade: true,
                        canManageSessions: true,
                        canManageAnnouncements: true,
                        canViewAnalytics: true,
                    },
                },
            },
        });
        return openings.map(({ instructorGrants, ...opening }) => {
            const primary = isStaff || opening.instructorId === userId;
            const grant = instructorGrants?.[0];
            const canManageSessions = primary || !!grant?.canManageSessions;
            const access = {
                canReadContent: primary || !!grant?.canReadContent,
                canManageTasks: primary || !!grant?.canManageTasks,
                canGrade: primary || !!grant?.canGrade,
                canManageSessions,
                canManageAnnouncements: primary || !!grant?.canManageAnnouncements,
                canViewAnalytics: primary || !!grant?.canViewAnalytics,
                isPrimaryInstructor: primary,
            };
            return {
                ...opening,
                ...(canManageSessions ? {} : { meetLink: null }),
                ...(primary ? {} : {
                    price: null,
                    priceOld: null,
                    refundWindowDays: null,
                    maxStudents: null,
                    seatsTaken: null,
                    _count: {
                        enrollments: access.canGrade || access.canManageTasks || access.canViewAnalytics
                            ? opening._count.enrollments
                            : null,
                        tasks: access.canManageTasks || access.canGrade || access.canViewAnalytics
                            ? opening._count.tasks
                            : null,
                    },
                }),
                access,
            };
        });
    }

    async listOpeningModules(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.assertCanManageOpening(
            openingId,
            actorId,
            actorRole,
            ['canReadContent', 'canManageTasks'],
        );
        const modules = await this.prisma.module.findMany({
            where: {
                courseId: opening.courseId,
                OR: [{ openingId: null }, { openingId }],
            },
            orderBy: [
                { chapter: { orderIndex: 'asc' } },
                { orderIndex: 'asc' },
                { createdAt: 'asc' },
                { id: 'asc' },
            ],
            include: {
                outcomes: { orderBy: { createdAt: 'asc' } },
                openingContents: { where: { openingId } },
            },
        });
        const visibleModules = modules.flatMap((module) => {
            const { openingContents, ...base } = module;
            const override = openingContents[0];
            if (override?.isHidden) return [];
            const content = override?.content && typeof override.content === 'object' && !Array.isArray(override.content)
                ? override.content as Record<string, unknown>
                : {};
            return [{ ...base, ...content, outcomes: content.outcomes ?? base.outcomes }];
        });
        return deduplicateCourseModules(visibleModules);
    }

    async getOpeningInstructorGrants(openingId: string) {
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            select: { id: true, archivedAt: true },
        });
        if (!opening || opening.archivedAt) throw new NotFoundException('Opening not found');
        return this.prisma.openingInstructorGrant.findMany({
            where: { openingId },
            orderBy: { instructor: { email: 'asc' } },
            select: {
                instructorId: true,
                canReadContent: true,
                canManageTasks: true,
                canGrade: true,
                canManageSessions: true,
                canManageAnnouncements: true,
                canViewAnalytics: true,
                instructor: { select: { id: true, email: true } },
            },
        });
    }

    async setOpeningInstructorGrants(
        openingId: string,
        instructors: OpeningInstructorGrantDto[],
        grantedById: string,
    ) {
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            select: { id: true, instructorId: true, archivedAt: true },
        });
        if (!opening || opening.archivedAt) throw new NotFoundException('Opening not found');

        const ids = instructors.map(({ instructorId }) => instructorId);
        if (new Set(ids).size !== ids.length) {
            throw new BadRequestException('An instructor can only be listed once');
        }
        if (ids.includes(opening.instructorId)) {
            throw new BadRequestException('The primary instructor already has full access');
        }
        if (instructors.some((grant) => !Object.values(grant).some((value) => value === true))) {
            throw new BadRequestException('Each secondary instructor must have at least one permission');
        }

        if (ids.length > 0) {
            const validInstructors = await this.prisma.user.findMany({
                where: { id: { in: ids }, role: Role.INSTRUCTOR },
                select: { id: true },
            });
            if (validInstructors.length !== ids.length) {
                throw new BadRequestException('Every assigned user must have the instructor role');
            }
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.openingInstructorGrant.deleteMany({ where: { openingId } });
            if (instructors.length > 0) {
                await tx.openingInstructorGrant.createMany({
                    data: instructors.map((grant) => ({ ...grant, openingId, grantedById })),
                });
            }
        });
        await this.audit.logAction(
            `Updated assistant instructor permissions for opening ${openingId}`,
            undefined,
            grantedById,
        );
        return this.getOpeningInstructorGrants(openingId);
    }

    async updateOpening(openingId: string, dto: UpdateOpeningDto, actorId: string, actorRole: Role) {
        const existing = await this.prisma.courseOpening.findUnique({ where: { id: openingId } });
        if (!existing || existing.archivedAt) throw new NotFoundException('Opening not found');
        // Without this, any INSTRUCTOR could rewrite another instructor's batch:
        // reassign instructorId (taking it and its roster), change the price,
        // dates and capacity. Every sibling transition already calls this; the
        // two write paths below were the gap.
        this.assertCanManage(existing, actorId, actorRole);

        const data: Prisma.CourseOpeningUpdateInput = {};
        if (dto.nameAr !== undefined) data.nameAr = dto.nameAr;
        if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
        if (dto.instructorId !== undefined) {
            const instructor = await this.prisma.user.findUnique({ where: { id: dto.instructorId } });
            if (!instructor || instructor.role !== Role.INSTRUCTOR) {
                throw new BadRequestException('Select an instructor account');
            }
            data.instructor = { connect: { id: dto.instructorId } };
        }
        if (dto.startDate !== undefined) data.startDate = dto.startDate as unknown as Date;
        if (dto.endDate !== undefined) data.endDate = dto.endDate as unknown as Date;
        if (dto.enrollmentDeadline !== undefined) data.enrollmentDeadline = dto.enrollmentDeadline as unknown as Date;
        if (dto.refundWindowDays !== undefined) data.refundWindowDays = dto.refundWindowDays ?? null;
        if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
        if (dto.priceOld !== undefined) data.priceOld = dto.priceOld != null ? new Prisma.Decimal(dto.priceOld) : null;
        if (dto.currency !== undefined) data.currency = dto.currency.trim().toUpperCase();
        if (dto.maxStudents !== undefined) data.maxStudents = dto.maxStudents ?? null;
        if (dto.announcementStartAt !== undefined) data.announcementStartAt = dto.announcementStartAt as unknown as Date;
        if (dto.announcementEndAt !== undefined) data.announcementEndAt = dto.announcementEndAt as unknown as Date;

        if (dto.deliveryMode !== undefined || dto.meetLink !== undefined) {
            const resolved = this.resolveDelivery(dto, existing.deliveryMode);
            if (dto.deliveryMode !== undefined) data.deliveryMode = resolved.mode;
            if (dto.meetLink !== undefined || resolved.link === null) data.meetLink = resolved.link;
        }

        const updated = await this.prisma.courseOpening.update({
            where: { id: openingId },
            data,
            include: this.openingInclude,
        });
        if (dto.instructorId) {
            await this.prisma.openingInstructorGrant.deleteMany({
                where: { openingId, instructorId: dto.instructorId },
            });
        }
        return updated;
    }

    private async requireOpening(openingId: string) {
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            include: { course: { select: { id: true, titleAr: true, titleEn: true, archivedAt: true } } },
        });
        if (!opening || opening.archivedAt || opening.course.archivedAt) throw new NotFoundException('Opening not found');
        return opening;
    }

    /**
     * Delivery mode and classroom link are one fact, so they are settled
     * together and always consistent:
     *
     * - IN_PERSON never carries a link. Switching a batch back to in-person
     *   drops the stored link, so flipping the mode again later cannot silently
     *   resurrect a stale classroom to students.
     * - An ONLINE batch with no link yet is allowed: staff often create the
     *   batch first and paste the room once the instructor hands it over. The
     *   student button is simply absent until then.
     * - Validation/normalisation of the URL itself lives in normalizeMeetLink.
     */
    private resolveDelivery(
        dto: Partial<UpdateOpeningDto>,
        currentMode: DeliveryMode,
    ): { mode: DeliveryMode; link?: string | null } {
        const mode = dto.deliveryMode ?? currentMode;
        const normalized = normalizeMeetLink(dto.meetLink);
        if (mode !== DeliveryMode.ONLINE) {
            if (normalized) {
                throw new BadRequestException('meetLink only applies to an ONLINE batch');
            }
            return { mode, link: null };
        }
        // `undefined` = the caller did not touch the link, so keep what is stored.
        return { mode, link: normalized };
    }

    private assertCanManage(opening: { instructorId: string }, actorId: string, actorRole: Role) {
        if (actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER) return;
        if (actorRole === Role.INSTRUCTOR && opening.instructorId === actorId) return;
        throw new ForbiddenException('You are not allowed to manage this opening');
    }

    /**
     * Loads an opening and applies the management rule to it.
     *
     * The public face of `assertCanManage` for modules that own a sub-resource
     * of an opening (its live sessions), so "who may change this batch" stays
     * defined in one place instead of being restated per resource.
     */
    async assertCanManageOpening(
        openingId: string,
        actorId: string,
        actorRole: Role,
        permission?: OpeningPermission | OpeningPermission[],
    ) {
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            include: {
                instructorGrants: {
                    where: { instructorId: actorId },
                },
            },
        });
        if (!opening || opening.archivedAt) throw new NotFoundException('Opening not found');
        if (actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER) return opening;
        if (actorRole === Role.INSTRUCTOR && opening.instructorId === actorId) return opening;
        const grant = opening.instructorGrants?.[0];
        const requested = permission
            ? Array.isArray(permission) ? permission : [permission]
            : [];
        if (actorRole === Role.INSTRUCTOR && requested.some((capability) => grant?.[capability])) return opening;
        throw new ForbiddenException('You are not allowed to manage this opening');
    }

    async hasOpeningPermission(
        openingId: string,
        actorId: string,
        actorRole: Role,
        permissions: OpeningPermission[],
    ) {
        if (actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER) return true;
        if (actorRole !== Role.INSTRUCTOR) return false;
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            select: {
                archivedAt: true,
                instructorId: true,
                instructorGrants: {
                    where: { instructorId: actorId },
                    select: {
                        canReadContent: true,
                        canManageTasks: true,
                        canGrade: true,
                        canManageSessions: true,
                        canManageAnnouncements: true,
                        canViewAnalytics: true,
                    },
                },
            },
        });
        if (!opening || opening.archivedAt) return false;
        if (opening.instructorId === actorId) return true;
        const grant = opening.instructorGrants?.[0];
        return permissions.some((permission) => grant?.[permission] === true);
    }

    private async setStatus(openingId: string, status: CourseOpeningStatus) {
        return this.prisma.courseOpening.update({
            where: { id: openingId },
            data: {
                status,
                isPublished: status !== CourseOpeningStatus.DRAFT,
            },
            include: this.openingInclude,
        });
    }

    async startAnnouncement(
        openingId: string,
        actorId: string,
        actorRole: Role,
        dto: { announcementStartAt?: Date; announcementEndAt?: Date }
    ) {
        const opening = await this.requireOpening(openingId);
        this.assertCanManage(opening, actorId, actorRole);
        await this.assertCourseHasPublishedPath(opening.courseId);
        if (opening.status !== CourseOpeningStatus.DRAFT && opening.status !== CourseOpeningStatus.ANNOUNCEMENT) {
            throw new BadRequestException('Only a draft opening can be moved to announcement');
        }
        const result = await this.prisma.courseOpening.update({
            where: { id: openingId },
            data: {
                status: CourseOpeningStatus.ANNOUNCEMENT,
                isPublished: true,
                announcementStartAt: dto.announcementStartAt ?? opening.announcementStartAt ?? null,
                announcementEndAt: dto.announcementEndAt ?? opening.announcementEndAt ?? null,
            },
            include: this.openingInclude,
        });
        await this.audit.logAction(`Announcement activated for Opening ${openingId}`, undefined, actorId);
        return result;
    }

    /**
     * A student can hold a RESERVED seat from an ANNOUNCEMENT opening. That
     * reservation means nothing until the opening actually opens for payment,
     * so the moment registration goes live we tell them their seat is waiting
     * and is only truly held once they pay. Without this the reservation looks
     * like a finished enrolment from the student's side.
     */
    private async notifyReservedPaymentDue(opening: {
        id: string; courseId: string; nameAr?: string | null; nameEn?: string | null;
        course?: { titleAr?: string | null; titleEn?: string | null } | null;
    }) {
        const reserved = await this.prisma.enrollment.findMany({
            where: { openingId: opening.id, status: 'RESERVED' },
            select: { studentId: true },
        });
        if (reserved.length === 0) return;
        const titleAr = opening.nameAr ?? opening.course?.titleAr;
        const titleEn = opening.nameEn ?? opening.course?.titleEn;
        await Promise.all(reserved.map((e) => this.notifications.notify({
            userId: e.studentId,
            type: 'opening.payment_due',
            titleAr: 'مقعدك بانتظار الدفع',
            titleEn: 'Your seat is waiting for payment',
            bodyAr: `فُتح التسجيل في: ${titleAr ?? ''}. مقعدك محجوز،أكمل الدفع لتثبيت مقعدك في هذه الدفعة.`,
            bodyEn: `Registration is now open for "${titleEn ?? ''}". Your seat is reserved — complete payment to secure your place in this batch.`,
            data: { courseId: opening.courseId, openingId: opening.id },
        }).catch(() => {})));
    }

    async openOpening(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.requireOpening(openingId);
        this.assertCanManage(opening, actorId, actorRole);
        await this.assertCourseHasPublishedPath(opening.courseId);
        if (opening.status !== CourseOpeningStatus.DRAFT && opening.status !== CourseOpeningStatus.ANNOUNCEMENT) {
            throw new BadRequestException('Only a draft or announced opening can be opened for registration');
        }
        const result = await this.setStatus(openingId, CourseOpeningStatus.OPEN);
        await this.audit.logAction(`Opening ${openingId} opened for registration`, undefined, actorId);
        await this.notifyReservedPaymentDue({ ...opening, id: openingId });
        return result;
    }

    async startCourse(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.requireOpening(openingId);
        this.assertCanManage(opening, actorId, actorRole);
        if (opening.status !== CourseOpeningStatus.OPEN) {
            throw new BadRequestException('Only an open opening can be started');
        }
        const result = await this.setStatus(openingId, CourseOpeningStatus.STARTED);
        await this.audit.logAction(`Course started for Opening ${openingId}`, undefined, actorId);
        const enrolled = await this.prisma.enrollment.findMany({
            where: { openingId, status: 'APPROVED' },
            select: { studentId: true },
        });
        const titleAr = opening.nameAr ?? opening.course?.titleAr;
        const titleEn = opening.nameEn ?? opening.course?.titleEn;
        await Promise.all(enrolled.map((e) => this.notifications.notify({
            userId: e.studentId,
            type: 'opening.started',
            titleAr: 'بدأت الدورة',
            titleEn: 'Course started',
            bodyAr: `بدأت الدورة: ${titleAr ?? ''}`,
            bodyEn: `The course "${titleEn ?? ''}" has started.`,
            data: { courseId: opening.courseId, openingId },
        }).catch(() => {})));
        return result;
    }

    async endCourse(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.requireOpening(openingId);
        this.assertCanManage(opening, actorId, actorRole);
        if (opening.status !== CourseOpeningStatus.OPEN && opening.status !== CourseOpeningStatus.STARTED) {
            throw new BadRequestException('Only an open or started opening can be ended');
        }
        const result = await this.setStatus(openingId, CourseOpeningStatus.ENDED);
        await this.audit.logAction(`Course ended for Opening ${openingId}`, undefined, actorId);
        const enrolled = await this.prisma.enrollment.findMany({
            where: { openingId, status: 'APPROVED' },
            select: { studentId: true },
        });
        const titleAr = opening.nameAr ?? opening.course?.titleAr;
        const titleEn = opening.nameEn ?? opening.course?.titleEn;
        await Promise.all(enrolled.map((e) => this.notifications.notify({
            userId: e.studentId,
            type: 'opening.ended',
            titleAr: 'انتهت الدورة',
            titleEn: 'Course ended',
            bodyAr: `انتهت دورة: ${titleAr ?? ''}. إنهاء الدورة لا يصدر الشهادات تلقائياً؛ سيتم إصدارها بعد مراجعة أداء الطلبة.`,
            bodyEn: `The course "${titleEn ?? ''}" has ended. Certificates are not issued automatically; they are granted after the students' performance is reviewed.`,
            data: { courseId: opening.courseId, openingId },
        }).catch(() => {})));
        return result;
    }

    async setOpeningPublished(openingId: string, isPublished: boolean, actorId: string, actorRole: Role) {
        const existing = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            include: { course: { select: { id: true, titleAr: true, titleEn: true } } },
        });
        if (!existing || existing.archivedAt) throw new NotFoundException('Opening not found');
        // Publishing is not a cosmetic flag: it emails every wishlist user and
        // flips PENDING reservations to "payment due". That blast had to be
        // gated on actually managing the opening.
        this.assertCanManage(existing, actorId, actorRole);
        if (isPublished) await this.assertCourseHasPublishedPath(existing.courseId);
        const result = await this.setStatus(openingId, isPublished ? CourseOpeningStatus.OPEN : CourseOpeningStatus.DRAFT);
        if (isPublished) {
            const wishlistUsers = await this.prisma.wishlist.findMany({
                where: { courseId: existing.courseId },
                select: { userId: true },
            });
            await Promise.all(wishlistUsers.map((w) => this.notifications.notify({
                userId: w.userId,
                type: 'opening.published',
                titleAr: 'فُتح التسجيل في الدورة',
                titleEn: 'Registration is open',
                bodyAr: `تم فتح التسجيل في دورة: ${existing.course.titleAr}`,
                bodyEn: `Registration is now open for "${existing.course.titleEn}".`,
                data: { courseId: existing.courseId, openingId },
            }).catch(() => {})));
        }
        if (isPublished && existing.status !== CourseOpeningStatus.OPEN) {
            // Publishing also flips the status to OPEN, so anyone sitting on a
            // reservation from the announcement window now owes money. Only on a
            // real transition into OPEN: re-publishing an already-open opening
            // is an idempotent save and must not re-send these.
            await this.notifyReservedPaymentDue({ ...existing, id: openingId });
        }
        return result;
    }

    async removeOpening(openingId: string, deleterId: string, ip?: string) {
        const opening = await this.prisma.courseOpening.findFirst({
            where: { id: openingId, archivedAt: null, course: { archivedAt: null } },
        });
        if (!opening) throw new NotFoundException('Opening not found');
        const archived = await this.prisma.courseOpening.update({
            where: { id: openingId },
            data: { archivedAt: new Date(), isPublished: false },
        });
        await this.audit.logAction(`User ${deleterId} archived Opening ${openingId}`, ip, deleterId);
        return archived;
    }

    async remove(id: string, deleterId: string, ip?: string) {
        const course = await this.prisma.course.findFirst({ where: { id, archivedAt: null } });
        if (!course) throw new NotFoundException('Course not found');
        const archivedAt = new Date();
        const archived = await this.prisma.$transaction(async (tx) => {
            await tx.courseOpening.updateMany({
                where: { courseId: id, archivedAt: null },
                data: { archivedAt, isPublished: false },
            });
            return tx.course.update({ where: { id }, data: { archivedAt } });
        });
        await this.audit.logAction(`User ${deleterId} archived Course ${id}`, ip, deleterId);
        return archived;
    }

    async listArchived() {
        const [courses, openings] = await Promise.all([
            this.prisma.course.findMany({
                where: { archivedAt: { not: null } },
                orderBy: { archivedAt: 'desc' },
                select: { id: true, titleAr: true, titleEn: true, archivedAt: true },
            }),
            this.prisma.courseOpening.findMany({
                where: { archivedAt: { not: null }, course: { archivedAt: null } },
                orderBy: { archivedAt: 'desc' },
                include: {
                    course: { select: { id: true, titleAr: true, titleEn: true } },
                    instructor: { select: { email: true } },
                    _count: { select: { enrollments: true } },
                },
            }),
        ]);
        return { courses, openings };
    }

    async restoreCourse(id: string, actorId: string, ip?: string) {
        const course = await this.prisma.course.findFirst({ where: { id, archivedAt: { not: null } } });
        if (!course) throw new NotFoundException('Archived course not found');
        const restored = await this.prisma.$transaction(async (tx) => {
            await tx.courseOpening.updateMany({
                where: { courseId: id, archivedAt: course.archivedAt },
                data: { archivedAt: null, status: CourseOpeningStatus.DRAFT, isPublished: false },
            });
            return tx.course.update({ where: { id }, data: { archivedAt: null } });
        });
        await this.audit.logAction(`User ${actorId} restored Course ${id}`, ip, actorId);
        return restored;
    }

    async restoreOpening(openingId: string, actorId: string, actorRole: Role, ip?: string) {
        const opening = await this.prisma.courseOpening.findFirst({
            where: { id: openingId, archivedAt: { not: null }, course: { archivedAt: null } },
        });
        if (opening) {
            const restored = await this.prisma.courseOpening.update({
                where: { id: openingId },
                data: { archivedAt: null, status: CourseOpeningStatus.DRAFT, isPublished: false },
            });
            await this.audit.logAction(`User ${actorId} restored archived Opening ${openingId}`, ip, actorId);
            return restored;
        }

        const ended = await this.requireOpening(openingId);
        this.assertCanManage(ended, actorId, actorRole);
        if (ended.status !== CourseOpeningStatus.ENDED) {
            throw new BadRequestException('Only an ended or archived opening can be restored');
        }
        const restored = await this.setStatus(openingId, CourseOpeningStatus.STARTED);
        await this.audit.logAction(`User ${actorId} restored ended Opening ${openingId}`, ip, actorId);
        return restored;
    }
}