import { Controller, Get, Param, Post, Body, Ip, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { ContactMethod } from '@prisma/client';
import { publicInstructorSelect, publicInstructorWhere, toPublicInstructor } from '../common/public-instructor';

/**
 * Fields of a lesson that are safe to expose in the public catalogue: enough to
 * render a syllabus preview -- the lesson's own description and the topics it
 * covers -- and nothing that reveals the locked content itself.
 */
const OUTLINE_LESSON_SELECT = {
    id: true,
    titleAr: true,
    titleEn: true,
    descriptionAr: true,
    descriptionEn: true,
    orderIndex: true,
    durationMinutes: true,
    outcomes: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, descriptionAr: true, descriptionEn: true },
    },
} as const;

@ApiTags('Public')
@Controller('public')
export class PublicController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly email: EmailService,
    ) {}

    @ApiOperation({ summary: 'Public site statistics (aggregate, privacy-safe)' })
    @Get('stats')
    async stats() {
        const [courses, instructors, enrollments, certificates] = await Promise.all([
            this.prisma.course.count({
                where: {
                    archivedAt: null,
                    openings: {
                        some: {
                            archivedAt: null,
                            isPublished: true,
                            status: { in: ['OPEN', 'ANNOUNCEMENT', 'STARTED', 'ENDED'] },
                        },
                    },
                },
            }),
            this.prisma.user.count({ where: publicInstructorWhere(true) }),
            this.prisma.enrollment.count({ where: { status: 'APPROVED' } }),
            this.prisma.certificate.count({ where: { verificationStatus: 'VALID' } }),
        ]);
        return { courses, instructors, enrollments, certificates };
    }

    @ApiOperation({ summary: 'Public list of active instructors with public stats' })
    @Get('instructors')
    async instructors() {
        const users = await this.prisma.user.findMany({
            where: publicInstructorWhere(true),
            select: {
                ...publicInstructorSelect,
                _count: { select: { coursesTaught: true, openingsTaught: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
        return users.map((u) => ({
            ...toPublicInstructor(u),
            courseCount: u._count.coursesTaught,
            openingCount: u._count.openingsTaught,
        }));
    }

    @ApiOperation({ summary: 'Public instructor profile with their courses' })
    @Get('instructors/:id')
    async instructor(@Param('id') id: string) {
        const user = await this.prisma.user.findFirst({
            where: { AND: [{ id }, publicInstructorWhere(false)] },
            select: {
                ...publicInstructorSelect,
                coursesTaught: {
                    select: {
                        id: true,
                        titleAr: true,
                        titleEn: true,
                        excerptAr: true,
                        excerptEn: true,
                        coverImageUrl: true,
                        categoryAr: true,
                        categoryEn: true,
                        level: true,
                        createdAt: true,
                        openings: {
                            where: { status: { in: ['OPEN', 'ANNOUNCEMENT'] } },
                            select: { id: true, price: true, priceOld: true, currency: true, status: true },
                        },
                        _count: { select: { enrollments: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                },
                // A teacher who only ever runs batches owns no Course row, so the
                // profile rendered "0 courses" and an empty list next to a CV
                // they had filled in. Count the batches too.
                openingsTaught: {
                    where: { status: { in: ['OPEN', 'ANNOUNCEMENT'] } },
                    select: {
                        id: true,
                        nameAr: true,
                        nameEn: true,
                        startDate: true,
                        endDate: true,
                        price: true,
                        priceOld: true,
                        status: true,
                        course: {
                            select: {
                                id: true,
                                titleAr: true,
                                titleEn: true,
                                coverImageUrl: true,
                                excerptAr: true,
                                excerptEn: true,
                                categoryAr: true,
                                categoryEn: true,
                                level: true,
                            },
                        },
                        _count: { select: { enrollments: true } },
                    },
                    orderBy: { startDate: 'desc' },
                },
            },
        });
        if (!user) throw new NotFoundException('Instructor not found');
        const { coursesTaught, openingsTaught, ...rest } = user;
        return {
            ...toPublicInstructor(user),
            courseCount: coursesTaught.length,
            openingCount: openingsTaught.length,
            courses: coursesTaught,
            openings: openingsTaught,
        };
    }

    @ApiOperation({ summary: 'Public catalogue of courses with at least one published opening' })
    @Get('courses')
    async courses() {
        const courses = await this.prisma.course.findMany({
            where: {
                archivedAt: null,
                openings: {
                    some: {
                        archivedAt: null,
                        isPublished: true,
                        status: { in: ['OPEN', 'ANNOUNCEMENT', 'STARTED', 'ENDED'] },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            include: {
                instructor: { select: publicInstructorSelect },
                openings: {
                    where: {
                        archivedAt: null,
                        isPublished: true,
                        status: { in: ['OPEN', 'ANNOUNCEMENT', 'STARTED', 'ENDED'] },
                    },
                    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
                    select: {
                        id: true,
                        status: true,
                        price: true,
                        priceOld: true,
                        currency: true,
                        nameAr: true,
                        nameEn: true,
                        startDate: true,
                        endDate: true,
                        enrollmentDeadline: true,
                        announcementStartAt: true,
                        announcementEndAt: true,
                        maxStudents: true,
                        instructor: { select: publicInstructorSelect },
                        _count: { select: { enrollments: true } },
                    },
                },
                _count: {
                    select: {
                        enrollments: true,
                        modules: { where: { openingId: null } },
                    },
                },
                chapters: {
                    where: { openingId: null },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        id: true,
                        titleAr: true,
                        titleEn: true,
                        orderIndex: true,
                        modules: {
                            where: { openingId: null },
                            orderBy: { orderIndex: 'asc' },
                            select: OUTLINE_LESSON_SELECT,
                        },
                    },
                },
                modules: {
                    where: { openingId: null },
                    orderBy: { orderIndex: 'asc' },
                    select: OUTLINE_LESSON_SELECT,
                },
            },
        });

        // Rating aggregate for the card ("★ 4.8 · 120 student"). Grouped in a
        // second query rather than `include`d, so the payload does not carry one
        // row per review for every listed course.
        const ids = courses.map((c) => c.id);
        const ratingRows = ids.length
            ? await this.prisma.courseReview.groupBy({
                by: ['courseId'],
                where: { courseId: { in: ids }, isPublished: true },
                _avg: { rating: true },
                _count: { _all: true },
            })
            : [];
        const ratingByCourse = new Map(
            ratingRows.map((r) => [
                r.courseId,
                {
                    averageRating: Number((r._avg.rating ?? 0).toFixed(2)),
                    reviewCount: r._count._all,
                },
            ]),
        );

        return courses.map((course) => ({
            ...course,
            ...(ratingByCourse.get(course.id) ?? { averageRating: 0, reviewCount: 0 }),
            // Normalised syllabus preview for the public catalogue: one entry per
            // chapter, or a single untitled chapter for courses that keep their
            // lessons flat. Titles, descriptions and topics are exposed so a
            // visitor can judge the course before enrolling -- never the lesson
            // body, files, links or the locked video URLs.
            outline: course.chapters.length > 0
                ? course.chapters.map((chapter) => ({
                    id: chapter.id,
                    titleAr: chapter.titleAr,
                    titleEn: chapter.titleEn,
                    lessons: chapter.modules,
                }))
                : course.modules.length > 0
                    ? [{ id: null, titleAr: null, titleEn: null, lessons: course.modules }]
                    : [],
            openings: course.openings.map((opening) => ({
                ...opening,
                instructor: opening.instructor
                    ? toPublicInstructor(opening.instructor)
                    : null,
            })),
        }))
            .map((course) => {
                // Course ownership fields are internal; keep only what the public
                // needs. `instructor` is rebuilt from metadata so the email that
                // the select above still pulled in cannot reach the client.
                const { instructorId, chapters, modules, instructor, ...rest } = course;
                return {
                    ...rest,
                    instructor: instructor ? toPublicInstructor(instructor) : null,
                };
            });
    }

    @ApiOperation({ summary: 'Submit a contact message' })
    @Post('contact')
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    async contact(
        @Body() body: { name?: string; email?: string; phone?: string; contactMethod?: string; subject?: string; message?: string },
        @Ip() ip: string,
    ) {
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
        const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 30) : '';
        const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 4000) : '';
        const contactMethod = body?.contactMethod === 'phone'
            ? 'phone'
            : body?.contactMethod === 'email'
                ? 'email'
                : email ? 'email' : 'phone';
        const contactValue = contactMethod === 'email' ? email : phone;
        const isValidEmail = contactMethod === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        const phoneDigits = phone.replace(/\D/g, '');
        const isValidPhone = contactMethod === 'phone' && /^[+\d\s().-]+$/.test(phone) && phoneDigits.length >= 7 && phoneDigits.length <= 15;
        if ((!isValidEmail && !isValidPhone) || !message) {
            throw new BadRequestException('A valid email or phone number and message are required');
        }
        const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : '';
        const subject = typeof body?.subject === 'string' ? body.subject.trim().slice(0, 200) : '';
        const submission = await this.prisma.contactSubmission.create({
            data: {
                name: name || null,
                email: contactMethod === 'email' ? email : null,
                phone: contactMethod === 'phone' ? phone : null,
                contactMethod: contactMethod === 'email' ? ContactMethod.EMAIL : ContactMethod.PHONE,
                subject,
                message,
            },
        });
        await this.audit.logAction(`Contact form submission via ${contactMethod}`, ip);
        await this.email.sendContactEmail(contactValue, contactMethod, name, subject, message);
        return { ok: true, id: submission.id };
    }
}