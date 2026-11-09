import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ChatService } from '../src/chat/chat.service';
import { Role } from '@prisma/client';

/**
 * Authorization tests for the batch (group) chat.
 *
 * A `ChatRoom` is one per course opening, and the caller has no `courseId` in
 * scope when they ask for a room: they name the room, or they get the list.
 * Both paths went wrong in ways that only showed up as "the chat did not open
 * for a student who was accepted":
 *
 *  - `getRooms` scoped by `openingId` only when the caller had at least one
 *    opening. With none it left `where` empty, which matched every room on the
 *    platform and returned each one's name, member count and last message.
 *  - `userHasRoomAccess` matched the student's enrollment on `courseId` instead
 *    of `openingId`, so being approved in one batch unlocked every other batch
 *    of the same course.
 *  - `getOrCreateDirectChat` required `enrollment.opening` to resolve the
 *    instructor. `Enrollment.openingId` is nullable and was added without a
 *    backfill, so an approved student with a legacy row was hard-403'd forever.
 *
 * These drive the real service against a recording double for Prisma, so they
 * assert the query the service builds — the part that decides who gets in.
 */

type Rec = { model: string; op: string; args: any };

function makeHarness(handlers: {
    enrollments?: any[];
    openings?: any[];
    rooms?: any[];
    roomMembers?: any[];
    messages?: any[];
    course?: any;
    courses?: any[];
    users?: any[];
}) {
    const calls: Rec[] = [];
    const rooms = handlers.rooms ?? [];
    const members = handlers.roomMembers ?? [];

    const prisma: any = {
        enrollment: {
            findMany: async (args: any) => {
                calls.push({ model: 'enrollment', op: 'findMany', args });
                // `syncRoomMembers` includes the student to read their role, so
                // every row the double returns has to carry one.
                let rows = handlers.enrollments ?? [];
                // Honour the legacy-row lookup (`openingId: null`) the way Prisma
                // would, so the single-batch fallback cannot be faked by a row
                // that does carry a batch.
                if (args?.where?.openingId === null) rows = rows.filter((e) => !e.openingId);
                return rows.map((e) => ({
                    student: { id: e.studentId ?? e.student?.id ?? 'student-1', role: Role.STUDENT },
                    ...e,
                }));
            },
            findFirst: async (args: any) => {
                calls.push({ model: 'enrollment', op: 'findFirst', args });
                return (handlers.enrollments ?? [])[0] ?? null;
            },
        },
        courseOpening: {
            findMany: async (args: any) => {
                calls.push({ model: 'courseOpening', op: 'findMany', args });
                return handlers.openings ?? [];
            },
            findFirst: async (args: any) => {
                calls.push({ model: 'courseOpening', op: 'findFirst', args });
                return (handlers.openings ?? [])[0] ?? null;
            },
            findUnique: async (args: any) => {
                calls.push({ model: 'courseOpening', op: 'findUnique', args });
                return (handlers.openings ?? [])[0] ?? null;
            },
        },
        chatRoom: {
            findMany: async (args: any) => {
                calls.push({ model: 'chatRoom', op: 'findMany', args });
                // Honour the where clause the way Prisma would, so the test
                // fails if an empty allow-list ever matches everything again.
                const allowed = args?.where?.openingId?.in;
                if (!allowed) return rooms;
                return rooms.filter((r) => allowed.includes(r.openingId));
            },
            findUnique: async (args: any) => {
                calls.push({ model: 'chatRoom', op: 'findUnique', args });
                if (args?.where?.id) return rooms.find((r) => r.id === args.where.id) ?? null;
                // The lazy `openingId` lookup used by getOrCreateRoomForOpening.
                return rooms.find((r) => r.openingId === args?.where?.openingId) ?? null;
            },
            create: async (args: any) => {
                calls.push({ model: 'chatRoom', op: 'create', args });
                const created = { id: `new-${args.data.openingId}`, ...args.data, members: [], messages: [] };
                rooms.push(created as any);
                return created;
            },
        },
        chatRoomMember: {
            findUnique: async (args: any) => {
                calls.push({ model: 'chatRoomMember', op: 'findUnique', args });
                return members.find((m) => m.roomId === args?.where?.roomId_userId?.roomId
                    && m.userId === args?.where?.roomId_userId?.userId) ?? null;
            },
            deleteMany: async () => ({ count: 0 }),
            updateMany: async () => ({ count: 1 }),
            // `createMany` issues ONE multi-row INSERT, so `@@unique([roomId,
            // userId])` is checked within the statement. This double used to be
            // a no-op, which is exactly why the admin-taught-batch 500 went
            // unnoticed: nothing here could ever raise P2002.
            createMany: async (args: any) => {
                calls.push({ model: 'chatRoomMember', op: 'createMany', args });
                const seen = new Set<string>();
                for (const row of args?.data ?? []) {
                    const key = `${row.roomId}:${row.userId}`;
                    if (seen.has(key)) {
                        const err: any = new Error('Unique constraint failed on the fields: (`roomId`,`userId`)');
                        err.code = 'P2002';
                        throw err;
                    }
                    seen.add(key);
                }
                return { count: (args?.data ?? []).length };
            },
        },
        chatMessage: {
            count: async () => 0,
            findMany: async (args: any) => {
                calls.push({ model: 'chatMessage', op: 'findMany', args });
                return handlers.messages ?? [];
            },
        },
        chatMessage: { count: async () => 0 },
        user: {
            findUnique: async (args: any) => {
                calls.push({ model: 'user', op: 'findUnique', args });
                return (handlers.users ?? []).find((u) => u.id === args?.where?.id) ?? null;
            },
            findMany: async (args: any) => {
                calls.push({ model: 'user', op: 'findMany', args });
                // Honour the filter. This serves two callers with opposite
                // filters -- the ADMIN roster for the room sync, and the
                // unbatched-student lookup (`role: STUDENT`, `id: { in: [...] }`)
                // -- so returning every user for both used to put admins into
                // the student list and manufacture a duplicate that the real
                // query would never produce.
                let rows = handlers.users ?? [];
                const w = args?.where ?? {};
                if (w.role) rows = rows.filter((u) => u.role === w.role);
                if (w.id?.in) rows = rows.filter((u) => w.id.in.includes(u.id));
                return rows;
            },
        },
        course: {
            findUnique: async (args: any) => {
                calls.push({ model: 'course', op: 'findUnique', args });
                return handlers.course ?? null;
            },
            findFirst: async (args: any) => {
                calls.push({ model: 'course', op: 'findFirst', args });
                return (handlers.courses ?? [])[0] ?? null;
            },
            // `getRooms` uses this to expand a course the caller owns into the
            // batches of that course, since `Course.instructorId` and
            // `CourseOpening.instructorId` are separate columns.
            findMany: async (args: any) => {
                calls.push({ model: 'course', op: 'findMany', args });
                return handlers.courses ?? [];
            },
        },
        directChat: {
            upsert: async (args: any) => {
                calls.push({ model: 'directChat', op: 'upsert', args });
                return { id: 'dc1', ...(args?.create ?? {}) };
            },
        },
    };

    const service = new ChatService(prisma as any, { notify: async () => undefined } as any);
    return { service, calls, prisma };
}

