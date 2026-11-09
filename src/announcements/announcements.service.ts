import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { CoursesService } from '../courses/courses.service';
import { getUserDisplayNames } from '../common/user-display-name';

@Injectable()
export class AnnouncementsService {
    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private notifications: NotificationsService,
        private courses: CoursesService,
    ) {}

    private async assertCanManageOpening(openingId: string, actorId: string, actorRole: Role) {
        return this.courses.assertCanManageOpening(openingId, actorId, actorRole, 'canManageAnnouncements');
    }

    async createAnnouncement(openingId: string, dto: {
        titleAr: string;
        titleEn: string;
        contentAr: string;
        contentEn: string;
        isPublished?: boolean;
    }, actorId: string, actorRole: Role) {
        await this.assertCanManageOpening(openingId, actorId, actorRole);
        if (!dto.titleAr?.trim() || !dto.titleEn?.trim()) {
            throw new BadRequestException('titleAr and titleEn are required');
        }
        if (!dto.contentAr?.trim() || !dto.contentEn?.trim()) {
            throw new BadRequestException('contentAr and contentEn are required');
        }
        const announcement = await this.prisma.announcement.create({
            data: {
                openingId,
                titleAr: dto.titleAr.trim(),
                titleEn: dto.titleEn.trim(),
                contentAr: dto.contentAr.trim(),
                contentEn: dto.contentEn.trim(),
                isPublished: dto.isPublished ?? false,
                authorId: actorId,
            },
        });
        await this.audit.logAction(`Created announcement "${dto.titleAr}" for Opening ${openingId}`, undefined, actorId);
        return announcement;
    }

    async listAnnouncements(openingId: string, actorId: string, actorRole: Role) {
        const opening = await this.prisma.courseOpening.findUnique({ where: { id: openingId } });
        if (!opening) throw new NotFoundException('Opening not found');

        const isStaff = actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER ||
            actorRole === Role.INSTRUCTOR;
        const isStudent = actorRole === Role.STUDENT;

        if (actorRole === Role.INSTRUCTOR) {
            await this.assertCanManageOpening(openingId, actorId, actorRole);
        }
        if (!isStaff && !isStudent) {
            throw new ForbiddenException('Not allowed to view announcements for this opening');
        }

        const where: any = { openingId };
        if (isStudent) {
            where.isPublished = true;
        }

        const announcements = await this.prisma.announcement.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                author: { select: { id: true, email: true, role: true, metadata: true } },
            },
        });
        if (isStudent) {
            return announcements.map((announcement) => ({
                ...announcement,
                author: announcement.author
                    ? { id: announcement.author.id, ...getUserDisplayNames(announcement.author) }
                    : null,
            }));
        }
        return announcements;
    }

    async getAnnouncement(announcementId: string, actorId: string, actorRole: Role) {
        const announcement = await this.prisma.announcement.findUnique({
            where: { id: announcementId },
            include: {
                author: { select: { id: true, email: true, role: true, metadata: true } },
                opening: { select: { id: true, instructorId: true } },
            },
        });
        if (!announcement) throw new NotFoundException('Announcement not found');

        const isStaff = actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER ||
            actorRole === Role.INSTRUCTOR;
        const isStudent = actorRole === Role.STUDENT;

        if (actorRole === Role.INSTRUCTOR) {
            await this.assertCanManageOpening(announcement.opening.id, actorId, actorRole);
        }
        if (!isStaff && !isStudent) {
            throw new ForbiddenException('Not allowed to view this announcement');
        }
        if (isStudent && !announcement.isPublished) {
            throw new NotFoundException('Announcement not found');
        }

        if (isStudent) {
            return {
                ...announcement,
                author: announcement.author
                    ? { id: announcement.author.id, ...getUserDisplayNames(announcement.author) }
                    : null,
            };
        }
        return announcement;
    }

    async updateAnnouncement(announcementId: string, dto: {
        titleAr?: string;
        titleEn?: string;
        contentAr?: string;
        contentEn?: string;
        isPublished?: boolean;
    }, actorId: string, actorRole: Role) {
        const announcement = await this.prisma.announcement.findUnique({
            where: { id: announcementId },
            include: { opening: { select: { id: true, instructorId: true } } },
        });
        if (!announcement) throw new NotFoundException('Announcement not found');

        const isStaff = actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER;
        if (actorRole === Role.INSTRUCTOR) {
            await this.assertCanManageOpening(announcement.opening.id, actorId, actorRole);
        }
        const isInstructor = actorRole === Role.INSTRUCTOR;
        if (!isStaff && !isInstructor) {
            throw new ForbiddenException('You are not allowed to update this announcement');
        }

        const updated = await this.prisma.announcement.update({
            where: { id: announcementId },
            data: {
                titleAr: dto.titleAr?.trim() ?? announcement.titleAr,
                titleEn: dto.titleEn?.trim() ?? announcement.titleEn,
                contentAr: dto.contentAr?.trim() ?? announcement.contentAr,
                contentEn: dto.contentEn?.trim() ?? announcement.contentEn,
                isPublished: dto.isPublished ?? announcement.isPublished,
            },
        });
        await this.audit.logAction(`Updated announcement ${announcementId}`, undefined, actorId);
        return updated;
    }

    async deleteAnnouncement(announcementId: string, actorId: string, actorRole: Role) {
        const announcement = await this.prisma.announcement.findUnique({
            where: { id: announcementId },
            include: { opening: { select: { id: true, instructorId: true } } },
        });
        if (!announcement) throw new NotFoundException('Announcement not found');

        const isStaff = actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER;
        if (actorRole === Role.INSTRUCTOR) {
            await this.assertCanManageOpening(announcement.opening.id, actorId, actorRole);
        }
        const isInstructor = actorRole === Role.INSTRUCTOR;
        if (!isStaff && !isInstructor) {
            throw new ForbiddenException('You are not allowed to delete this announcement');
        }

        await this.audit.logAction(`Deleted announcement ${announcementId} (Opening ${announcement.openingId})`, undefined, actorId);
        return this.prisma.announcement.delete({ where: { id: announcementId } });
    }

    async togglePublish(announcementId: string, actorId: string, actorRole: Role) {
        const announcement = await this.prisma.announcement.findUnique({
            where: { id: announcementId },
            include: { opening: { select: { id: true, instructorId: true } } },
        });
        if (!announcement) throw new NotFoundException('Announcement not found');

        const isStaff = actorRole === Role.ADMIN || actorRole === Role.COURSE_MANAGER;
        if (actorRole === Role.INSTRUCTOR) {
            await this.assertCanManageOpening(announcement.opening.id, actorId, actorRole);
        }
        const isInstructor = actorRole === Role.INSTRUCTOR;
        if (!isStaff && !isInstructor) {
            throw new ForbiddenException('You are not allowed to update this announcement');
        }

        const updated = await this.prisma.announcement.update({
            where: { id: announcementId },
            data: { isPublished: !announcement.isPublished },
        });
        await this.audit.logAction(`Toggled publish for announcement ${announcementId} to ${updated.isPublished}`, undefined, actorId);
        return updated;
    }
}
