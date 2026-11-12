import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    toPublicInstructor,
    mapPublicCourse,
    publicInstructorSelect,
    publicInstructorWhere,
} from '../src/common/public-instructor';

/**
 * Regression tests for the public instructor card.
 *
 * There is no `Instructor` table: an instructor is a `User` with
 * role=INSTRUCTOR. Every instructor surface used to fall back to the account
 * email, while the public endpoints deliberately withheld the email — so both
 * instructor pages threw `Cannot read properties of undefined (reading
 * 'charAt')` on first render. The card is now derived from metadata and must
 * never carry the address, because the public routes are unauthenticated.
 */
describe('public instructor identity', () => {
    test('exposes the bilingual CV and never returns the email', () => {
        const card = toPublicInstructor({
            id: 'u1',
            email: 'teacher@laxalab.test',
            createdAt: new Date('2024-01-01'),
            metadata: {
                nameAr: 'أحمد محمد',
                nameEn: 'Ahmed Mohammed',
                jobTitleAr: 'مهندس برمجيات',
                jobTitleEn: 'Software Engineer',
                bio: 'خبرة عشر سنوات',
                experienceYears: 10,
                avatarUrl: '/uploads/avatars/avatar-1.png',
            },
        });
        assert.equal(card.nameAr, 'أحمد محمد');
        assert.equal(card.nameEn, 'Ahmed Mohammed');
        assert.equal(card.jobTitleAr, 'مهندس برمجيات');
        assert.equal(card.jobTitleEn, 'Software Engineer');
        assert.equal(card.experienceYears, 10);
        assert.equal(card.avatarUrl, '/uploads/avatars/avatar-1.png');
        assert.ok(!JSON.stringify(card).includes('@laxalab.test'), 'the address must not travel');
    });

    test('falls back to fullName when one name side is missing', () => {
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { fullName: 'F', nameEn: 'E' } }).nameAr, 'F');
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { fullName: 'F', nameAr: 'A' } }).nameEn, 'F');
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { fullName: 'F' } }).nameEn, 'F');
    });

    test('flags an instructor whose CV is incomplete', () => {
        // No identity at all.
        assert.equal(toPublicInstructor({ id: 'u1' }).isProfileIncomplete, true);
        // A job title with no name is still unusable as a display name.
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { jobTitleEn: 'Dev' } }).isProfileIncomplete, true);
        // A name with no job title is exactly what the "fill in your headline"
        // nudge is for, so it stays flagged.
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { nameEn: 'A' } }).isProfileIncomplete, true);
        // Complete: an identity plus a headline.
        assert.equal(
            toPublicInstructor({ id: 'u1', metadata: { nameEn: 'A', jobTitleEn: 'Dev' } }).isProfileIncomplete,
            false,
        );
        assert.equal(
            toPublicInstructor({ id: 'u1', metadata: { nameAr: 'أ', jobTitleAr: 'مهندس' } }).isProfileIncomplete,
            false,
        );
    });

    test('rejects an avatar that is not one of our own uploads', () => {
        for (const bad of [
            'https://evil.test/x.png',
            '//evil.test/x.png',
            '/uploads/../secrets',
            'javascript:alert(1)',
            'data:image/svg+xml;base64,AAAA',
        ]) {
            assert.equal(
                toPublicInstructor({ id: 'u1', metadata: { avatarUrl: bad } }).avatarUrl,
                null,
                `must reject: ${bad}`,
            );
        }
    });

    test('mirrors bio into bioAr and falls back to bio for bioEn', () => {
        const one = toPublicInstructor({ id: 'u1', metadata: { bio: 'نص' } });
        assert.equal(one.bioAr, 'نص');
        assert.equal(one.bioEn, 'نص');
        const both = toPublicInstructor({ id: 'u1', metadata: { bio: 'ع', bioEn: 'en' } });
        assert.equal(both.bioAr, 'ع');
        assert.equal(both.bioEn, 'en');
    });

    test('ignores a nonsense experienceYears', () => {
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { experienceYears: 'abc' } }).experienceYears, null);
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { experienceYears: -3 } }).experienceYears, null);
        assert.equal(toPublicInstructor({ id: 'u1', metadata: { experienceYears: 0 } }).experienceYears, null);
    });

    test('never leaks a private profile field through the public card', () => {
        const card = toPublicInstructor({
            id: 'u1',
            metadata: { nameEn: 'A', phone: '+966500000000', birthDate: '2001-05-04', university: 'KSU' },
        });
        const json = JSON.stringify(card);
        for (const secret of ['+966500000000', '2001-05-04', 'KSU']) {
            assert.ok(!json.includes(secret), `must not expose: ${secret}`);
        }
    });

    test('replaces the instructor on a public course and each of its openings', () => {
        const instructor = { id: 'u1', createdAt: new Date(), metadata: { nameEn: 'A' } };
        const mapped = mapPublicCourse({
            id: 'c1',
            instructor,
            openings: [{ id: 'o1', instructor }, { id: 'o2', instructor: null }],
        });
        assert.equal(mapped.instructor?.id, 'u1');
        assert.equal(mapped.openings[0].instructor?.id, 'u1');
        assert.equal(mapped.openings[1].instructor, null);
        assert.ok(!JSON.stringify(mapped).includes('email'));
    });

    test('the shared select never asks for the email column', () => {
        assert.ok(!Object.keys(publicInstructorSelect).includes('email'));
    });
});