describe('batch chat: the room list is an allow-list, even when empty', () => {
    test('room list sorts by latest message, returns localized names, and never selects participant emails', async () => {
        const { service, calls } = makeHarness({
            rooms: [
                {
                    id: 'older-room',
                    openingId: 'o1',
                    nameAr: 'دفعة أ',
                    nameEn: 'Batch A',
                    createdAt: new Date('2026-01-03T00:00:00.000Z'),
                    members: [],
                    messages: [{
                        content: 'Older message',
                        createdAt: new Date('2026-01-04T00:00:00.000Z'),
                        sender: { id: 'student-1', email: 'private@example.com', role: Role.STUDENT },
                    }],
                    opening: { id: 'o1', course: { id: 'c1', titleAr: 'دورة أ', titleEn: 'Course A' } },
                },
                {
                    id: 'newer-room',
                    openingId: 'o2',
                    nameAr: 'دفعة ب',
                    nameEn: 'Batch B',
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    members: [],
                    messages: [{
                        content: 'Newer message',
                        createdAt: new Date('2026-01-05T00:00:00.000Z'),
                        sender: { id: 'student-2', email: 'private@example.com', role: Role.STUDENT },
                    }],
                    opening: { id: 'o2', course: { id: 'c2', titleAr: 'دورة ب', titleEn: 'Course B' } },
                },
            ],
        });

        const rooms = await service.getRooms('admin-1', Role.ADMIN);
        const query = calls.find((call) => call.model === 'chatRoom' && call.op === 'findMany');

        assert.deepEqual(rooms.map((room: any) => room.id), ['newer-room', 'older-room']);
        assert.equal(rooms[0].nameAr, 'دفعة ب');
        assert.equal(rooms[0].course.titleAr, 'دورة ب');
        assert.equal('sender' in rooms[0].lastMessage, false);
        assert.equal(query?.args.include.messages.include, undefined);
    });

    test('a student with no approved enrollment gets no rooms, not every room', async () => {
        const { service, calls } = makeHarness({
            enrollments: [],
            rooms: [
                { id: 'r1', openingId: 'o1', nameEn: 'Batch A', members: [], messages: [] },
                { id: 'r2', openingId: 'o2', nameEn: 'Batch B', members: [], messages: [] },
            ],
        });

        const rooms = await service.getRooms('student-1', Role.STUDENT);

        assert.equal(rooms.length, 0, 'an empty allow-list must not fall open');
        const listed = calls.find((c) => c.model === 'chatRoom' && c.op === 'findMany');
        assert.ok(listed, 'the room query should still have run');
        assert.deepEqual(
            listed.args.where.openingId.in,
            [],
            'the query must carry an explicit empty opening allow-list',
        );
    });

    test('a student only receives rooms for the batches they are in', async () => {
        const { service } = makeHarness({
            enrollments: [{ openingId: 'o1', courseId: 'c1' }],
            openings: [{ id: 'o1', instructorId: 'teach-1', courseId: 'c1' }],
            rooms: [
                { id: 'r1', openingId: 'o1', nameEn: 'Mine', members: [], messages: [], opening: { id: 'o1', course: { id: 'c1', titleEn: 'C' } } },
                { id: 'r2', openingId: 'o2', nameEn: 'Theirs', members: [], messages: [], opening: { id: 'o2', course: { id: 'c1', titleEn: 'C' } } },
            ],
        });

        const rooms = await service.getRooms('student-1', Role.STUDENT);

        assert.deepEqual(rooms.map((r: any) => r.name), ['Mine']);
    });

    test('oversight roles still see every room', async () => {
        const { service } = makeHarness({
            rooms: [
                { id: 'r1', openingId: 'o1', nameEn: 'A', members: [], messages: [] },
                { id: 'r2', openingId: 'o2', nameEn: 'B', members: [], messages: [] },
            ],
        });

        for (const role of [Role.ADMIN, Role.COURSE_MANAGER]) {
            const rooms = await service.getRooms('staff-1', role);
            assert.equal(rooms.length, 2, `${role} should see all rooms`);
        }
    });

    test('an instructor is not an instructor of every course', async () => {
        // The trap: reading "is this user an instructor" instead of "is this
        // user assigned to this course". Instructors do teach other people's
        // courses on the platform, so the role check cannot stand in.
        const { service } = makeHarness({
            enrollments: [],
            openings: [],
            rooms: [
                { id: 'r1', openingId: 'o1', nameEn: 'Someone else\'s batch', members: [], messages: [] },
            ],
        });

        const rooms = await service.getRooms('other-teacher', Role.INSTRUCTOR);

        assert.equal(rooms.length, 0, 'teaching elsewhere must not grant another course\'s rooms');
    });

    test('an instructor assigned to a batch does get its room', async () => {
        const { service } = makeHarness({
            openings: [{ id: 'o1', instructorId: 'me', courseId: 'c1' }],
            rooms: [{ id: 'r1', openingId: 'o1', nameEn: 'My batch', members: [], messages: [] }],
        });

        const rooms = await service.getRooms('me', Role.INSTRUCTOR);

        assert.deepEqual(rooms.map((r: any) => r.name), ['My batch']);
    });

    test("an instructor who owns the course gets its rooms even when no batch is theirs", async () => {
        // `Course.instructorId` and `CourseOpening.instructorId` are separate
        // columns. Keying only on openings locked the course's own instructor
        // out of the chat for a course they own, which is what surfaced as
        // "group chat does not open for the instructor".
        const { service } = makeHarness({
            openings: [{ id: 'o1', instructorId: 'other-teacher', courseId: 'c1' }],
            courses: [{ id: 'c1', instructorId: 'me', openings: [{ id: 'o1' }] }],
            rooms: [{ id: 'r1', openingId: 'o1', nameEn: 'My course batch', members: [], messages: [] }],
        });

        const rooms = await service.getRooms('me', Role.INSTRUCTOR);

        assert.deepEqual(rooms.map((r: any) => r.name), ['My course batch']);
    });

    test('a student whose enrollment has no batch is resolved only when the course has one batch', async () => {
        // `Enrollment.openingId` is nullable and predates the backfill, so some
        // approved students have no batch. Their chat tab renders (status is
        // APPROVED) but the room list was empty. A single-batch course is
        // unambiguous, so the room should appear; several batches is a genuine
        // ambiguity and guessing would leak a cohort they were not admitted to.
        const single = makeHarness({
            enrollments: [{ openingId: null, courseId: 'c1' }],
            openings: [{ id: 'o1', instructorId: 't1', courseId: 'c1' }],
            rooms: [{ id: 'r1', openingId: 'o1', nameEn: 'Only batch', members: [], messages: [] }],
        });
        const resolved = await single.service.getRooms('student-1', Role.STUDENT);
        assert.deepEqual(resolved.map((r: any) => r.name), ['Only batch']);

        const ambiguous = makeHarness({
            enrollments: [{ openingId: null, courseId: 'c1' }],
            openings: [
                { id: 'o1', instructorId: 't1', courseId: 'c1' },
                { id: 'o2', instructorId: 't1', courseId: 'c1' },
            ],
            rooms: [
                { id: 'r1', openingId: 'o1', nameEn: 'A', members: [], messages: [] },
                { id: 'r2', openingId: 'o2', nameEn: 'B', members: [], messages: [] },
            ],
        });
        const left = await ambiguous.service.getRooms('student-1', Role.STUDENT);
        assert.equal(left.length, 0, 'with two batches the correct one must not be guessed');
    });
});

