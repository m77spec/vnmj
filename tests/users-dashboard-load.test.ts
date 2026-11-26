import test from 'node:test';
import assert from 'node:assert/strict';
import { Role, EnrollmentStatus } from '@prisma/client';
import { UsersService } from '../src/users/users.service';

function createService(role: Role) {
    const calls: { userQuery?: any; pendingWhere?: any } = {};
    const user = {
        id: 'user-1',
        email: 'student@example.test',
        role,
        isActive: true,
        metadata: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        language: 'ar',
        emailVerifiedAt: null,
        twoFactorEnabled: false,
        _count: {
            enrollments: 2,
            certificates: 1,
            coursesTaught: 3,
            openingsTaught: 4,
            tickets: 5,
            receivedMessages: 6,
            notifications: 7,
        },
    };
    const prisma = {
        user: {
            findUnique: async (args: any) => {
                calls.userQuery = args;
                return user;
            },
        },
        enrollment: {
            count: async (args: any) => {
                calls.pendingWhere = args.where;
                return 8;
            },
        },
    };
    return {
        service: new UsersService(prisma as never, {} as never, {} as never),
        calls,
    };
}

test('dashboard aggregates user counters in one database read for students', async () => {
    const { service, calls } = createService(Role.STUDENT);
    const result = await service.getMe('user-1');

    assert.deepEqual(result.stats, {
        enrollments: 2,
        certificates: 1,
        coursesTaught: 3,
        openingsTaught: 4,
        pendingEnrollments: 0,
        tickets: 5,
        unreadMessages: 6,
        unreadNotifications: 7,
    });
    assert.equal(calls.userQuery.where.id, 'user-1');
    assert.deepEqual(calls.userQuery.select._count.select.receivedMessages, {
        where: { readAt: null },
    });
    assert.deepEqual(calls.userQuery.select._count.select.notifications, {
        where: { readAt: null },
    });
    assert.equal(calls.pendingWhere, undefined);
});

test('finance dashboard keeps the global pending-enrollment count', async () => {
    const { service, calls } = createService(Role.FINANCE);
    const result = await service.getMe('user-1');

    assert.equal(result.stats.pendingEnrollments, 8);
    assert.deepEqual(calls.pendingWhere, { status: EnrollmentStatus.PENDING });
});
