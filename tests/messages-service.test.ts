import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { EnrollmentStatus, Role, StudentMessageRequestStatus } from '@prisma/client';
import { MessagesService } from '../src/messages/messages.service';

function makeService(options: { approvedRequest?: boolean; recipientEnrolled?: boolean } = {}) {
    let createdMessage: any;
    const prisma: any = {
        user: {
            findUnique: async () => ({ id: 'student-2', role: Role.STUDENT }),
        },
        course: {
            findUnique: async () => ({ id: 'course-1', instructorId: 'instructor-1' }),
        },
        courseOpening: {
            findFirst: async () => ({ id: 'opening-1', courseId: 'course-1' }),
        },
        enrollment: {
            findFirst: async ({ where }: any) => {
                if (where.studentId === 'student-2' && options.recipientEnrolled === false) return null;
                return { id: `enrollment-${where.studentId}`, status: EnrollmentStatus.APPROVED };
            },
        },
        studentMessageRequest: {
            findFirst: async () => options.approvedRequest
                ? { id: 'request-1', status: StudentMessageRequestStatus.APPROVED }
                : null,
        },
        message: {
            create: async ({ data }: any) => {
                createdMessage = data;
                return {
                    ...data,
                    id: 'message-1',
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                    readAt: null,
                    sender: { id: 'student-1', role: Role.STUDENT, metadata: { nameAr: 'الطالب الأول' } },
                    recipient: { id: 'student-2', role: Role.STUDENT, metadata: { nameEn: 'Student Two' } },
                };
            },
        },
    };
    const service = new MessagesService(
        prisma,
        { encrypt: (value: string) => `encrypted:${value}`, tryDecrypt: (value: string) => value.replace('encrypted:', '') } as any,
    );
    return { service, getCreatedMessage: () => createdMessage };
}

