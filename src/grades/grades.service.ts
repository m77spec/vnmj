import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@prisma/client';
import { CoursesService } from '../courses/courses.service';
import { calculateWeightedGrades } from './gradebook-calculation';

type GradebookSourceType = 'assessment' | 'task' | 'quiz' | 'attendance';

interface GradebookCategoryInput {
    id?: string;
    nameAr: string;
    nameEn: string;
    weightPercent: number;
}

interface GradebookItemInput {
    sourceType: GradebookSourceType;
    sourceId: string;
    categoryId: string | null;
}

@Injectable()
export class GradesService {
    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private courses: CoursesService,
    ) { }

    private async getOpeningOrThrow(openingId: string) {
        const opening = await this.prisma.courseOpening.findUnique({
            where: { id: openingId },
            include: { course: { select: { id: true, titleAr: true, titleEn: true } } },
        });
        if (!opening) throw new NotFoundException('Opening not found');
        return opening;
    }

    // Instructors may only manage (roster/assessments/grades) openings assigned to them.
    private async assertCanManageOpening(openingId: string, actorId: string, actorRole: Role) {
        return this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canGrade');
    }

    // Assessments/grades are tied to an opening via enrollment/assessment; validate the instructor owns the opening.
    private async assertCanManageEnrollment(enrollmentId: string, actorId: string, actorRole: Role) {
        const enrollment = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId } });
        if (!enrollment) throw new NotFoundException('Enrollment not found');
        if (!enrollment.openingId) {
            if (actorRole === Role.INSTRUCTOR) {
                throw new ForbiddenException('You are not allowed to manage grades for this enrollment');
            }
            return;
        }
        const opening = await this.getOpeningOrThrow(enrollment.openingId);
        await this.assertCanManageOpening(opening.id, actorId, actorRole);
    }

    async getRoster(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);

        const [assessments, enrollments, modules] = await Promise.all([
            this.prisma.assessment.findMany({
                where: { openingId },
                orderBy: { orderIndex: 'asc' },
            }),
            this.prisma.enrollment.findMany({
                where: { openingId },
                include: {
                    student: { select: { id: true, email: true, metadata: true } },
                    grades: { select: { assessmentId: true, score: true, notes: true } },
                    lessonProgress: { select: { moduleId: true } },
                },
                orderBy: { createdAt: 'asc' },
            }),
            this.prisma.module.findMany({
                where: {
                    courseId: opening.course.id,
                    OR: [{ openingId: null }, { openingId }],
                },
                select: {
                    id: true,
                    openingContents: openingId
                        ? { where: { openingId }, select: { isHidden: true } }
                        : false,
                },
            }),
        ]);
        const visibleModuleIds = new Set(
            modules
                .filter((module) => !module.openingContents?.[0]?.isHidden)
                .map((module) => module.id),
        );

        return {
            opening: {
                id: opening.id,
                nameAr: opening.nameAr,
                nameEn: opening.nameEn,
                startDate: opening.startDate,
                endDate: opening.endDate,
                isPublished: opening.isPublished,
                status: opening.status,
                announcementStartAt: opening.announcementStartAt,
                announcementEndAt: opening.announcementEndAt,
                instructor: opening.instructorId,
            },
            course: opening.course,
            assessments,
            enrollments: enrollments.map((enrollment) => {
                const metadata = enrollment.student.metadata;
                const studentMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
                    ? metadata as Record<string, unknown>
                    : {};
                const fullName = typeof studentMetadata.fullName === 'string' ? studentMetadata.fullName.trim() : '';
                const nameAr = typeof studentMetadata.nameAr === 'string' ? studentMetadata.nameAr.trim() : '';
                const nameEn = typeof studentMetadata.nameEn === 'string' ? studentMetadata.nameEn.trim() : '';
                const { metadata: _metadata, ...student } = enrollment.student;
                const { lessonProgress, ...enrollmentData } = enrollment;
                const completedModuleCount = lessonProgress.filter(({ moduleId }) => visibleModuleIds.has(moduleId)).length;
                return {
                    ...enrollmentData,
                    student: {
                        ...student,
                        nameAr: nameAr || fullName || null,
                        nameEn: nameEn || fullName || null,
                    },
                    progressPercent: enrollment.status !== 'APPROVED' || visibleModuleIds.size === 0
                        ? null
                        : Math.min(100, Math.round((completedModuleCount / visibleModuleIds.size) * 100)),
                };
            }),
        };
    }

    async listAssessments(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        return this.prisma.assessment.findMany({
            where: { openingId },
            orderBy: { orderIndex: 'asc' },
        });
    }

    async getGradebook(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        const enrollments = await this.prisma.enrollment.findMany({
            where: { openingId },
            include: {
                student: { select: { id: true, email: true, metadata: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
        const enrollmentIds = enrollments.map(({ id }) => id);
        const [
            categories,
            configuredItems,
            assessments,
            tasks,
            quizzes,
            sessions,
            overrides,
        ] = await Promise.all([
            this.prisma.gradeCategory.findMany({ where: { openingId }, orderBy: { orderIndex: 'asc' } }),
            this.prisma.gradebookItem.findMany({ where: { openingId } }),
            this.prisma.assessment.findMany({
                where: { openingId },
                include: { grades: { where: { enrollmentId: { in: enrollmentIds } } } },
                orderBy: { orderIndex: 'asc' },
            }),
            this.prisma.courseTask.findMany({
                where: { openingId },
                include: {
                    submissions: {
                        where: { enrollmentId: { in: enrollmentIds } },
                        select: { enrollmentId: true, score: true },
                    },
                },
                orderBy: { createdAt: 'asc' },
            }),
            this.prisma.quiz.findMany({
                where: {
                    courseId: opening.course.id,
                    OR: [{ openingId }, { openingId: null }],
                },
                include: {
                    attempts: {
                        where: { enrollmentId: { in: enrollmentIds } },
                        select: { enrollmentId: true, score: true, submittedAt: true },
                        orderBy: [{ score: 'desc' }, { submittedAt: 'desc' }],
                    },
                },
                orderBy: { orderIndex: 'asc' },
            }),
            this.prisma.liveSession.findMany({
                where: { openingId },
                include: {
                    attendance: {
                        where: { enrollmentId: { in: enrollmentIds } },
                        select: { enrollmentId: true, status: true },
                    },
                },
                orderBy: { scheduledAt: 'asc' },
            }),
            this.prisma.gradeOverride.findMany({ where: { enrollmentId: { in: enrollmentIds } } }),
        ]);

        const itemCategories = new Map(
            configuredItems.map((item) => [`${item.sourceType}:${item.sourceId}`, item.categoryId]),
        );
        const gradeOverrides = new Map(
            overrides.map((override) => [
                `${override.enrollmentId}:${override.sourceType}:${override.sourceId}`,
                override,
            ]),
        );
        const items: Array<{
            id: string;
            sourceType: GradebookSourceType;
            sourceId: string;
            titleAr: string;
            titleEn: string;
            maxScore: number;
            categoryId: string | null;
            scores: Record<string, { score: number | null; originalScore: number | null; notes: string | null; overridden: boolean; status?: string }>;
        }> = [];
        const appendItem = (source: {
            sourceType: GradebookSourceType;
            sourceId: string;
            titleAr: string;
            titleEn: string;
            maxScore: number;
            originalScores: Map<string, { score: number | null; notes?: string | null; status?: string }>;
        }) => {
            const key = `${source.sourceType}:${source.sourceId}`;
            const scores: Record<string, { score: number | null; originalScore: number | null; notes: string | null; overridden: boolean; status?: string }> = {};
            for (const enrollment of enrollments) {
                const original = source.originalScores.get(enrollment.id);
                const override = gradeOverrides.get(`${enrollment.id}:${source.sourceType}:${source.sourceId}`);
                scores[enrollment.id] = {
                    score: override?.score ?? original?.score ?? null,
                    originalScore: override ? override.originalScore : original?.score ?? null,
                    notes: override?.notes ?? original?.notes ?? null,
                    overridden: !!override,
                    ...(original?.status ? { status: original.status } : {}),
                };
            }
            items.push({
                id: key,
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                titleAr: source.titleAr,
                titleEn: source.titleEn,
                maxScore: source.maxScore,
                categoryId: itemCategories.get(key) ?? null,
                scores,
            });
        };

        for (const assessment of assessments) {
            appendItem({
                sourceType: 'assessment',
                sourceId: assessment.id,
                titleAr: assessment.nameAr,
                titleEn: assessment.nameEn,
                maxScore: assessment.maxScore,
                originalScores: new Map(assessment.grades.map((grade) => [
                    grade.enrollmentId,
                    { score: grade.score, notes: grade.notes },
                ])),
            });
        }
        for (const task of tasks) {
            appendItem({
                sourceType: 'task',
                sourceId: task.id,
                titleAr: task.titleAr,
                titleEn: task.titleEn,
                maxScore: task.maxScore,
                originalScores: new Map(task.submissions.map((submission) => [
                    submission.enrollmentId,
                    { score: submission.score },
                ])),
            });
        }
        for (const quiz of quizzes) {
            const bestAttempts = new Map<string, number>();
            for (const attempt of quiz.attempts) {
                if (!bestAttempts.has(attempt.enrollmentId)) bestAttempts.set(attempt.enrollmentId, attempt.score);
            }
            appendItem({
                sourceType: 'quiz',
                sourceId: quiz.id,
                titleAr: quiz.titleAr,
                titleEn: quiz.titleEn,
                maxScore: 100,
                originalScores: new Map(Array.from(bestAttempts, ([enrollmentId, score]) => [enrollmentId, { score }])),
            });
        }
        for (const session of sessions) {
            const attendanceScores = new Map<string, { score: number | null; status: string }>();
            for (const attendance of session.attendance) {
                attendanceScores.set(attendance.enrollmentId, {
                    score: attendance.status === 'PRESENT' ? 1 : attendance.status === 'LATE' ? 0.5 : attendance.status === 'ABSENT' ? 0 : null,
                    status: attendance.status,
                });
            }
            appendItem({
                sourceType: 'attendance',
                sourceId: session.id,
                titleAr: `${session.titleAr} · ${session.scheduledAt.toISOString().slice(0, 10)}`,
                titleEn: `${session.titleEn} · ${session.scheduledAt.toISOString().slice(0, 10)}`,
                maxScore: 1,
                originalScores: attendanceScores,
            });
        }

        const roster = enrollments.map((enrollment) => {
            const metadata = enrollment.student.metadata;
            const studentMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
                ? metadata as Record<string, unknown>
                : {};
            const fullName = typeof studentMetadata.fullName === 'string' ? studentMetadata.fullName.trim() : '';
            const nameAr = typeof studentMetadata.nameAr === 'string' ? studentMetadata.nameAr.trim() : '';
            const nameEn = typeof studentMetadata.nameEn === 'string' ? studentMetadata.nameEn.trim() : '';
            return {
                id: enrollment.id,
                status: enrollment.status,
                createdAt: enrollment.createdAt,
                student: {
                    id: enrollment.student.id,
                    email: enrollment.student.email,
                    name: nameAr || nameEn || fullName || null,
                },
            };
        });

        const summary = calculateWeightedGrades(categories, items, roster.map(({ id }) => id));
        return { opening: { id: opening.id, nameAr: opening.nameAr, nameEn: opening.nameEn }, categories, items, enrollments: roster, summary };
    }

    async saveGradebookCategories(openingId: string, input: GradebookCategoryInput[], actorId: string, actorRole: Role) {
        await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        if (!Array.isArray(input) || input.length === 0 || input.some((item) => !item || typeof item !== 'object')) {
            throw new BadRequestException('At least one grade category is required');
        }
        const totalWeight = input.reduce((sum, item) => sum + Number(item.weightPercent), 0);
        if (input.some((item) =>
            typeof item.nameAr !== 'string'
            || !item.nameAr.trim()
            || typeof item.nameEn !== 'string'
            || !item.nameEn.trim()
            || item.nameAr.length > 100
            || item.nameEn.length > 100
            || !Number.isFinite(Number(item.weightPercent))
            || Number(item.weightPercent) < 0
            || Number(item.weightPercent) > 100
        ) || Math.abs(totalWeight - 100) > 0.01) {
            throw new BadRequestException('Category names are required and category weights must total exactly 100%');
        }
        if (new Set(input.map((item) => item.id).filter(Boolean)).size !== input.filter((item) => item.id).length) {
            throw new BadRequestException('Duplicate grade category');
        }

        const existing = await this.prisma.gradeCategory.findMany({ where: { openingId }, select: { id: true } });
        const existingIds = new Set(existing.map(({ id }) => id));
        if (input.some((item) => item.id && !existingIds.has(item.id))) {
            throw new BadRequestException('A grade category does not belong to this opening');
        }
        const keptIds: string[] = [];
        await this.prisma.$transaction(async (tx) => {
            for (const [orderIndex, item] of input.entries()) {
                const data = {
                    nameAr: item.nameAr.trim(),
                    nameEn: item.nameEn.trim(),
                    weightPercent: Number(item.weightPercent),
                    orderIndex,
                };
                const saved = item.id
                    ? await tx.gradeCategory.update({ where: { id: item.id }, data })
                    : await tx.gradeCategory.create({ data: { ...data, openingId } });
                keptIds.push(saved.id);
            }
            await tx.gradeCategory.deleteMany({
                where: { openingId, ...(keptIds.length ? { id: { notIn: keptIds } } : {}) },
            });
        });
        await this.audit.logAction(`Updated grade categories for Opening ${openingId}`, undefined, actorId);
        return this.prisma.gradeCategory.findMany({ where: { openingId }, orderBy: { orderIndex: 'asc' } });
    }

    async saveGradebookItems(openingId: string, input: GradebookItemInput[], actorId: string, actorRole: Role) {
        const opening = await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        if (!Array.isArray(input) || input.some((item) =>
            !item
            || typeof item !== 'object'
            || !['assessment', 'task', 'quiz', 'attendance'].includes(item.sourceType)
            || typeof item.sourceId !== 'string'
            || !item.sourceId
            || (item.categoryId !== null && typeof item.categoryId !== 'string')
        )) {
            throw new BadRequestException('Invalid gradebook item mapping');
        }
        const uniqueSources = new Set(input.map((item) => `${item.sourceType}:${item.sourceId}`));
        if (uniqueSources.size !== input.length) throw new BadRequestException('Duplicate gradebook item mapping');
        const categoryIds = input.map((item) => item.categoryId).filter((id): id is string => !!id);
        const categories = await this.prisma.gradeCategory.findMany({
            where: { openingId, id: { in: categoryIds } },
            select: { id: true },
        });
        if (categories.length !== new Set(categoryIds).size) throw new BadRequestException('Invalid grade category');

        const idsByType = (type: GradebookSourceType) => input.filter((item) => item.sourceType === type).map((item) => item.sourceId);
        const [assessments, tasks, quizzes, sessions] = await Promise.all([
            this.prisma.assessment.findMany({ where: { openingId, id: { in: idsByType('assessment') } }, select: { id: true } }),
            this.prisma.courseTask.findMany({ where: { openingId, id: { in: idsByType('task') } }, select: { id: true } }),
            this.prisma.quiz.findMany({
                where: {
                    id: { in: idsByType('quiz') },
                    courseId: opening.course.id,
                    OR: [{ openingId }, { openingId: null }],
                },
                select: { id: true },
            }),
            this.prisma.liveSession.findMany({ where: { openingId, id: { in: idsByType('attendance') } }, select: { id: true } }),
        ]);
        const valid = new Map<GradebookSourceType, Set<string>>([
            ['assessment', new Set(assessments.map(({ id }) => id))],
            ['task', new Set(tasks.map(({ id }) => id))],
            ['quiz', new Set(quizzes.map(({ id }) => id))],
            ['attendance', new Set(sessions.map(({ id }) => id))],
        ]);
        if (input.some((item) => !valid.get(item.sourceType)?.has(item.sourceId))) {
            throw new BadRequestException('A gradebook item does not belong to this opening');
        }
        await this.prisma.$transaction([
            this.prisma.gradebookItem.deleteMany({ where: { openingId } }),
            ...(input.length ? [this.prisma.gradebookItem.createMany({
                data: input.map((item) => ({ openingId, sourceType: item.sourceType, sourceId: item.sourceId, categoryId: item.categoryId })),
            })] : []),
        ]);
        await this.audit.logAction(`Updated gradebook categories for Opening ${openingId}`, undefined, actorId);
        return { saved: input.length };
    }

    async setGradeOverride(
        openingId: string,
        enrollmentId: string,
        sourceType: Exclude<GradebookSourceType, 'assessment'>,
        sourceId: string,
        score: number,
        notes: string | undefined,
        actorId: string,
        actorRole: Role,
    ) {
        const opening = await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        if (!['task', 'quiz', 'attendance'].includes(sourceType)) {
            throw new BadRequestException('Only task, quiz, and attendance grades can be overridden');
        }
        if (notes !== undefined && typeof notes !== 'string') {
            throw new BadRequestException('Grade notes must be text');
        }
        if (!Number.isFinite(score) || score < 0) throw new BadRequestException('Score must be a non-negative number');
        const enrollment = await this.prisma.enrollment.findFirst({ where: { id: enrollmentId, openingId } });
        if (!enrollment) throw new NotFoundException('Enrollment not found in this opening');

        let maxScore: number | null = null;
        let originalScore: number | null = null;
        if (sourceType === 'task') {
            const task = await this.prisma.courseTask.findFirst({
                where: { id: sourceId, openingId },
                select: {
                    maxScore: true,
                    submissions: { where: { enrollmentId }, select: { score: true }, take: 1 },
                },
            });
            maxScore = task?.maxScore ?? null;
            originalScore = task?.submissions[0]?.score ?? null;
        } else if (sourceType === 'quiz') {
            const quiz = await this.prisma.quiz.findFirst({
                where: { id: sourceId, courseId: opening.course.id, OR: [{ openingId }, { openingId: null }] },
                select: {
                    id: true,
                    attempts: {
                        where: { enrollmentId },
                        orderBy: [{ score: 'desc' }, { submittedAt: 'desc' }],
                        select: { score: true },
                        take: 1,
                    },
                },
            });
            maxScore = quiz ? 100 : null;
            originalScore = quiz?.attempts[0]?.score ?? null;
        } else {
            const session = await this.prisma.liveSession.findFirst({
                where: { id: sourceId, openingId },
                select: {
                    id: true,
                    attendance: { where: { enrollmentId }, select: { status: true }, take: 1 },
                },
            });
            maxScore = session ? 1 : null;
            const attendance = session?.attendance[0]?.status;
            originalScore = attendance === 'PRESENT' ? 1
                : attendance === 'LATE' ? 0.5
                    : attendance === 'ABSENT' ? 0
                        : null;
        }
        if (maxScore === null) throw new NotFoundException('Gradebook item not found in this opening');
        if (score > maxScore) throw new BadRequestException(`Score cannot exceed the maximum of ${maxScore}`);

        const previous = await this.prisma.gradeOverride.findUnique({
            where: { enrollmentId_sourceType_sourceId: { enrollmentId, sourceType, sourceId } },
        });
        const result = await this.prisma.gradeOverride.upsert({
            where: { enrollmentId_sourceType_sourceId: { enrollmentId, sourceType, sourceId } },
            update: { score, notes: notes?.trim() || null, updatedById: actorId },
            create: { enrollmentId, sourceType, sourceId, score, originalScore, notes: notes?.trim() || null, updatedById: actorId },
        });
        await this.audit.logAction(
            `Overrode ${sourceType} grade ${sourceId} for Enrollment ${enrollmentId}: original ${previous?.originalScore ?? originalScore ?? 'ungraded'}, previous override ${previous?.score ?? 'none'}, new ${score}`,
            undefined,
            actorId,
        );
        await this.audit.logOpeningActivity?.(openingId, actorId, 'grade_overridden', {
            entityType: 'grade_override',
            entityId: result.id,
            sourceType,
            sourceId,
            enrollmentId,
            previousOverrideScore: previous?.score ?? null,
            score,
            originalScore: previous?.originalScore ?? originalScore,
            originalGradePreserved: true,
        });
        return result;
    }

    async clearGradeOverride(
        openingId: string,
        enrollmentId: string,
        sourceType: Exclude<GradebookSourceType, 'assessment'>,
        sourceId: string,
        actorId: string,
        actorRole: Role,
    ) {
        await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        if (!['task', 'quiz', 'attendance'].includes(sourceType)) {
            throw new BadRequestException('Only task, quiz, and attendance overrides can be cleared');
        }
        const existing = await this.prisma.gradeOverride.findUnique({
            where: { enrollmentId_sourceType_sourceId: { enrollmentId, sourceType, sourceId } },
        });
        if (!existing) throw new NotFoundException('Grade override not found');
        const enrollment = await this.prisma.enrollment.findFirst({ where: { id: enrollmentId, openingId }, select: { id: true } });
        if (!enrollment) throw new NotFoundException('Enrollment not found in this opening');
        await this.prisma.gradeOverride.delete({ where: { id: existing.id } });
        await this.audit.logAction(
            `Cleared ${sourceType} grade override ${sourceId} for Enrollment ${enrollmentId}; original grade restored`,
            undefined,
            actorId,
        );
        return { restored: true };
    }

    async createAssessment(openingId: string, dto: { nameAr: string; nameEn: string; maxScore?: number; orderIndex?: number }, actorId: string, actorRole: Role) {
        const opening = await this.getOpeningOrThrow(openingId);
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        if (!dto.nameAr || !dto.nameEn) {
            throw new BadRequestException('Assessment name (AR/EN) is required');
        }
        if (dto.maxScore != null && dto.maxScore <= 0) {
            throw new BadRequestException('Max score must be greater than 0');
        }
        const count = await this.prisma.assessment.count({ where: { openingId } });
        const assessment = await this.prisma.assessment.create({
            data: {
                openingId,
                nameAr: dto.nameAr,
                nameEn: dto.nameEn,
                maxScore: dto.maxScore ?? 100,
                orderIndex: dto.orderIndex ?? count,
            },
        });
        await this.audit.logAction(`Created assessment "${dto.nameAr}" for Opening ${openingId}`, undefined, actorId);
        return assessment;
    }

    async updateAssessment(assessmentId: string, dto: { nameAr?: string; nameEn?: string; maxScore?: number; orderIndex?: number }, actorId: string, actorRole: Role) {
        const existing = await this.prisma.assessment.findUnique({ where: { id: assessmentId } });
        if (!existing) throw new NotFoundException('Assessment not found');
        const opening = await this.getOpeningOrThrow(existing.openingId);
        await this.assertCanManageOpening(opening.id, actorId, actorRole);
        if (dto.maxScore != null && dto.maxScore <= 0) {
            throw new BadRequestException('Max score must be greater than 0');
        }
        const assessment = await this.prisma.assessment.update({
            where: { id: assessmentId },
            data: {
                nameAr: dto.nameAr ?? existing.nameAr,
                nameEn: dto.nameEn ?? existing.nameEn,
                maxScore: dto.maxScore ?? existing.maxScore,
                orderIndex: dto.orderIndex ?? existing.orderIndex,
            },
        });
        await this.audit.logAction(`Updated assessment ${assessmentId}`, undefined, actorId);
        return assessment;
    }

    async deleteAssessment(assessmentId: string, actorId: string, actorRole: Role) {
        const existing = await this.prisma.assessment.findUnique({ where: { id: assessmentId } });
        if (!existing) throw new NotFoundException('Assessment not found');
        const opening = await this.getOpeningOrThrow(existing.openingId);
        await this.assertCanManageOpening(opening.id, actorId, actorRole);
        const deleted = await this.prisma.assessment.delete({ where: { id: assessmentId } });
        await this.audit.logAction(`Deleted assessment ${assessmentId} (Opening ${existing.openingId})`, undefined, actorId);
        return deleted;
    }

    async upsertGrade(dto: { enrollmentId: string; assessmentId: string; score: number; notes?: string }, actorId: string, actorRole: Role) {
        const { enrollmentId, assessmentId, score } = dto;
        if (!enrollmentId || !assessmentId) {
            throw new BadRequestException('enrollmentId and assessmentId are required');
        }
        if (score == null || isNaN(score)) {
            throw new BadRequestException('A numeric score is required');
        }

        const [enrollment, assessment] = await Promise.all([
            this.prisma.enrollment.findUnique({ where: { id: enrollmentId } }),
            this.prisma.assessment.findUnique({ where: { id: assessmentId } }),
        ]);
        if (!enrollment) throw new NotFoundException('Enrollment not found');
        if (!assessment) throw new NotFoundException('Assessment not found');
        if (enrollment.openingId !== assessment.openingId) {
            throw new BadRequestException('Enrollment and assessment belong to different openings');
        }
        if (enrollment.openingId) {
            const opening = await this.getOpeningOrThrow(enrollment.openingId);
            await this.assertCanManageOpening(opening.id, actorId, actorRole);
        } else if (actorRole === Role.INSTRUCTOR) {
            throw new ForbiddenException('You are not allowed to manage grades for this enrollment');
        }

        const grade = await this.prisma.grade.upsert({
            where: { enrollmentId_assessmentId: { enrollmentId, assessmentId } },
            update: { score, notes: dto.notes ?? null },
            create: { enrollmentId, assessmentId, score, notes: dto.notes ?? null },
        });
        await this.audit.logAction(`Set grade ${score} for Enrollment ${enrollmentId} / Assessment ${assessmentId}`, undefined, actorId);
        return grade;
    }

    async deleteGrade(enrollmentId: string, assessmentId: string, actorId: string, actorRole: Role) {
        const existing = await this.prisma.grade.findUnique({
            where: { enrollmentId_assessmentId: { enrollmentId, assessmentId } },
        });
        if (!existing) throw new NotFoundException('Grade not found');
        await this.assertCanManageEnrollment(enrollmentId, actorId, actorRole);
        const deleted = await this.prisma.grade.delete({
            where: { enrollmentId_assessmentId: { enrollmentId, assessmentId } },
        });
        await this.audit.logAction(`Deleted grade for Enrollment ${enrollmentId} / Assessment ${assessmentId}`, undefined, actorId);
        return deleted;
    }
}