describe('batch chat: access is per batch, not per course', () => {
    test('approval in one batch does not unlock another batch of the same course', async () => {
        const { service, calls } = makeHarness({
            // The student is approved in batch A. The room they are probing is
            // batch B's, and they hold no row for it.
            enrollments: [],
            rooms: [{ id: 'rB', openingId: 'oB' }],
            openings: [{ id: 'oB', instructorId: 'teach-1', courseId: 'c1' }],
            users: [{ id: 'student-1', role: Role.STUDENT }],
        });

        const allowed = await service.userHasRoomAccess('rB', 'student-1');

        assert.equal(allowed, false, 'a same-course enrollment must not grant another batch');
        const probe = calls.find((c) => c.model === 'enrollment' && c.op === 'findFirst');
        assert.ok(probe, 'the enrollment should have been checked');
        assert.equal(
            probe.args.where.openingId,
            'oB',
            'the enrollment must be matched on the room\'s opening, not the course',
        );
        assert.equal(
            probe.args.where.courseId,
            undefined,
            'matching on courseId is what leaked the sibling batch',
        );
    });

    test('a student approved in the room\'s own batch is let in', async () => {
        const { service } = makeHarness({
            enrollments: [{ openingId: 'oA', courseId: 'c1' }],
            rooms: [{ id: 'rA', openingId: 'oA' }],
            openings: [{ id: 'oA', instructorId: 'teach-1', courseId: 'c1' }],
            users: [{ id: 'student-1', role: Role.STUDENT }],
        });

        assert.equal(await service.userHasRoomAccess('rA', 'student-1'), true);
    });

    test('the opening\'s own instructor is always allowed', async () => {
        const { service } = makeHarness({
            enrollments: [],
            rooms: [{ id: 'rA', openingId: 'oA' }],
            openings: [{ id: 'oA', instructorId: 'teach-1', courseId: 'c1' }],
            users: [{ id: 'teach-1', role: Role.INSTRUCTOR }],
        });

        assert.equal(await service.userHasRoomAccess('rA', 'teach-1'), true);
    });
});

