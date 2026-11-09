import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '@prisma/client';

@Injectable()
export class CalendarService {
    constructor(private prisma: PrismaService, private audit: AuditService) {}

    async createEvent(openingId: string, dto: { titleAr: string; titleEn: string; descriptionAr?: string; descriptionEn?: string; startsAt: string; endsAt: string; eventType?: string }, userId: string, userRole: Role) {
        const opening = await this.prisma.courseOpening.findUnique({ where: { id: openingId } });
        if (!opening) throw new NotFoundException('Opening not found');
        if (userRole === Role.INSTRUCTOR && opening.instructorId !== userId) throw new ForbiddenException('Not your opening');
        if (!dto.titleAr?.trim() || !dto.startsAt || !dto.endsAt) throw new BadRequestException('title and dates are required');
        const event = await this.prisma.calendarEvent.create({
            data: {
                openingId,
                titleAr: dto.titleAr.trim(),
                titleEn: (dto.titleEn || dto.titleAr).trim(),
                descriptionAr: dto.descriptionAr || null,
                descriptionEn: dto.descriptionEn || null,
                startsAt: new Date(dto.startsAt),
                endsAt: new Date(dto.endsAt),
                eventType: dto.eventType || 'deadline',
            },
        });
        await this.audit.logAction(`Created calendar event "${dto.titleAr}" for opening ${openingId}`, undefined, userId);
        return event;
    }

    async listEventsForOpening(openingId: string) {
        return this.prisma.calendarEvent.findMany({
            where: { openingId },
            orderBy: { startsAt: 'asc' },
        });
    }

    async listMyEvents(userId: string) {
        const enrollments = await this.prisma.enrollment.findMany({
            where: { studentId: userId, status: { in: ['APPROVED', 'PENDING', 'RESERVED'] } },
            select: { openingId: true },
        });
        const openingIds = enrollments.map(e => e.openingId).filter((id): id is string => id !== null);
        return this.prisma.calendarEvent.findMany({
            where: { openingId: { in: openingIds } },
            orderBy: { startsAt: 'asc' },
            include: { opening: { select: { id: true, nameAr: true, nameEn: true, course: { select: { titleAr: true, titleEn: true } } } } },
        });
    }

    async deleteEvent(eventId: string, userId: string, userRole: Role) {
        const event = await this.prisma.calendarEvent.findUnique({ where: { id: eventId } });
        if (!event) throw new NotFoundException('Event not found');
        if (userRole === Role.INSTRUCTOR && event.openingId) {
            const opening = await this.prisma.courseOpening.findUnique({ where: { id: event.openingId } });
            if (!opening || opening.instructorId !== userId) throw new ForbiddenException('Not allowed');
        } else if (userRole !== Role.ADMIN && userRole !== Role.COURSE_MANAGER) {
            throw new ForbiddenException('Not allowed');
        }
        await this.prisma.calendarEvent.delete({ where: { id: eventId } });
        return { ok: true };
    }
}