/**
 * The predicate behind every public instructor route.
 *
 * It used to be `role IN (INSTRUCTOR, COURSE_MANAGER)`, which describes the
 * *account* rather than the *teaching*. `Course.instructorId` and
 * `CourseOpening.instructorId` both point at `User`, so an admin can be the
 * recorded teacher of a course while holding neither role. Production hit
 * exactly that: `GET /public/instructors/:id` answered 404 for the very id the
 * public course payload had just embedded and linked, so a teacher with a
 * complete CV was one click from a "not found" page.
 */
describe('public instructor visibility predicate', () => {
    /** The three ways a user can be publicly an instructor. */
    const clauses = (publishedOnly: boolean) => {
        const w = publicInstructorWhere(publishedOnly);
        assert.equal(w.isActive, true, 'an inactive account is never public');
        const or = (w as { OR: unknown[] }).OR;
        assert.equal(or.length, 3, 'role, owned course, or taught opening');
        return or;
    };

    test('keeps the dedicated instructor roles', () => {
        const [role] = clauses(true);
        assert.deepEqual(role, { role: { in: ['INSTRUCTOR', 'COURSE_MANAGER'] } });
    });

    test('also admits a user who owns a course, whatever their role', () => {
        const [, courseLink] = clauses(false);
        // The old predicate had no course clause at all, which is the 404.
        assert.deepEqual(courseLink, { coursesTaught: { some: {} } });
    });

    test('also admits a user who runs an opening, whatever their role', () => {
        const [, , openingLink] = clauses(false);
        assert.deepEqual(openingLink, { openingsTaught: { some: {} } });
    });

    test('the browse list only counts published teaching', () => {
        const [, courseLink, openingLink] = clauses(true);
        // Otherwise staff who only ever touched a draft are enumerated publicly.
        assert.deepEqual(courseLink, { coursesTaught: { some: { openings: { some: { isPublished: true } } } } });
        assert.deepEqual(openingLink, { openingsTaught: { some: { isPublished: true } } });
    });

    test('the browse list excludes instructors explicitly hidden by an admin', () => {
        const where = publicInstructorWhere(true);
        assert.deepEqual(where.NOT, {
            metadata: {
                path: ['showOnInstructorsPage'],
                equals: false,
            },
        });
    });

    test('instructor profile links remain available when the browse list is not being queried', () => {
        const where = publicInstructorWhere(false);
        assert.equal(where.NOT, undefined);
    });
});
