import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../encryption/encryption.service';
import { EnrollmentStatus, Prisma, Role, StudentMessageRequestStatus } from '@prisma/client';
import { toPublicInstructor } from '../common/public-instructor';
import { getUserDisplayNames } from '../common/user-display-name';

@Injectable()
export class MessagesService {
    constructor(
        private prisma: PrismaService,
        private encryption: EncryptionService,
    ) { }

    private async getCourseOrThrow(courseId: string) {
        const course = await this.prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundException('Course not found');
        return course;
    }

    private async isEnrolled(studentId: string, courseId: string) {
        const enrollment = await this.prisma.enrollment.findUnique({
            where: { studentId_courseId: { studentId, courseId } },
        });
        return !!enrollment;
    }

    private inboxNames(user: { role: Role; metadata?: unknown }): { nameAr: string | null; nameEn: string | null } {
        return getUserDisplayNames(user);
    }

    private safeContact(user: { id: string; role: Role; metadata?: unknown }) {
        const names = this.inboxNames(user);
        return {
            id: user.id,
            role: user.role,
            nameAr: user.role === Role.ADMIN ? 'المدير' : names.nameAr,
            nameEn: user.role === Role.ADMIN ? 'Manager' : names.nameEn,
        };
    }

    private async getActiveAdminIds() {
        const admins = await this.prisma.user.findMany({
            where: { role: Role.ADMIN, isActive: true },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
        });
        return admins.map((admin) => admin.id);
    }

    private async hasAcceptedEnrollment(userId: string, openingId: string) {
        return this.prisma.enrollment.findFirst({
            where: {
                studentId: userId,
                openingId,
                status: { in: [EnrollmentStatus.APPROVED, EnrollmentStatus.RESERVED] },
            },
            select: { id: true },
        });
    }

    private async hasApprovedPeerRequest(openingId: string, firstId: string, secondId: string) {
        return this.prisma.studentMessageRequest.findFirst({
            where: {
                openingId,
                status: StudentMessageRequestStatus.APPROVED,
                OR: [
                    { requesterId: firstId, recipientId: secondId },
                    { requesterId: secondId, recipientId: firstId },
                ],
            },
            select: { id: true },
        });
    }

    private async validateSend(
        user: { userId: string; role: Role },
        recipientId: string,
        courseId?: string,
        openingId?: string,
    ) {
        if (!recipientId) throw new BadRequestException('recipientId is required');
        if (recipientId === user.userId) throw new BadRequestException('Cannot message yourself');

        const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
        if (!recipient) throw new NotFoundException('Recipient not found');

        if (courseId) {
            const course = await this.getCourseOrThrow(courseId);
            if (user.role === Role.STUDENT) {
                if (recipient.role === Role.STUDENT) {
                    if (!openingId) throw new BadRequestException('Opening is required for student-to-student messages');
                    const opening = await this.prisma.courseOpening.findFirst({
                        where: { id: openingId, courseId, archivedAt: null },
                        select: { id: true },
                    });
                    if (!opening) throw new ForbiddenException('Opening does not belong to this course');
                    const [senderEnrollment, recipientEnrollment, approvedRequest] = await Promise.all([
                        this.hasAcceptedEnrollment(user.userId, openingId),
                        this.hasAcceptedEnrollment(recipient.id, openingId),
                        this.hasApprovedPeerRequest(openingId, user.userId, recipient.id),
                    ]);
                    if (!senderEnrollment || !recipientEnrollment) {
                        throw new ForbiddenException('Both students must be enrolled in the same opening');
                    }
                    if (!approvedRequest) throw new ForbiddenException('Student messaging requires an approved request');
                } else {
                    const enrollment = openingId
                        ? await this.hasAcceptedEnrollment(user.userId, openingId)
                        : await this.isEnrolled(user.userId, courseId);
                    if (!enrollment) throw new ForbiddenException('You are not enrolled in this course');
                    if (openingId) {
                        const opening = await this.prisma.courseOpening.findFirst({
                            where: { id: openingId, courseId, instructorId: recipient.id, archivedAt: null },
                            select: { id: true },
                        });
                        if (!opening || recipient.role !== Role.INSTRUCTOR) {
                            throw new ForbiddenException('Recipient is not the instructor of your opening');
                        }
                    } else if (recipient.id !== course.instructorId || recipient.role !== Role.INSTRUCTOR) {
                        throw new ForbiddenException('Students can only message their course instructor');
                    }
                }
            } else if (user.role === Role.INSTRUCTOR) {
                if (recipient.role === Role.ADMIN) return recipient;
                if (recipient.role !== Role.STUDENT || !openingId) {
                    throw new ForbiddenException('Instructors can only message their assigned students or platform admins');
                }
                const opening = await this.prisma.courseOpening.findFirst({
                    where: { id: openingId, courseId, instructorId: user.userId, archivedAt: null },
                    select: { id: true },
                });
                if (!opening || !(await this.hasAcceptedEnrollment(recipient.id, openingId))) {
                    throw new ForbiddenException('Student is not enrolled in your opening');
                }
            }
            return recipient;
        }

        // Direct (non course) threads:
        // - STUDENT -> only platform admins (support)
        if (user.role === Role.STUDENT && recipient.role !== Role.ADMIN) {
            throw new ForbiddenException('Students can only message platform admins for support');
        }
        return recipient;
    }

