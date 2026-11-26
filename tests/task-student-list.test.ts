import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TasksService } from '../src/tasks/tasks.service';

describe('student task batch resolution', () => {
    test('resolves a legacy enrollment to the single course opening', async () => {
        const service = new TasksService(
            {
                enrollment: {
                    findFirst: async () => ({ openingId: null }),
                },
                courseOpening: {
                    findMany: async () => [{ id: 'opening-1' }],
                },
            } as any,
            {} as any,
            {} as any,
            {} as any,
        );

        assert.equal(await service.getStudentOpeningId('student-1', 'course-1'), 'opening-1');
    });

    test('does not guess a batch when a legacy enrollment has multiple openings', async () => {
        const service = new TasksService(
            {
                enrollment: {
                    findFirst: async () => ({ openingId: null }),
                },
                courseOpening: {
                    findMany: async () => [{ id: 'opening-1' }, { id: 'opening-2' }],
                },
            } as any,
            {} as any,
            {} as any,
            {} as any,
        );

        assert.equal(await service.getStudentOpeningId('student-1', 'course-1'), null);
    });
});
