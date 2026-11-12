import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@prisma/client';
import { CoursesService } from '../courses/courses.service';

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