describe('student peer messaging', () => {
    const sender = { userId: 'student-1', role: Role.STUDENT };
    const message = {
        recipientId: 'student-2',
        courseId: 'course-1',
        openingId: 'opening-1',
        content: 'Hello',
    };

    test('a student cannot start a peer conversation without an approved request', async () => {
        const { service } = makeService();
        await assert.rejects(
            () => service.send(sender, message),
            (error: unknown) => error instanceof ForbiddenException,
        );
    });

    test('a request approval permits messaging only while both students belong to the same opening', async () => {
        const { service } = makeService({ approvedRequest: true });
        const result = await service.send(sender, message);
        assert.equal(result.content, 'Hello');
        assert.equal(result.sender.nameAr, 'الطالب الأول');
        assert.equal(result.recipient.nameEn, 'Student Two');
        assert.equal('email' in result.sender, false);
        assert.equal('email' in result.recipient, false);
        assert.equal(result.openingId, 'opening-1');
    });

    test('an approved request does not override a student leaving the opening', async () => {
        const { service } = makeService({ approvedRequest: true, recipientEnrolled: false });
        await assert.rejects(
            () => service.send(sender, message),
            (error: unknown) => error instanceof ForbiddenException,
        );
    });

    test('contacts show the assigned opening instructor and classmates by name without exposing emails', async () => {
        const prisma: any = {
            user: {
                findMany: async () => [{
                    id: 'admin-1',
                    role: Role.ADMIN,
                    metadata: { nameAr: 'مدير المنصة' },
                    email: 'admin@example.test',
                }],
            },
            enrollment: {
                findMany: async ({ where }: any) => where.studentId === 'student-1'
                    ? [{
                        studentId: 'student-1',
                        status: EnrollmentStatus.APPROVED,
                        courseId: 'course-1',
                        openingId: 'opening-1',
                        course: { id: 'course-1', titleAr: 'دورة', titleEn: 'Course' },
                        opening: {
                            id: 'opening-1',
                            instructor: {
                                id: 'instructor-1',
                                role: Role.INSTRUCTOR,
                                metadata: { fullName: 'Assigned Instructor' },
                                email: 'instructor@example.test',
                            },
                        },
                    }]
                    : [{
                        studentId: 'student-2',
                        openingId: 'opening-1',
                        status: EnrollmentStatus.APPROVED,
                        student: {
                            id: 'student-2',
                            role: Role.STUDENT,
                            metadata: { inboxDisplayName: 'Classmate', inboxUseOfficialName: false },
                            email: 'classmate@example.test',
                        },
                        course: { id: 'course-1', titleAr: 'دورة', titleEn: 'Course' },
                    }],
            },
            studentMessageRequest: {
                findMany: async () => [{
                    id: 'request-1',
                    openingId: 'opening-1',
                    requesterId: 'student-1',
                    recipientId: 'student-2',
                    status: StudentMessageRequestStatus.PENDING,
                    updatedAt: new Date('2026-01-01T00:00:00Z'),
                }],
            },
        };
        const service = new MessagesService(prisma, {} as any);
        const contacts = await service.getContacts(sender);

        assert.equal(contacts.admins[0].nameAr, 'المدير');
        assert.equal('email' in contacts.admins[0], false);
        assert.equal(contacts.instructors[0].nameEn, 'Assigned Instructor');
        assert.equal('email' in contacts.instructors[0], false);
        assert.equal(contacts.students[0].nameEn, 'Classmate');
        assert.equal(contacts.students[0].requestStatus, StudentMessageRequestStatus.PENDING);
        assert.equal(contacts.students[0].requestDirection, 'OUTGOING');
        assert.equal('email' in contacts.students[0], false);
    });

    test('students can create and the recipient can approve an opening-scoped request', async () => {
        let created: any;
        let updated: any;
        const requestRow = {
            id: 'request-1',
            openingId: 'opening-1',
            requesterId: 'student-1',
            recipientId: 'student-2',
            status: StudentMessageRequestStatus.PENDING,
        };
        let lookupCount = 0;
        const prisma: any = {
            courseOpening: { findFirst: async () => ({ id: 'opening-1' }) },
            enrollment: { findFirst: async () => ({ id: 'enrollment-1' }) },
            user: { findUnique: async () => ({ id: 'student-2', role: Role.STUDENT }) },
            studentMessageRequest: {
                findFirst: async () => null,
                findUnique: async () => {
                    lookupCount += 1;
                    return lookupCount === 1 ? null : requestRow;
                },
                create: async ({ data }: any) => {
                    created = data;
                    return requestRow;
                },
                updateMany: async ({ data }: any) => {
                    updated = data;
                    return { count: 1 };
                },
            },
        };
        const service = new MessagesService(prisma, {} as any);

        await service.createStudentMessageRequest(sender, 'student-2', 'opening-1');
        assert.deepEqual(created, {
            openingId: 'opening-1',
            requesterId: 'student-1',
            recipientId: 'student-2',
        });

        const response = await service.respondToStudentMessageRequest(
            { userId: 'student-2', role: Role.STUDENT },
            'request-1',
            true,
        );
        assert.equal(updated.status, StudentMessageRequestStatus.APPROVED);
        assert.deepEqual(response, { ok: true, status: StudentMessageRequestStatus.APPROVED });
    });

    test('a requester can cancel their own pending request', async () => {
        let updateArgs: any;
        const prisma: any = {
            studentMessageRequest: {
                findUnique: async () => ({
                    id: 'request-1',
                    requesterId: 'student-1',
                    status: StudentMessageRequestStatus.PENDING,
                }),
                updateMany: async (args: any) => {
                    updateArgs = args;
                    return { count: 1 };
                },
            },
        };
        const service = new MessagesService(prisma, {} as any);

        const result = await service.cancelStudentMessageRequest(sender, 'request-1');

        assert.deepEqual(updateArgs, {
            where: {
                id: 'request-1',
                requesterId: 'student-1',
                status: StudentMessageRequestStatus.PENDING,
            },
            data: { status: StudentMessageRequestStatus.CANCELLED },
        });
        assert.deepEqual(result, { ok: true, status: StudentMessageRequestStatus.CANCELLED });
    });

    test("a student cannot cancel another student's request", async () => {
        const prisma: any = {
            studentMessageRequest: {
                findUnique: async () => ({
                    id: 'request-1',
                    requesterId: 'student-2',
                    status: StudentMessageRequestStatus.PENDING,
                }),
            },
        };
        const service = new MessagesService(prisma, {} as any);

        await assert.rejects(
            () => service.cancelStudentMessageRequest(sender, 'request-1'),
            (error: unknown) => error instanceof Error && error.name === 'NotFoundException',
        );
    });
});