describe('direct chat: a legacy enrollment with no batch is not locked out', () => {
    test('resolves the instructor from the course when the enrollment has no opening', async () => {
        const { service } = makeHarness({
            course: { id: 'c1', instructorId: 'teach-1' },
            // Approved, but `openingId` is NULL: the column was added by a
            // migration with no backfill, so legacy rows still look like this.
            enrollments: [{ courseId: 'c1', openingId: null, status: 'APPROVED', opening: null }],
        });

        const chat = await service.getOrCreateDirectChat('c1', 'student-1', Role.STUDENT);

        assert.equal(chat.instructorId, 'teach-1');
    });

    test('prefers the instructor of the batch the student is actually in', async () => {
        const { service } = makeHarness({
            course: { id: 'c1', instructorId: 'owner-1' },
            enrollments: [{
                courseId: 'c1',
                openingId: 'o9',
                status: 'APPROVED',
                opening: { id: 'o9', instructorId: 'batch-teacher' },
            }],
        });

        const chat = await service.getOrCreateDirectChat('c1', 'student-1', Role.STUDENT);

        assert.equal(chat.instructorId, 'batch-teacher', 'the batch teacher wins over the course owner');
    });

    test('a student with no enrollment at all is still refused', async () => {
        const { service } = makeHarness({
            course: { id: 'c1', instructorId: 'teach-1' },
            enrollments: [],
        });

        await assert.rejects(
            () => service.getOrCreateDirectChat('c1', 'student-1', Role.STUDENT),
            /not enrolled/i,
        );
    });
});

