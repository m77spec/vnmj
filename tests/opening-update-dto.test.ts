import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { UpdateOpeningDto } from '../src/courses/dto/update-opening.dto';
import { CourseOpeningsController } from '../src/courses/course-openings.controller';

/**
 * `PATCH /openings/:id` used to 500 on any save.
 *
 * The handler typed its body `Partial<CreateOpeningDto>`. TypeScript erases a
 * mapped type to `Object` in the emitted `design:paramtypes`, so Nest's
 * ValidationPipe skipped the body entirely: no `@Transform`, no validation.
 * The admin form's `<input type="date">` sends `startDate: "2026-09-27"`, that
 * raw string reached `prisma.courseOpening.update`, and Prisma rejected it
 * with `Invalid value for argument startDate: premature end of input` -> 500.
 *
 * `POST /courses/:id/openings` never failed because its body is typed with the
 * real `CreateOpeningDto`, whose `@Transform` normalises the same value.
 */

// Same options as the global pipe in src/main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

const run = (body: unknown) => pipe.transform(body as any, { type: 'body', metatype: UpdateOpeningDto }) as any;

// The exact payload the opening form puts together for an existing batch.
const editPayload = {
    nameAr: '28',
    nameEn: '28',
    instructorId: 'ea20ee2e-999a-4e27-a689-2252718eca1d',
    startDate: '2026-09-27',
    endDate: '2026-10-17',
    enrollmentDeadline: null,
    price: 19.99,
    currency: 'YER',
    priceOld: 49.99,
    maxStudents: '30',
    refundWindowDays: '3',
    deliveryMode: 'IN_PERSON',
    meetLink: null,
};

describe('PATCH /openings/:id input', () => {
    test('the handler declares a DTO class the pipe can introspect', () => {
        // @Param id, @Body dto, @Request req -> the body sits at index 1.
        const paramtypes = Reflect.getMetadata(
            'design:paramtypes',
            CourseOpeningsController.prototype,
            'update',
        ) as any[];

        assert.equal(
            paramtypes[1],
            UpdateOpeningDto,
            'the body must be typed with a class; an inline Partial<CreateOpeningDto> is erased to Object and disables validation + transforms',
        );
    });

    test('a date-only startDate is normalised to a full ISO string', async () => {
        const out = await run(editPayload);

        assert.equal(out.startDate, new Date('2026-09-27').toISOString());
        assert.equal(out.endDate, new Date('2026-10-17').toISOString());
        // A cleared optional date stays null instead of becoming Invalid Date.
        assert.equal(out.enrollmentDeadline, null);
    });

    test('accepts supported currencies and rejects unknown codes', async () => {
        const out = await run(editPayload);
        assert.equal(out.currency, 'YER');
        await assert.rejects(
            () => run({ ...editPayload, currency: 'XYZ' }),
            BadRequestException,
        );
    });

    test('the normalised date is something Prisma accepts', async () => {
        const { startDate } = await run(editPayload);
        assert.equal(Number.isNaN(new Date(startDate).getTime()), false);
        assert.match(startDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('numeric strings from the form are coerced', async () => {
        const out = await run(editPayload);
        assert.equal(out.maxStudents, 30);
        assert.equal(out.refundWindowDays, 3);
        assert.equal(out.price, 19.99);
    });

    test('every field is optional, so a partial edit still works', async () => {
        const out = await run({ price: 25 });
        assert.deepEqual(Object.keys(out), ['price']);
    });

    test('a refund window outside 0-365 is a 400, not a 500', async () => {
        await assert.rejects(() => run({ ...editPayload, refundWindowDays: 999 }), BadRequestException);
    });

    test('an unparsable date is a 400 rather than reaching Prisma', async () => {
        await assert.rejects(() => run({ ...editPayload, startDate: 'not-a-date' }), BadRequestException);
    });

    test('an unknown property is rejected', async () => {
        await assert.rejects(() => run({ ...editPayload, isAdmin: true }), BadRequestException);
    });
});