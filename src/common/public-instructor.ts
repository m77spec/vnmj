import type { Prisma } from '@prisma/client';
import { Role } from '@prisma/client';
import {
    PROFILE_KEY,
    readInstructorProfile,
    type InstructorProfile,
    type ProfileCertificate,
    type ProfileExperience,
    type ProfileLanguage,
    type ProfileLink,
    type ProfileQualification,
    type BilingualText,
} from './instructor-profile';

/** A user row carrying the minimum needed to build a public instructor card. */
type PublicUserSource = {
    id: string;
    createdAt?: Date | null;
    email?: string | null;
    metadata?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
    return (value ?? null) as Record<string, unknown> | null ?? {};
}

function str(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The public shape of an instructor.
 *
 * There is no `Instructor` table: an instructor is a `User` with
 * `role = INSTRUCTOR`.
 *
 * `metadata` is parsed here and never echoed wholesale, so private profile
 * data (phone, birth date, university) cannot leak through a public route.
 * `email` is deliberately absent from the return type.
 *
 * The bilingual fields are read through the legacy top-level keys first
 * (`nameAr`, `jobTitleAr`, `bio`, ...) because that is where the CV lived before
 * it was namespaced under `publicProfile`, and a teacher who filled it in
 * before the change must not lose it. `publicProfile` is authoritative when
 * present, so an old field can be cleared rather than permanently shadowed.
 *
 * The frontend reads `nameAr/nameEn`, `jobTitleAr/jobTitleEn`, `bioAr/bioEn`
 * and `specialtyAr/specialtyEn` with its existing `pick()` helper, exactly like
 * `Course.titleAr/titleEn` — so those pairs are kept.
 */
export interface PublicInstructor {
    id: string;
    /**
     * Bilingual pair, read by the frontend's existing `pick()` helper exactly
     * like `Course.titleAr/titleEn`. Each side falls back to the registration
     * `fullName` so an instructor who only filled one field still renders.
     */
    nameAr: string | null;
    nameEn: string | null;
    avatarUrl: string | null;
    /** Bilingual: the caller picks with the same `pick()` used for courses. */
    jobTitleAr: string | null;
    jobTitleEn: string | null;
    bioAr: string | null;
    bioEn: string | null;
    specialtyAr: string | null;
    specialtyEn: string | null;
    experienceYears: number | null;
    joinedAt: Date | null;
    /** True when the instructor has not filled in a CV yet. */
    isProfileIncomplete: boolean;
    /** Subjects taught, as a list. May be empty while `specialty*` is set. */
    specialties: BilingualText[];
    /** Professional experience timeline. */
    experiences: ProfileExperience[];
    /** Academic credentials. */
    qualifications: ProfileQualification[];
    /** Teaching / working languages. */
    languages: ProfileLanguage[];
    /** Professional certificates. */
    certificates: ProfileCertificate[];
    /** https-only professional links. */
    links: ProfileLink[];
}

/** Reads a bilingual pair, preferring the namespaced value over the legacy one. */
function bilingualField(
    profile: InstructorProfile,
    key: keyof Pick<InstructorProfile, 'name' | 'jobTitle' | 'bio'>,
    legacyAr: unknown,
    legacyEn: unknown,
): BilingualText {
    const current = profile[key];
    if (current.ar || current.en) return current;
    // `bioEn` and `jobTitleEn` were separate legacy keys; `name` falls back to the
    // registration name, which `fullName` below already resolves.
    const ar = str(legacyAr);
    const en = str(legacyEn);
    return { ar, en };
}

export function toPublicInstructor(user: PublicUserSource): PublicInstructor {
    const md = asRecord(user.metadata);
    const profile = readInstructorProfile(md[PROFILE_KEY]);

    const fullName = str(md.fullName);
    const name = bilingualField(profile, 'name', md.nameAr ?? fullName, md.nameEn ?? fullName);
    const nameAr = str(name.ar) ?? fullName;
    const nameEn = str(name.en) ?? fullName;

    const jobTitle = bilingualField(profile, 'jobTitle', md.jobTitleAr, md.jobTitleEn);
    const bioLegacy = str(md.bio);
    const bio = bilingualField(profile, 'bio', bioLegacy, str(md.bioEn) || bioLegacy);

    // Legacy single `specialty` becomes a one-item list so the profile page can
    // render a list without caring whether the teacher used the old field.
    const legacySpecialty = str(md.specialty);
    const specialties = profile.specialties.length > 0
        ? profile.specialties
        : legacySpecialty ? [{ ar: legacySpecialty, en: legacySpecialty }] : [];
    const firstSpecialty = specialties[0] ?? null;
    const specialtyAr = str(firstSpecialty?.ar) ?? legacySpecialty;
    const specialtyEn = str(firstSpecialty?.en) ?? legacySpecialty;

    const yearsRaw = md.experienceYears;
    const legacyYears =
        typeof yearsRaw === 'number' && Number.isFinite(yearsRaw) && yearsRaw > 0 ? yearsRaw : null;

    // Same rule the sanitiser applies on write: our own uploads path only, with
    // ".." rejected so a stored value cannot climb out of the folder.
    const avatar = str(md.avatarUrl);
    const safeAvatar = avatar && /^\/uploads\/[A-Za-z0-9._/-]+$/.test(avatar) && !avatar.includes('..')
        ? avatar
        : null;

    return {
        id: user.id,
        nameAr,
        nameEn,
        avatarUrl: safeAvatar,
        jobTitleAr: str(jobTitle.ar),
        jobTitleEn: str(jobTitle.en),
        bioAr: str(bio.ar),
        bioEn: str(bio.en),
        specialtyAr,
        specialtyEn,
        experienceYears: profile.experienceYears ?? legacyYears,
        joinedAt: user.createdAt ?? null,
        // Mirrors the copy shown to the teacher ("complete your job title"):
        // a card is incomplete until it has both an identity and a headline.
        isProfileIncomplete: (!nameAr && !nameEn) || (!str(jobTitle.ar) && !str(jobTitle.en)),
        specialties,
        experiences: profile.experiences,
        qualifications: profile.qualifications,
        languages: profile.languages,
        certificates: profile.certificates,
        links: profile.links,
    };
}

/** The `instructor` select used on every public course payload. */
export const publicInstructorSelect = {
    id: true,
    createdAt: true,
    metadata: true,
} satisfies Prisma.UserSelect;

/**
 * Who counts as an instructor on a public route.
 *
 * This used to be `role IN (INSTRUCTOR, COURSE_MANAGER)`, which is a statement
 * about the *account* and not about the *teaching*. `Course.instructorId` and
 * `CourseOpening.instructorId` are both nullable-free FKs to `User`, so an
 * admin or a course manager can be the recorded teacher of a course while
 * holding neither of those two roles -- and then every public instructor route
 * hid them. The symptom was a 404 rather than an empty field: the course page
 * embeds `instructor: { id }` from `mapPublicCourse`, links that id to
 * `/public/instructors/:id`, and that route rejected the very user the course
 * page had just linked to. An instructor who filled in a full CV was one click
 * away from a "not found" page.
 *
 * So the predicate is now "teaches something, publicly", which is what the
 * routes actually mean. It cannot leak anything new: the email is still absent
 * from `PublicInstructor`, and these same users are already embedded, by id
 * and public fields only, in the public course payloads.
 *
 * `publishedOnly` is for the browse list, so a member of staff who only ever
 * touched an unpublished course is not enumerated. The detail route passes
 * `false`: a link that exists on a public page has to resolve.
 */
export function publicInstructorWhere(publishedOnly = false): Prisma.UserWhereInput {
    const courseLink = publishedOnly
        ? { coursesTaught: { some: { openings: { some: { isPublished: true } } } } }
        : { coursesTaught: { some: {} } };
    const openingLink = publishedOnly
        ? { openingsTaught: { some: { isPublished: true } } }
        : { openingsTaught: { some: {} } };

    return {
        isActive: true,
        ...(publishedOnly
            ? {
                  NOT: {
                      metadata: {
                          path: ['showOnInstructorsPage'],
                          equals: false,
                      },
                  },
              }
            : {}),
        OR: [
            { role: { in: [Role.INSTRUCTOR, Role.COURSE_MANAGER] } },
            courseLink,
            openingLink,
        ],
    };
}

/**
 * Rebuild the public instructor on a course and each of its openings.
 *
 * The public course routes used to select `instructor.email` directly, which
 * contradicted the comment in the same controller about not exposing it and let
 * anyone scrape every teacher's address. The email is no longer selected; this
 * replaces the raw user row with the derived public card.
 */
export function mapPublicCourse<
    T extends {
        instructor: { id: string; createdAt: Date; metadata: Prisma.JsonValue } | null;
        openings: Array<{
            instructor: { id: string; createdAt: Date; metadata: Prisma.JsonValue } | null;
        }>;
    },
>(course: T) {
    // Defensive: this is a pure projection, and the service is also exercised
    // with minimal course rows. A missing relation maps to `null` rather than
    // throwing, so the email scrubbing can never be the thing that breaks a
    // course request.
    const openings = Array.isArray(course.openings) ? course.openings : [];
    return {
        ...course,
        instructor: course.instructor ? toPublicInstructor(course.instructor) : null,
        openings: openings.map((opening) => ({
            ...opening,
            instructor: opening?.instructor ? toPublicInstructor(opening.instructor) : null,
        })),
    };
}