    async send(user: { userId: string; role: Role }, dto: { recipientId: string; courseId?: string; openingId?: string; content: string }) {
        if (!dto.content || !dto.content.trim()) {
            throw new BadRequestException('Message content is required');
        }
        const recipient = await this.validateSend(user, dto.recipientId, dto.courseId, dto.openingId);
        const message = await this.prisma.message.create({
            data: {
                senderId: user.userId,
                recipientId: dto.recipientId,
                courseId: dto.courseId ?? null,
                openingId: dto.openingId ?? null,
                content: this.encryption.encrypt(dto.content.trim()),
            },
            include: {
                sender: { select: { id: true, role: true, metadata: true } },
                recipient: { select: { id: true, role: true, metadata: true } },
            },
        });
        return {
            ...message,
            sender: this.safeContact(message.sender),
            recipient: this.safeContact(message.recipient),
            content: this.encryption.tryDecrypt(message.content),
        };
    }

    async getConversations(user: { userId: string; role: Role }) {
        const adminIds = user.role === Role.ADMIN ? await this.getActiveAdminIds() : [];
        const where: Prisma.MessageWhereInput = user.role === Role.ADMIN
            ? { OR: [{ senderId: { in: adminIds } }, { recipientId: { in: adminIds } }] }
            : { OR: [{ senderId: user.userId }, { recipientId: user.userId }] };
        const messages = await this.prisma.message.findMany({
            where,
            include: {
                sender: { select: { id: true, role: true, metadata: true } },
                recipient: { select: { id: true, role: true, metadata: true } },
                course: { select: { id: true, titleAr: true, titleEn: true } },
                opening: { select: { id: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
        const sharedMessages = user.role === Role.ADMIN
            ? messages.filter((message) => message.sender.role !== Role.ADMIN || message.recipient.role !== Role.ADMIN)
            : messages;
        const hasDirectAdminMessages = user.role !== Role.ADMIN && sharedMessages.some((message) =>
            !message.courseId && !message.openingId
            && (message.sender.role === Role.ADMIN || message.recipient.role === Role.ADMIN),
        );
        const managerContact = hasDirectAdminMessages ? (await this.getSupportAdmins())[0] : undefined;
        const managerId = managerContact?.id;

        const groups = new Map<string, typeof sharedMessages>();
        for (const m of sharedMessages) {
            const other = user.role === Role.ADMIN
                ? (m.sender.role === Role.ADMIN ? m.recipient : m.sender)
                : (m.senderId === user.userId ? m.recipient : m.sender);
            const isDirectManagerThread = user.role !== Role.ADMIN
                && other.role === Role.ADMIN
                && !m.courseId
                && !m.openingId;
            const otherId = isDirectManagerThread
                ? managerId ?? other.id
                : other.id;
            const key = `${otherId}|${m.courseId ?? ''}|${m.openingId ?? ''}`;
            const list = groups.get(key) ?? [];
            list.push(m);
            groups.set(key, list);
        }

        const conversations = Array.from(groups.entries()).map(([key, msgs]) => {
            const last = msgs[msgs.length - 1];
            const other = user.role === Role.ADMIN
                ? (last.sender.role === Role.ADMIN ? last.recipient : last.sender)
                : (last.senderId === user.userId ? last.recipient : last.sender);
            const otherContact = user.role !== Role.ADMIN
                && other.role === Role.ADMIN
                && !last.courseId
                && !last.openingId
                ? (managerContact ?? this.safeContact(other))
                : this.safeContact(other);
            const unreadCount = msgs.filter((m) =>
                (user.role === Role.ADMIN ? adminIds.includes(m.recipientId) : m.recipientId === user.userId)
                && !m.readAt,
            ).length;
            return {
                id: key,
                otherUser: otherContact,
                course: last.course
                    ? { id: last.course.id, titleAr: last.course.titleAr, titleEn: last.course.titleEn }
                    : null,
                opening: last.opening,
                lastMessage: {
                    content: this.encryption.tryDecrypt(last.content),
                    createdAt: last.createdAt,
                    fromMe: last.senderId === user.userId,
                    read: !!last.readAt,
                },
                unreadCount,
                updatedAt: last.createdAt,
            };
        });

        conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return conversations;
    }

    async getThread(user: { userId: string; role: Role }, otherId: string, courseId?: string, openingId?: string) {
        if (!otherId) throw new BadRequestException('with (userId) is required');
        const otherUser = await this.validateSend(user, otherId, courseId, openingId);
        const isSharedManagerThread = !courseId && !openingId
            && ((user.role === Role.ADMIN && otherUser.role !== Role.ADMIN)
                || (user.role !== Role.ADMIN && otherUser.role === Role.ADMIN));
        const adminIds = isSharedManagerThread ? await this.getActiveAdminIds() : [];
        const participantId = user.role === Role.ADMIN ? otherId : user.userId;
        const where: Prisma.MessageWhereInput = isSharedManagerThread
            ? {
                OR: [
                    { senderId: participantId, recipientId: { in: adminIds } },
                    { senderId: { in: adminIds }, recipientId: participantId },
                ],
            }
            : {
                OR: [
                    { senderId: user.userId, recipientId: otherId },
                    { senderId: otherId, recipientId: user.userId },
                ],
            };
        if (courseId) {
            where.courseId = courseId;
            await this.getCourseOrThrow(courseId);
        }
        if (openingId) where.openingId = openingId;
        return this.prisma.message.findMany({
            where,
            include: {
                sender: { select: { id: true, role: true, metadata: true } },
            },
            orderBy: { createdAt: 'asc' },
        }).then((messages) => messages.map((m) => ({
            ...m,
            sender: this.safeContact(m.sender),
            content: this.encryption.tryDecrypt(m.content),
        })));
    }

    async markRead(user: { userId: string; role: Role }, otherId: string, courseId?: string, openingId?: string) {
        if (!otherId) throw new BadRequestException('with (userId) is required');
        const otherUser = await this.validateSend(user, otherId, courseId, openingId);
        const isSharedManagerThread = !courseId && !openingId
            && ((user.role === Role.ADMIN && otherUser.role !== Role.ADMIN)
                || (user.role !== Role.ADMIN && otherUser.role === Role.ADMIN));
        const adminIds = isSharedManagerThread ? await this.getActiveAdminIds() : [];
        const where: Prisma.MessageWhereInput = isSharedManagerThread
            ? user.role === Role.ADMIN
                ? { senderId: otherId, recipientId: { in: adminIds }, readAt: null }
                : { senderId: { in: adminIds }, recipientId: user.userId, readAt: null }
            : { senderId: otherId, recipientId: user.userId, readAt: null };
        if (courseId) where.courseId = courseId;
        if (openingId) where.openingId = openingId;
        const result = await this.prisma.message.updateMany({
            where,
            data: { readAt: new Date() },
        });
        return { updated: result.count };
    }

    async getUnreadCount(user: { userId: string; role: Role }) {
        const adminIds = user.role === Role.ADMIN ? await this.getActiveAdminIds() : [];
        const count = await this.prisma.message.count({
            where: {
                recipientId: user.role === Role.ADMIN ? { in: adminIds } : user.userId,
                readAt: null,
            },
        });
        return { count };
    }

    async getSupportAdmins() {
        const admins = await this.prisma.user.findMany({
            where: { role: Role.ADMIN, isActive: true },
            select: { id: true, role: true, metadata: true },
            orderBy: { createdAt: 'asc' },
        });
        return admins.slice(0, 1).map((admin) => this.safeContact(admin));
    }

    async getContacts(user: { userId: string; role: Role }) {
        const admins = user.role === Role.ADMIN ? [] : await this.getSupportAdmins();
        const accepted = [EnrollmentStatus.APPROVED, EnrollmentStatus.RESERVED];

        if (user.role === Role.STUDENT) {
            const enrollments = await this.prisma.enrollment.findMany({
                where: { studentId: user.userId, status: { in: accepted } },
                include: {
                    course: {
                        select: {
                            id: true,
                            titleAr: true,
                            titleEn: true,
                        },
                    },
                    opening: {
                        select: {
                            id: true,
                            instructor: { select: { id: true, role: true, metadata: true } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });
            const instructorsByKey = new Map<string, Record<string, unknown>>();
            const openingIds = enrollments.flatMap((enrollment) => enrollment.openingId ? [enrollment.openingId] : []);
            for (const enrollment of enrollments) {
                const instructor = enrollment.opening?.instructor;
                if (!enrollment.openingId || !instructor || instructor.role !== Role.INSTRUCTOR || instructor.id === user.userId) continue;
                const key = `${instructor.id}|${enrollment.courseId}|${enrollment.openingId}`;
                const publicInstructor = toPublicInstructor(instructor);
                instructorsByKey.set(key, {
                    id: instructor.id,
                    role: instructor.role,
                    nameAr: publicInstructor.nameAr,
                    nameEn: publicInstructor.nameEn,
                    course: { id: enrollment.course.id, titleAr: enrollment.course.titleAr, titleEn: enrollment.course.titleEn },
                    openingId: enrollment.openingId,
                });
            }

            const peers = openingIds.length > 0
                ? await this.prisma.enrollment.findMany({
                    where: {
                        openingId: { in: openingIds },
                        studentId: { not: user.userId },
                        status: { in: accepted },
                    },
                    include: {
                        student: { select: { id: true, role: true, metadata: true } },
                        course: { select: { id: true, titleAr: true, titleEn: true } },
                    },
                    orderBy: { createdAt: 'asc' },
                })
                : [];
            const requests = openingIds.length > 0
                ? await this.prisma.studentMessageRequest.findMany({
                    where: {
                        openingId: { in: openingIds },
                        OR: [{ requesterId: user.userId }, { recipientId: user.userId }],
                    },
                    select: { id: true, openingId: true, requesterId: true, recipientId: true, status: true, updatedAt: true },
                })
                : [];
            const peerContacts = peers.map((enrollment) => {
                const matchingRequests = requests.filter((candidate) =>
                    candidate.openingId === enrollment.openingId
                    && ((candidate.requesterId === user.userId && candidate.recipientId === enrollment.studentId)
                        || (candidate.requesterId === enrollment.studentId && candidate.recipientId === user.userId)),
                );
                matchingRequests.sort((left, right) => {
                    const priority = (status: StudentMessageRequestStatus) =>
                        status === StudentMessageRequestStatus.PENDING ? 2 : status === StudentMessageRequestStatus.APPROVED ? 1 : 0;
                    return priority(right.status) - priority(left.status) || right.updatedAt.getTime() - left.updatedAt.getTime();
                });
                const request = matchingRequests[0];
                const direction = request
                    ? request.requesterId === user.userId ? 'OUTGOING' : 'INCOMING'
                    : null;
                return {
                    ...this.safeContact(enrollment.student),
                    course: { id: enrollment.course.id, titleAr: enrollment.course.titleAr, titleEn: enrollment.course.titleEn },
                    openingId: enrollment.openingId,
                    requestId: request?.id ?? null,
                    requestStatus: request?.status ?? null,
                    requestDirection: direction,
                };
            });
            const uniquePeers = Array.from(new Map(
                peerContacts.map((contact) => [`${contact.id}|${contact.openingId}`, contact]),
            ).values());
            return { admins, instructors: [...instructorsByKey.values()], students: uniquePeers };
        }

        if (user.role === Role.INSTRUCTOR) {
            const openings = await this.prisma.courseOpening.findMany({
                where: { instructorId: user.userId, archivedAt: null },
                select: {
                    id: true,
                    course: { select: { id: true, titleAr: true, titleEn: true } },
                    enrollments: {
                        where: { status: { in: accepted } },
                        select: { student: { select: { id: true, role: true, metadata: true } } },
                    },
                },
            });
            const students = Array.from(new Map(openings.flatMap((opening) =>
                opening.enrollments.map(({ student }) => [`${student.id}|${opening.id}`, {
                    ...this.safeContact(student),
                    course: opening.course,
                    openingId: opening.id,
                }]),
            )).values());
            return { admins, instructors: [], students };
        }

        const userRows = await this.prisma.user.findMany({
            where: { role: Role.STUDENT, isActive: true },
            select: { id: true, role: true, metadata: true },
            orderBy: { createdAt: 'asc' },
        });
        const students = userRows.map((student) => this.safeContact(student));
        return { admins, instructors: [], students };
    }

    async createStudentMessageRequest(user: { userId: string; role: Role }, recipientId: string, openingId: string) {
        if (user.role !== Role.STUDENT) throw new ForbiddenException('Only students can request peer messaging');
        if (!recipientId || !openingId) throw new BadRequestException('recipientId and openingId are required');
        if (recipientId === user.userId) throw new BadRequestException('Cannot request a conversation with yourself');

        const opening = await this.prisma.courseOpening.findFirst({
            where: { id: openingId, archivedAt: null },
            select: { id: true },
        });
        if (!opening) throw new NotFoundException('Opening not found');
        const [requesterEnrollment, recipientEnrollment, recipient] = await Promise.all([
            this.hasAcceptedEnrollment(user.userId, openingId),
            this.hasAcceptedEnrollment(recipientId, openingId),
            this.prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, role: true } }),
        ]);
        if (!requesterEnrollment || !recipientEnrollment || recipient?.role !== Role.STUDENT) {
            throw new ForbiddenException('Both students must be enrolled in the same opening');
        }

        const activeRequest = await this.prisma.studentMessageRequest.findFirst({
            where: {
                openingId,
                status: { in: [StudentMessageRequestStatus.PENDING, StudentMessageRequestStatus.APPROVED] },
                OR: [
                    { requesterId: user.userId, recipientId },
                    { requesterId: recipientId, recipientId: user.userId },
                ],
            },
        });
        if (activeRequest) return activeRequest;

        const previous = await this.prisma.studentMessageRequest.findUnique({
            where: { openingId_requesterId_recipientId: { openingId, requesterId: user.userId, recipientId } },
        });
        return previous
            ? this.prisma.studentMessageRequest.update({
                where: { id: previous.id },
                data: { status: StudentMessageRequestStatus.PENDING },
            })
            : this.prisma.studentMessageRequest.create({
                data: { openingId, requesterId: user.userId, recipientId },
            });
    }

    async getStudentMessageRequests(user: { userId: string; role: Role }) {
        if (user.role !== Role.STUDENT) return [];
        const rows = await this.prisma.studentMessageRequest.findMany({
            where: {
                status: StudentMessageRequestStatus.PENDING,
                OR: [{ requesterId: user.userId }, { recipientId: user.userId }],
            },
            include: {
                requester: { select: { id: true, role: true, metadata: true } },
                recipient: { select: { id: true, role: true, metadata: true } },
                opening: {
                    select: {
                        id: true,
                        course: { select: { id: true, titleAr: true, titleEn: true } },
                        enrollments: {
                            where: { status: { in: [EnrollmentStatus.APPROVED, EnrollmentStatus.RESERVED] } },
                            select: { studentId: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return rows
            .filter((request) => {
                const enrolledIds = new Set(request.opening.enrollments.map((enrollment) => enrollment.studentId));
                return enrolledIds.has(request.requesterId) && enrolledIds.has(request.recipientId);
            })
            .map((request) => ({
            id: request.id,
            status: request.status,
            incoming: request.recipientId === user.userId,
            otherUser: this.safeContact(request.recipientId === user.userId ? request.requester : request.recipient),
            course: request.opening.course,
            openingId: request.openingId,
            createdAt: request.createdAt,
            }));
    }

    async respondToStudentMessageRequest(user: { userId: string; role: Role }, requestId: string, approved: boolean) {
        if (user.role !== Role.STUDENT) throw new ForbiddenException('Only students can respond to peer messaging requests');
        const request = await this.prisma.studentMessageRequest.findUnique({ where: { id: requestId } });
        if (!request || request.recipientId !== user.userId) throw new NotFoundException('Message request not found');
        if (request.status !== StudentMessageRequestStatus.PENDING) throw new BadRequestException('Message request has already been answered');
        const [recipientEnrollment, requesterEnrollment] = await Promise.all([
            this.hasAcceptedEnrollment(request.recipientId, request.openingId),
            this.hasAcceptedEnrollment(request.requesterId, request.openingId),
        ]);
        if (!recipientEnrollment || !requesterEnrollment) {
            throw new ForbiddenException('Both students must remain enrolled in the same opening');
        }
        const result = await this.prisma.studentMessageRequest.updateMany({
            where: { id: requestId, recipientId: user.userId, status: StudentMessageRequestStatus.PENDING },
            data: { status: approved ? StudentMessageRequestStatus.APPROVED : StudentMessageRequestStatus.REJECTED },
        });
        if (result.count !== 1) throw new BadRequestException('Message request has already been answered');
        return { ok: true, status: approved ? StudentMessageRequestStatus.APPROVED : StudentMessageRequestStatus.REJECTED };
    }

    async cancelStudentMessageRequest(user: { userId: string; role: Role }, requestId: string) {
        if (user.role !== Role.STUDENT) throw new ForbiddenException('Only students can cancel peer messaging requests');
        const request = await this.prisma.studentMessageRequest.findUnique({ where: { id: requestId } });
        if (!request || request.requesterId !== user.userId) throw new NotFoundException('Message request not found');
        if (request.status !== StudentMessageRequestStatus.PENDING) {
            throw new BadRequestException('Only pending message requests can be cancelled');
        }
        const result = await this.prisma.studentMessageRequest.updateMany({
            where: {
                id: requestId,
                requesterId: user.userId,
                status: StudentMessageRequestStatus.PENDING,
            },
            data: { status: StudentMessageRequestStatus.CANCELLED },
        });
        if (result.count !== 1) throw new BadRequestException('Message request has already been answered');
        return { ok: true, status: StudentMessageRequestStatus.CANCELLED };
    }
}