describe('shared manager inbox', () => {
    const admins = [{ id: 'admin-1' }, { id: 'admin-2' }];
    const student = {
        id: 'student-1',
        role: Role.STUDENT,
        metadata: { nameAr: 'الطالب' },
    };
    const admin = (id: string) => ({
        id,
        role: Role.ADMIN,
        metadata: { nameAr: 'مشرف' },
    });
    const adminRecords = [admin('admin-1'), admin('admin-2')];

    test('students see one manager contact and one conversation across admin replies', async () => {
        let adminLookups = 0;
        const messages = [
            {
                id: 'message-1',
                senderId: student.id,
                recipientId: 'admin-1',
                sender: student,
                recipient: admin('admin-1'),
                courseId: null,
                openingId: null,
                course: null,
                opening: null,
                content: 'encrypted:Question',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                readAt: null,
            },
            {
                id: 'message-2',
                senderId: 'admin-2',
                recipientId: student.id,
                sender: admin('admin-2'),
                recipient: student,
                courseId: null,
                openingId: null,
                course: null,
                opening: null,
                content: 'encrypted:Answer',
                createdAt: new Date('2026-01-02T00:00:00Z'),
                readAt: null,
            },
        ];
        const prisma: any = {
            user: {
                findMany: async () => {
                    adminLookups += 1;
                    return adminRecords;
                },
            },
            message: { findMany: async () => messages },
        };
        const service = new MessagesService(
            prisma,
            { tryDecrypt: (value: string) => value.replace('encrypted:', '') } as any,
        );

        const conversations = await service.getConversations({ userId: student.id, role: Role.STUDENT });
        const contacts = await service.getSupportAdmins();

        assert.equal(conversations.length, 1);
        assert.equal(conversations[0].otherUser.id, 'admin-1');
        assert.equal(conversations[0].otherUser.nameAr, 'المدير');
        assert.equal(conversations[0].lastMessage.content, 'Answer');
        assert.equal(contacts.length, 1);
        assert.equal(contacts[0].nameAr, 'المدير');
        assert.equal(adminLookups, 2);
    });

    test('every active admin sees and can mark the shared support thread as read', async () => {
        let conversationQuery: any;
        let threadQuery: any;
        let readQuery: any;
        let unreadQuery: any;
        const prisma: any = {
            user: {
                findMany: async ({ select }: any) => select.role ? adminRecords : admins,
                findUnique: async () => student,
            },
            message: {
                findMany: async ({ where }: any) => {
                    if (conversationQuery) threadQuery = where;
                    else conversationQuery = where;
                    return [{
                        id: 'message-1',
                        senderId: student.id,
                        recipientId: 'admin-2',
                        sender: student,
                        recipient: admin('admin-2'),
                        courseId: null,
                        openingId: null,
                        course: null,
                        opening: null,
                        content: 'encrypted:Question',
                        createdAt: new Date('2026-01-01T00:00:00Z'),
                        readAt: null,
                    }];
                },
                updateMany: async ({ where }: any) => {
                    readQuery = where;
                    return { count: 1 };
                },
                count: async ({ where }: any) => {
                    unreadQuery = where;
                    return 1;
                },
            },
        };
        const service = new MessagesService(
            prisma,
            { tryDecrypt: (value: string) => value.replace('encrypted:', '') } as any,
        );
        const currentAdmin = { userId: 'admin-1', role: Role.ADMIN };

        const conversations = await service.getConversations(currentAdmin);
        const thread = await service.getThread(currentAdmin, student.id);
        const read = await service.markRead(currentAdmin, student.id);
        const unread = await service.getUnreadCount(currentAdmin);

        assert.equal(conversations.length, 1);
        assert.equal(conversations[0].otherUser.id, student.id);
        assert.deepEqual(conversationQuery.OR, [
            { senderId: { in: ['admin-1', 'admin-2'] } },
            { recipientId: { in: ['admin-1', 'admin-2'] } },
        ]);
        assert.deepEqual(threadQuery.OR, [
            { senderId: student.id, recipientId: { in: ['admin-1', 'admin-2'] } },
            { senderId: { in: ['admin-1', 'admin-2'] }, recipientId: student.id },
        ]);
        assert.deepEqual(readQuery, {
            senderId: student.id,
            recipientId: { in: ['admin-1', 'admin-2'] },
            readAt: null,
        });
        assert.deepEqual(unreadQuery, {
            recipientId: { in: ['admin-1', 'admin-2'] },
            readAt: null,
        });
        assert.deepEqual(read, { updated: 1 });
        assert.equal(thread.length, 1);
        assert.deepEqual(unread, { count: 1 });
    });
});
