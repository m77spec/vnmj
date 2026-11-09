import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { getUserDisplayNames } from '../common/user-display-name';

@Injectable()
export class ChatService {
    constructor(
        private prisma: PrismaService,
        private notifications: NotificationsService,
    ) { }

    private async getCourseOrThrow(courseId: string) {
        const course = await this.prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundException('Course not found');
        return course;
    }

    private isOversight(role: Role) {
        return role === Role.ADMIN || role === Role.COURSE_MANAGER;
    }

    // ============================= Group (batch) chat =============================

  /**
   * Some enrollment rows predate `Enrollment.openingId` and were never
   * backfilled, so they carry NULL. A student has exactly one enrollment per
   * course, so the course names the batch they belong to — but only when the
   * course has a single batch. With several, the right batch is genuinely
   * ambiguous, and picking one would drop a student into a cohort they were
   * never admitted to. Those are left unresolved on purpose: they keep 1:1
   * chat with the instructor, and a human decides their batch.
   */
  private async resolveUnambiguousBatchIds(courseIds: string[]): Promise<string[]> {
    if (!courseIds.length) return [];
    const batches = await this.prisma.courseOpening.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true },
    });
    const byCourse = new Map<string, string[]>();
    for (const b of batches) {
      const list = byCourse.get(b.courseId) ?? [];
      list.push(b.id);
      byCourse.set(b.courseId, list);
    }
    const resolved: string[] = [];
    for (const courseId of courseIds) {
      const ids = byCourse.get(courseId) ?? [];
      if (ids.length === 1) resolved.push(ids[0]);
    }
    return resolved;
  }

  /**
   * Get all group chat rooms the user has access to.
     * - Students: rooms for openings they are enrolled+approved/reserved in
     * - Instructors: rooms for openings they teach
     * - Admins/CM: all rooms
     */
  async getRooms(userId: string, role: Role) {
    let candidateOpeningIds: string[] = [];

    if (role === Role.STUDENT) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { studentId: userId, status: { in: ['APPROVED', 'RESERVED'] } },
        select: { openingId: true, courseId: true },
      });
      candidateOpeningIds = enrollments.map(e => e.openingId).filter((id): id is string => !!id);

      // A legacy enrollment row has `openingId = NULL`: the column was added
      // after those rows existed and no backfill was run. Such a student passes
      // `viewerAccess.chatEnabled` (their status is APPROVED) so the chat tab
      // renders, but they contribute no opening to the allow-list above, so the
      // room list came back empty and the panel read as "the chat is broken".
      const orphans = enrollments.filter(e => !e.openingId).map(e => e.courseId);
      if (orphans.length) {
        const resolved = await this.resolveUnambiguousBatchIds(orphans);
        candidateOpeningIds.push(...resolved);
      }
    } else if (role === Role.INSTRUCTOR) {
      // `Course.instructorId` (instructor of record) and
      // `CourseOpening.instructorId` (who runs that batch) are separate
      // columns. Keying only on openings meant the course's own instructor
      // could hold a course with no batch assigned to them, get an empty room
      // list, and conclude the chat was down. Both assignments now count.
      const [assignments, owned] = await Promise.all([
        this.prisma.courseOpening.findMany({
          where: { instructorId: userId },
          select: { id: true },
        }),
        this.prisma.course.findMany({
          where: { instructorId: userId },
          select: { openings: { select: { id: true } } },
        }),
      ]);
      candidateOpeningIds = [
        ...assignments.map(o => o.id),
        ...owned.flatMap(c => c.openings.map(o => o.id)),
      ];
    }

        // The opening list is the allow-list for students and instructors, and
        // it stays the allow-list when it is EMPTY. An empty `in` matches
        // nothing, which is the correct answer for a student with no approved
        // enrollment; an empty `where` matched every room on the platform and
        // shipped each one's name, member count and last-message text.
        const where = this.isOversight(role)
            ? {}
            : { openingId: { in: candidateOpeningIds } };

        // Lazily create rooms for the user's openings so a room always exists
        for (const openingId of candidateOpeningIds) {
            await this.getOrCreateRoomForOpening(openingId);
        }

        const rooms = await this.prisma.chatRoom.findMany({
            where,
            include: {
                opening: {
                    select: { id: true, nameAr: true, nameEn: true, course: { select: { id: true, titleAr: true, titleEn: true } } },
                },
                members: {
                    include: { user: { select: { id: true, email: true, role: true } } },
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const result: any[] = [];
        for (const room of rooms as any[]) {
            const myMember = room.members?.find((m: any) => m.userId === userId);
            let unreadCount = 0;
            if (myMember?.lastReadAt) {
                unreadCount = await this.prisma.chatMessage.count({
                    where: { roomId: room.id, createdAt: { gt: myMember.lastReadAt } },
                });
            }
            const course = room.opening?.course
                ? {
                      id: room.opening.course.id,
                      title: room.opening.course.titleEn || room.opening.course.titleAr,
                      titleAr: room.opening.course.titleAr,
                      titleEn: room.opening.course.titleEn,
                  }
                : null;
            const lastMessage = room.messages?.[0];
            result.push({
                id: room.id,
                name: room.nameEn || room.nameAr || `Room ${room.id}`,
                nameAr: room.nameAr,
                nameEn: room.nameEn,
                createdAt: room.createdAt,
                openingId: room.openingId,
                course,
                lastMessage: lastMessage
                    ? {
                          content: lastMessage.content,
                          createdAt: lastMessage.createdAt,
                          fromMe: lastMessage.senderId === userId,
                      }
                    : null,
                unreadCount,
                memberCount: room.members?.length ?? 0,
            });
        }
        return result.sort((a, b) =>
            new Date(b.lastMessage?.createdAt ?? b.createdAt ?? 0).getTime()
            - new Date(a.lastMessage?.createdAt ?? a.createdAt ?? 0).getTime(),
        );
    }

    /** Get the room for an opening, creating + syncing it on first access. */
    async getOrCreateRoomForOpening(openingId: string) {
        let room = await this.prisma.chatRoom.findUnique({ where: { openingId } });
        if (!room) {
            const opening = await this.prisma.courseOpening.findUnique({ where: { id: openingId } });
            if (!opening) throw new NotFoundException('Opening not found');
            room = await this.prisma.chatRoom.create({
                data: {
                    openingId,
                    nameAr: opening.nameAr || `غرفة ${opening.nameEn || openingId}`,
                    nameEn: opening.nameEn || `Room ${opening.nameAr || openingId}`,
                },
            });
        }
        await this.syncRoomMembers(room.id);
        return room;
    }

    /**
     * Get the full message thread for a room, newest first.
     */
    async getThread(roomId: string, userId: string, take = 50) {
        if (!(await this.userHasRoomAccess(roomId, userId))) {
            throw new ForbiddenException('You do not have access to this chat room');
        }
        const messages = await this.prisma.chatMessage.findMany({
            where: { roomId },
            include: { sender: { select: { id: true, role: true, metadata: true } } },
            orderBy: { createdAt: 'desc' },
            take,
        });
        // Mark the room as read by the current user
        await this.prisma.chatRoomMember.updateMany({
            where: { roomId, userId },
            data: { lastReadAt: new Date() },
        });
        return messages.map((m: any) => ({
            ...m,
            sender: m.sender
                ? { id: m.sender.id, role: m.sender.role, ...getUserDisplayNames(m.sender) }
                : null,
        }));
    }

    /**
     * Send a message in a room. Validates that user has access to the room.
     */
    async sendMessage(roomId: string, userId: string, content: string, attachmentUrl?: string, attachmentType?: string) {
        const room = await this.prisma.chatRoom.findUnique({
            where: { id: roomId },
            include: { members: { select: { userId: true } } },
        });
        if (!room) throw new NotFoundException('Chat room not found');

        const hasAccess = await this.userHasRoomAccess(roomId, userId);
        if (!hasAccess) throw new ForbiddenException('You do not have access to this chat room');

        const message = await this.prisma.chatMessage.create({
            data: {
                roomId,
                content,
                attachmentUrl,
                attachmentType,
                senderId: userId,
            },
            include: { sender: { select: { id: true, role: true, metadata: true } } },
        });

        // Notify every other member (except sender) via in-app notification
        const otherMembers = (room.members ?? []).filter((m: any) => m.userId !== userId);
        if (otherMembers.length > 0) {
            const titleAr = 'رسالة جديدة في الدفعة';
            const titleEn = 'New batch message';
            const bodyAr = content ? content.substring(0, 80) : 'رسالة جديدة في غرفة الدفعة';
            const bodyEn = content ? content.substring(0, 80) : 'New message in the batch room';
            await Promise.allSettled(otherMembers.map((m: any) => this.notifications.notify({
                userId: m.userId,
                type: 'chat.message',
                titleAr,
                titleEn,
                bodyAr,
                bodyEn,
                data: { roomId, messageId: message.id, senderId: userId },
            })));
        }

        return {
            ...message,
            sender: message.sender
                ? { id: message.sender.id, role: message.sender.role, ...getUserDisplayNames(message.sender) }
                : null,
        };
    }

    /**
     * May this user read/post in this room? Pure check — it writes nothing.
     *
     * The gateway calls this on every join and every send, and it used to call
     * `syncRoomMembers` on the way through, which is a delete-then-recreate of
     * every member row on a hot read path. Membership is materialised where it
     * belongs instead: `getOrCreateRoomForOpening` (reached from `getRooms`)
     * and both approval paths sync the room, so by the time anyone lists their
     * chats the member rows already exist. A missing row degrades to the
     * enrollment/instructor checks below, which is the real gate anyway.
     */
    async userHasRoomAccess(roomId: string, userId: string): Promise<boolean> {
        const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room) return false;

        const isMember = await this.prisma.chatRoomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
        if (isMember) return true;

        const opening = await this.prisma.courseOpening.findUnique({ where: { id: room.openingId } });
        if (opening && opening.instructorId === userId) return true;

        // The course's own instructor is not necessarily the batch's instructor
        // — those are two separate columns — so ownership of the course is a
        // second, independent claim on the rooms of that course. Checked here as
        // well as in `getRooms`, otherwise the room would be listed and then
        // refused the moment its thread was opened.
        if (opening) {
            const owner = await this.prisma.course.findFirst({
                where: { id: opening.courseId, instructorId: userId },
                select: { id: true },
            });
            if (owner) return true;
        }

        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (user && this.isOversight(user.role)) return true;

        if (opening && user?.role === Role.STUDENT) {
            // Scoped to THIS batch, not to the course. Rooms are one per
            // opening and both `getRooms` and `syncRoomMembers` key off
            // `openingId`; matching on `courseId` here handed an approved
            // student in batch A read and post access to every other batch of
            // the same course, given only a room id. A student has one
            // enrollment row per course, so their batch is their `openingId`.
            const enrollment = await this.prisma.enrollment.findFirst({
                where: { openingId: room.openingId, studentId: userId, status: { in: ['APPROVED', 'RESERVED'] } },
            });
            if (enrollment) return true;

            // ...or their batch was never recorded, and this course has only
            // one batch, so this room is the one they were admitted to.
            const [ownEnrollment] = await this.prisma.enrollment.findMany({
                where: { studentId: userId, courseId: opening.courseId, openingId: null, status: { in: ['APPROVED', 'RESERVED'] } },
                select: { id: true },
                take: 1,
            });
            if (ownEnrollment) {
                const [resolved] = await this.resolveUnambiguousBatchIds([opening.courseId]);
                if (resolved === room.openingId) return true;
            }
        }

        return false;
    }

    /** Sync room membership: add approved/reserved students + instructor + admins */
    async syncRoomMembers(roomId: string) {
        const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room) throw new NotFoundException('Chat room not found');

        const opening = await this.prisma.courseOpening.findUnique({ where: { id: room.openingId } });
        if (!opening) throw new NotFoundException('Opening not found');

        await this.prisma.chatRoomMember.deleteMany({ where: { roomId } });

        const students = await this.prisma.enrollment.findMany({
            where: { openingId: room.openingId, status: { in: ['APPROVED', 'RESERVED'] } },
            include: { student: { select: { id: true, role: true } } },
        });
        const studentMembers = students.map(e => ({
            roomId,
            userId: e.studentId,
            role: e.student.role,
        }));

        // Students whose enrollment predates `openingId` are absent from the
        // query above even though `userHasRoomAccess` lets them in, so they
        // would hold a room they are not a member of: no unread badge, no
        // mentions, no notifications. Give them rows too, under the same
        // single-batch rule the access check uses.
        const unbatched = await this.prisma.enrollment.findMany({
            where: { courseId: opening.courseId, openingId: null, status: { in: ['APPROVED', 'RESERVED'] } },
            select: { studentId: true },
        });
        const [resolved] = await this.resolveUnambiguousBatchIds([opening.courseId]);
        if (unbatched && resolved === room.openingId) {
            const known = new Set(studentMembers.map(m => m.userId));
            const extras = await this.prisma.user.findMany({
                where: { id: { in: unbatched.map(e => e.studentId) }, role: Role.STUDENT, isActive: true },
                select: { id: true, role: true },
            });
            for (const u of extras) {
                if (!known.has(u.id)) studentMembers.push({ roomId, userId: u.id, role: u.role });
            }
        }

        const instructorMember = {
            roomId,
            userId: opening.instructorId,
            role: Role.INSTRUCTOR,
        };

        const admins = await this.prisma.user.findMany({ where: { role: Role.ADMIN } });
        const adminMembers = admins.map(a => ({
            roomId,
            userId: a.id,
            role: Role.ADMIN,
        }));

        // `ChatRoomMember` is `@@unique([roomId, userId])`, and a batch run by
        // an admin puts the same person in the list twice: once as the opening's
        // instructor and once in the admin roster. `createMany` sends one
        // multi-row INSERT, so the duplicate is rejected by the unique index
        // WITHIN the statement -- not against a pre-existing row, which the
        // deleteMany above already removed. That surfaced as a 500 on every
        // `GET /chat/rooms` for those batches, and the client rendered it as
        // "no chat room yet" because the panel swallowed the error.
        // Dedupe on the way in, and let the database skip any stragglers so
        // re-running this sync stays harmless: it fires on every room listing.
        const byUser = new Map<string, { roomId: string; userId: string; role: Role }>();
        for (const m of [...studentMembers, instructorMember, ...adminMembers]) {
            byUser.set(m.userId, m);
        }

        await this.prisma.chatRoomMember.createMany({
            data: [...byUser.values()],
            skipDuplicates: true,
        });
    }

    // ============================= Direct (1:1) chat =============================

    /**
     * Who runs a course, for the case where the student's own enrollment cannot
     * say: the course's owning instructor, else the earliest batch's instructor.
     */
    private async resolveCourseInstructorId(courseId: string): Promise<string> {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { instructorId: true },
        });
        if (course?.instructorId) return course.instructorId;

        const opening = await this.prisma.courseOpening.findFirst({
            where: { courseId },
            select: { instructorId: true },
            orderBy: { createdAt: 'asc' },
        });
        if (opening?.instructorId) return opening.instructorId;

        throw new ForbiddenException('No instructor is assigned to this course');
    }

    private directChatInclude = {
        course: { select: { id: true, titleAr: true, titleEn: true } },
        student: { select: { id: true, email: true } },
        instructor: { select: { id: true, email: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' }, include: { sender: { select: { id: true, email: true, role: true } } } },
    } as any;

    /**
     * Get or create the direct chat between a student and instructor, scoped to a course.
     * - Student: automatically resolves instructor from their enrollment.
     * - Instructor/Staff: caller must supply `studentId` to identify which student.
     */
    async getOrCreateDirectChat(courseId: string, userId: string, role: Role, studentId?: string) {
        await this.getCourseOrThrow(courseId);

        let resolvedStudentId: string;
        let instructorId: string;

        if (role === Role.STUDENT) {
            resolvedStudentId = userId;
            const enrollments = await this.prisma.enrollment.findMany({
                where: { courseId, studentId: userId, status: { in: ['APPROVED', 'RESERVED'] } },
                include: { opening: { select: { id: true, instructorId: true } } },
                orderBy: { createdAt: 'asc' },
            });
            if (enrollments.length === 0) {
                throw new ForbiddenException('You are not enrolled in this course');
            }
            // Prefer the instructor of the batch the student is actually in.
            // `Enrollment.openingId` is nullable and was added without a
            // backfill, so a legacy approved enrollment can have none — and
            // with `@@unique([studentId, courseId])` there is only ever one
            // row, so requiring the join hard-403'd those students forever.
            // Fall back to whoever runs the course instead.
            const enrolledInstructor = enrollments.find((e) => e.opening?.instructorId)?.opening?.instructorId;
            instructorId = enrolledInstructor ?? (await this.resolveCourseInstructorId(courseId));
        } else {
            if (!studentId) {
                throw new BadRequestException('studentId is required for instructors');
            }
            resolvedStudentId = studentId;
            const openings = await this.prisma.courseOpening.findMany({
                where: { courseId, instructorId: userId },
                select: { id: true },
            });
            if (openings.length === 0) {
                throw new ForbiddenException('You do not teach this course');
            }
            instructorId = userId;
            const enrollment = await this.prisma.enrollment.findFirst({
                where: { courseId, studentId, status: { in: ['APPROVED', 'RESERVED'] } },
            });
            if (!enrollment) {
                throw new ForbiddenException('Student is not enrolled in this course');
            }
        }

        return this.prisma.directChat.upsert({
            where: { courseId_studentId_instructorId: { courseId, studentId: resolvedStudentId, instructorId } },
            update: {},
            create: {
                courseId,
                studentId: resolvedStudentId,
                instructorId,
                studentLastReadAt: new Date(),
            },
            include: this.directChatInclude,
        });
    }

    /**
     * List all direct chats for a specific course (used by instructors to see their students).
     */
    async getDirectChatsForCourse(courseId: string, userId: string, role: Role) {
        await this.getCourseOrThrow(courseId);
        const where: any = { courseId };

        if (role === Role.STUDENT) {
            where.studentId = userId;
        } else if (role === Role.INSTRUCTOR) {
            where.instructorId = userId;
        }

        return this.prisma.directChat.findMany({
            where,
            include: this.directChatInclude,
            orderBy: { updatedAt: 'desc' },
        });
    }

    /**
     * List the direct conversations visible to the caller.
     * Students see their own; instructors see theirs; admins/CM see all (oversight).
     */
    async getMyDirectChats(userId: string, role: Role) {
        const isStaff = this.isOversight(role);
        const where = isStaff
            ? undefined
            : role === Role.INSTRUCTOR
                ? { instructorId: userId }
                : { studentId: userId };

        const chats = await this.prisma.directChat.findMany({
            where,
            include: this.directChatInclude,
            orderBy: { updatedAt: 'desc' },
        });

        const result: any[] = [];
        for (const chat of chats as any[]) {
            const myLastRead = role === Role.INSTRUCTOR ? chat.instructorLastReadAt : chat.studentLastReadAt;
            const unreadCount = myLastRead
                ? await this.prisma.directMessage.count({
                      where: { chatId: chat.id, senderId: { not: userId }, createdAt: { gt: myLastRead } },
                  })
                : 1;
            const lastMessage = chat.messages?.[0];
            result.push({
                id: chat.id,
                course: { id: chat.course.id, title: chat.course.titleEn || chat.course.titleAr },
                archived: !!chat.archivedAt,
                archivedAt: chat.archivedAt,
                student: chat.student,
                instructor: chat.instructor,
                lastMessage: lastMessage
                    ? {
                          content: lastMessage.content,
                          attachmentType: lastMessage.attachmentType,
                          createdAt: lastMessage.createdAt,
                          fromMe: lastMessage.senderId === userId,
                      }
                    : null,
                unreadCount,
            });
        }
        return result;
    }

    async getDirectThread(chatId: string, userId: string, role: Role) {
        const chat = await this.prisma.directChat.findUnique({ where: { id: chatId } });
        if (!chat) throw new NotFoundException('Direct chat not found');
        if (!this.isOversight(role) && chat.studentId !== userId && chat.instructorId !== userId) {
            throw new ForbiddenException('You do not have access to this conversation');
        }

        const messages = await this.prisma.directMessage.findMany({
            where: { chatId },
            include: { sender: { select: { id: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });

        // Mark the participant's read cursor (readAt for messages from the other party)
        if (role === Role.INSTRUCTOR) {
            await this.prisma.directChat.update({ where: { id: chatId }, data: { instructorLastReadAt: new Date() } });
            await this.prisma.directMessage.updateMany({ where: { chatId, senderId: chat.studentId, readAt: null }, data: { readAt: new Date() } });
        } else if (role === Role.STUDENT) {
            await this.prisma.directChat.update({ where: { id: chatId }, data: { studentLastReadAt: new Date() } });
            await this.prisma.directMessage.updateMany({ where: { chatId, senderId: chat.instructorId, readAt: null }, data: { readAt: new Date() } });
        }

        return {
            chat: {
                id: chat.id,
                courseId: chat.courseId,
                archived: !!chat.archivedAt,
            },
            messages,
        };
    }

    async sendDirectMessage(chatId: string, userId: string, role: Role, content?: string, attachmentUrl?: string, attachmentType?: string) {
        const chat = await this.prisma.directChat.findUnique({ where: { id: chatId } });
        if (!chat) throw new NotFoundException('Direct chat not found');
        if (!this.isOversight(role) && chat.studentId !== userId && chat.instructorId !== userId) {
            throw new ForbiddenException('You do not have access to this conversation');
        }

        const message = await this.prisma.directMessage.create({
            data: {
                chatId,
                senderId: userId,
                content,
                attachmentUrl,
                attachmentType,
            },
            include: { sender: { select: { id: true, email: true, role: true } } },
        });

        await this.prisma.directChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

        const otherId = userId === chat.studentId ? chat.instructorId : chat.studentId;
        await this.notifications.notify({
            userId: otherId,
            type: 'direct.message',
            titleAr: 'رسالة خاصة جديدة',
            titleEn: 'New private message',
            bodyAr: content ? content.substring(0, 80) : 'رسالة خاصة جديدة مع مرفق',
            bodyEn: content ? content.substring(0, 80) : 'New private message with attachment',
            data: { chatId, courseId: chat.courseId, messageId: message.id, senderId: userId },
        }).catch(() => { });

        return message;
    }

    async setDirectChatArchived(chatId: string, userId: string, role: Role, archived: boolean) {
        const chat = await this.prisma.directChat.findUnique({ where: { id: chatId } });
        if (!chat) throw new NotFoundException('Direct chat not found');
        if (!this.isOversight(role) && chat.instructorId !== userId) {
            throw new ForbiddenException('Only administrators or the instructor can archive this conversation');
        }
        return this.prisma.directChat.update({
            where: { id: chatId },
            data: { archivedAt: archived ? new Date() : null },
        });
    }

    async userHasDirectAccess(chatId: string, userId: string, role: Role): Promise<boolean> {
        const chat = await this.prisma.directChat.findUnique({
            where: { id: chatId },
            select: { id: true, studentId: true, instructorId: true },
        });
        if (!chat) return false;
        if (this.isOversight(role)) return true;
        return chat.studentId === userId || chat.instructorId === userId;
    }
}