/**
 * Regression: a batch run by an admin returned 500 on every room listing.
 *
 * `syncRoomMembers` put the opening's instructor in the member list and then
 * added every ADMIN on the platform. When those are the same person the array
 * held one `(roomId, userId)` twice, and `createMany`'s single multi-row INSERT
 * tripped `@@unique([roomId, userId])` inside the statement. `getRooms` awaits
 * the sync for each opening, so the whole listing failed — and the client turned
 * that 500 into "no chat room yet", which is how it reached a user as a missing
 * feature rather than an outage.
 */
describe('batch chat: a room run by an admin can still be listed', () => {
    const adminTaughtBatch = () => ({
        enrollments: [{ id: 'e1', studentId: 'student-1', courseId: 'crs-1', openingId: 'opn-1', status: 'APPROVED' }],
        openings: [{ id: 'opn-1', courseId: 'crs-1', instructorId: 'admin-1', status: 'STARTED' }],
        rooms: [],
        users: [{ id: 'admin-1', role: Role.ADMIN }],
    });

    test('the same person is not inserted twice, so the listing does not throw', async () => {
        const { service } = makeHarness(adminTaughtBatch());

        const rooms = await service.getRooms('student-1', Role.STUDENT);

        assert.equal(rooms.length, 1, 'the batch still gets its room');
        assert.equal(rooms[0].openingId, 'opn-1');
    });

    test('the admin who teaches the batch is still a member, exactly once', async () => {
        const { service, calls } = makeHarness(adminTaughtBatch());

        await service.getRooms('student-1', Role.STUDENT);

        const insert = calls.find((c) => c.model === 'chatRoomMember' && c.op === 'createMany');
        assert.ok(insert, 'membership is materialised on the listing path');
        const userIds = insert!.args.data.map((m: any) => m.userId);
        assert.equal(new Set(userIds).size, userIds.length, 'no duplicate (roomId, userId) in one INSERT');
        assert.equal(userIds.filter((id: string) => id === 'admin-1').length, 1);
        assert.ok(userIds.includes('student-1'), 'the enrolled student is still in the room');
    });

    test('the insert asks the database to skip duplicates, since the sync re-runs on every listing', async () => {
        const { service, calls } = makeHarness(adminTaughtBatch());

        await service.getRooms('student-1', Role.STUDENT);

        const insert = calls.find((c) => c.model === 'chatRoomMember' && c.op === 'createMany')!;
        assert.equal(insert.args.skipDuplicates, true);
    });

    test('an instructor who is not an admin is unaffected', async () => {
        const { service, calls } = makeHarness({
            enrollments: [{ id: 'e1', studentId: 'student-1', courseId: 'crs-1', openingId: 'opn-1', status: 'APPROVED' }],
            openings: [{ id: 'opn-1', courseId: 'crs-1', instructorId: 'teach-1', status: 'STARTED' }],
            rooms: [],
            users: [{ id: 'admin-9', role: Role.ADMIN }],
        });

        const rooms = await service.getRooms('student-1', Role.STUDENT);

        assert.equal(rooms.length, 1);
        const insert = calls.find((c) => c.model === 'chatRoomMember' && c.op === 'createMany')!;
        const userIds = insert.args.data.map((m: any) => m.userId);
        assert.deepEqual([...userIds].sort(), ['admin-9', 'student-1', 'teach-1']);
    });
});
