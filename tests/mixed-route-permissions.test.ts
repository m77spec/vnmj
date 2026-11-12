import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Role } from '@prisma/client';
import { PERMISSIONS, permissionsForRole } from '../src/auth/permissions/permissions';

/**
 * Phase 4 of the boundary split: the mixed controllers — families that serve
 * both learner/owner routes AND platform routes out of the same file.
 *
 * Two halves of the §7 rule are pinned here:
 *
 *  1. Platform methods (staff-only @Roles) are ALSO permission-checked via
 *     @RequirePermissions, and every role that can call such a method today
 *     must hold the permission it declares (a narrower grant would be a
 *     silent privilege cut).
 *  2. Ownership/learner routes (student's own record, participation, or
 *     owner-or-staff handled inside the service) carry NO permission, so the
 *     platform capability surface is never granted as a side effect of a
 *     learner route.
 *
 * The fixture maps each annotated route to its permission, so a wrong
 * permission, a missed annotation or an accidental annotation on an ownership
 * route all fail loudly.
 */

const ROOT = join(__dirname, '..');

const MIXED_CONTROLLERS = [
    'src/learning-paths/learning-paths.controller.ts',
    'src/announcements/announcements.controller.ts',
    'src/commerce/commerce.controller.ts',
    'src/grades/grades.controller.ts',
    'src/certificates/certificates.controller.ts',
    'src/analytics/analytics.controller.ts',
    'src/refunds/refunds.controller.ts',
    'src/users/users.controller.ts',
    'src/lms/reviews.controller.ts',
    'src/lms/quizzes.controller.ts',
    'src/lms/lessons.controller.ts',
    'src/rubrics/rubrics.controller.ts',
    'src/tasks/tasks.controller.ts',
    'src/instructor-requests/instructor-requests.controller.ts',
    'src/live-sessions/live-sessions.controller.ts',
    'src/courses/course-openings.controller.ts',
    'src/calendar/calendar.controller.ts',
    'src/enrollments/enrollments.controller.ts',
    'src/chat/chat.controller.ts',
    'src/discussions/discussions.controller.ts',
];

/** Platform-only routes -> permission constant name (PERMISSIONS.X). */
const EXPECTED_PERMISSIONS: Record<string, [string, string, string][]> = {
    'src/learning-paths/learning-paths.controller.ts': [
        ['POST', '', 'PATHS_WRITE'],
        ['GET', 'manage', 'PATHS_WRITE'],
        ['GET', 'manage/courses', 'PATHS_WRITE'],
        ['PATCH', ':id', 'PATHS_WRITE'],
        ['DELETE', ':id', 'PATHS_WRITE'],
    ],
    'src/announcements/announcements.controller.ts': [
        ['POST', 'opening/:openingId', 'CONTENT_WRITE'],
        ['PATCH', ':id', 'CONTENT_WRITE'],
        ['DELETE', ':id', 'CONTENT_DELETE'],
        ['PATCH', ':id/toggle-publish', 'CONTENT_WRITE'],
    ],
    'src/commerce/commerce.controller.ts': [
        ['GET', 'payments', 'PAYMENTS_READ'],
        ['POST', 'currencies', 'PAYMENTS_SETTINGS'],
        ['PATCH', 'currencies/:code', 'PAYMENTS_SETTINGS'],
        ['DELETE', 'currencies/:code', 'PAYMENTS_SETTINGS'],
    ],
    'src/grades/grades.controller.ts': [
        ['GET', 'openings/:openingId/roster', 'GRADES_READ'],
        ['GET', 'openings/:openingId/assessments', 'GRADES_READ'],
        ['POST', 'openings/:openingId/assessments', 'GRADES_WRITE'],
        ['PATCH', 'assessments/:id', 'GRADES_WRITE'],
        ['DELETE', 'assessments/:id', 'GRADES_WRITE'],
        ['PUT', 'grades', 'GRADES_WRITE'],
        ['DELETE', 'grades/:enrollmentId/:assessmentId', 'GRADES_WRITE'],
    ],
    'src/certificates/certificates.controller.ts': [
        ['GET', 'template', 'CERTIFICATES_MANAGE'],
        ['PATCH', 'template', 'CERTIFICATES_MANAGE'],
        ['GET', 'management', 'CERTIFICATES_MANAGE'],
        ['GET', 'templates', 'CERTIFICATES_MANAGE'],
        ['POST', 'templates', 'CERTIFICATES_MANAGE'],
        ['DELETE', 'templates/:id', 'CERTIFICATES_MANAGE'],
        ['POST', 'template/assets', 'CERTIFICATES_MANAGE'],
        ['DELETE', 'template/assets/:kind', 'CERTIFICATES_MANAGE'],
        ['POST', 'template/branding-assets', 'CERTIFICATES_MANAGE'],
        ['GET', 'course/:courseId', 'CERTIFICATES_MANAGE'],
        ['GET', 'openings/:openingId/candidates', 'CERTIFICATES_ISSUE'],
        ['POST', 'openings/:openingId/issue', 'CERTIFICATES_ISSUE'],
        ['POST', ':id/revoke', 'CERTIFICATES_MANAGE'],
        ['POST', ':id/reissue', 'CERTIFICATES_MANAGE'],
    ],
    'src/analytics/analytics.controller.ts': [
        ['GET', 'course/:courseId', 'ANALYTICS_READ'],
        ['GET', 'instructor-dashboard', 'ANALYTICS_READ'],
    ],
    'src/refunds/refunds.controller.ts': [
        ['GET', '', 'REFUNDS_REVIEW'],
        ['PATCH', ':id', 'REFUNDS_REVIEW'],
        ['POST', ':id/complete', 'REFUNDS_REVIEW'],
    ],
    'src/users/users.controller.ts': [
        ['GET', '', 'USERS_READ'],
        ['POST', '', 'USERS_WRITE'],
        ['GET', ':id/details', 'USERS_READ'],
        ['GET', ':id', 'USERS_READ'],
        ['PATCH', ':id', 'USERS_WRITE'],
        ['PATCH', ':id/role', 'USERS_ROLE'],
        ['PATCH', ':id/two-factor/disable', 'USERS_WRITE'],
        ['DELETE', ':id', 'USERS_DELETE'],
    ],
    'src/lms/reviews.controller.ts': [
        ['PATCH', ':id/moderation', 'CONTENT_WRITE'],
    ],
    'src/lms/quizzes.controller.ts': [
        ['POST', '', 'COURSES_WRITE'],
        ['PATCH', ':id', 'COURSES_WRITE'],
        ['DELETE', ':id', 'COURSES_DELETE'],
        ['GET', 'admin/manage/opening/:openingId', 'CONTENT_READ'],
        ['POST', 'admin/manage/opening/:openingId', 'CONTENT_WRITE'],
        ['PATCH', 'admin/manage/opening/:openingId/:id', 'CONTENT_WRITE'],
        ['DELETE', 'admin/manage/opening/:openingId/:id', 'CONTENT_DELETE'],
    ],
    'src/lms/lessons.controller.ts': [],
    'src/rubrics/rubrics.controller.ts': [
        ['POST', 'task/:taskId', 'CONTENT_WRITE'],
        ['POST', ':id/assign', 'CONTENT_WRITE'],
    ],
    'src/tasks/tasks.controller.ts': [
        ['POST', 'opening/:openingId', 'CONTENT_WRITE'],
        ['GET', 'opening/:openingId/roster', 'CONTENT_READ'],
        ['PATCH', ':id', 'CONTENT_WRITE'],
        ['DELETE', ':id', 'CONTENT_DELETE'],
        ['GET', 'submissions', 'GRADES_READ'],
        ['GET', ':id/submissions', 'GRADES_READ'],
        ['PATCH', 'submissions/:submissionId/grade', 'GRADES_WRITE'],
    ],
    'src/instructor-requests/instructor-requests.controller.ts': [
        ['GET', 'openings', 'INSTRUCTORS_READ'],
        ['PATCH', 'openings/:id/status', 'INSTRUCTORS_REVIEW'],
        ['DELETE', 'openings/:id', 'INSTRUCTORS_REVIEW'],
        ['GET', 'closures', 'INSTRUCTORS_READ'],
        ['PATCH', 'closures/:id/status', 'INSTRUCTORS_REVIEW'],
        ['DELETE', 'closures/:id', 'INSTRUCTORS_REVIEW'],
        ['GET', 'suggestions', 'INSTRUCTORS_READ'],
        ['PATCH', 'suggestions/:id/status', 'INSTRUCTORS_REVIEW'],
        ['DELETE', 'suggestions/:id', 'INSTRUCTORS_REVIEW'],
    ],
    'src/live-sessions/live-sessions.controller.ts': [
        ['GET', '', 'CONTENT_READ'],
        ['POST', '', 'OPENINGS_WRITE'],
        ['PATCH', ':id', 'OPENINGS_WRITE'],
        ['DELETE', ':id', 'OPENINGS_WRITE'],
        ['GET', ':id/attendance', 'GRADES_READ'],
        ['PUT', ':id/attendance', 'GRADES_WRITE'],
    ],
    'src/courses/course-openings.controller.ts': [
        ['GET', ':id/oversight', 'CONTENT_READ'],
        ['GET', ':id/instructor-grants', 'OPENINGS_WRITE'],
        ['PUT', ':id/instructor-grants', 'OPENINGS_WRITE'],
        ['PATCH', ':id', 'OPENINGS_WRITE'],
        ['POST', ':id/publish', 'OPENINGS_WRITE'],
        ['POST', ':id/unpublish', 'OPENINGS_WRITE'],
        ['POST', ':id/announcement', 'OPENINGS_WRITE'],
        ['POST', ':id/open', 'OPENINGS_WRITE'],
        ['POST', ':id/start', 'OPENINGS_WRITE'],
        ['POST', ':id/end', 'OPENINGS_WRITE'],
        ['POST', ':id/restore', 'OPENINGS_WRITE'],
        ['DELETE', ':id', 'OPENINGS_DELETE'],
    ],
    'src/calendar/calendar.controller.ts': [
        ['POST', 'opening/:openingId', 'OPENINGS_WRITE'],
        ['DELETE', ':id', 'OPENINGS_WRITE'],
    ],
    'src/enrollments/enrollments.controller.ts': [
        ['POST', 'admin', 'ENROLLMENTS_WRITE'],
        ['GET', 'pending', 'ENROLLMENTS_REVIEW'],
        ['GET', 'all', 'ENROLLMENTS_READ'],
        ['GET', 'course/:courseId', 'ENROLLMENTS_READ'],
        ['GET', 'opening/:openingId', 'ENROLLMENTS_READ'],
        ['PATCH', ':id/review', 'ENROLLMENTS_REVIEW'],
    ],
    'src/chat/chat.controller.ts': [],
    'src/discussions/discussions.controller.ts': [],
};

function normalizeToken(token: string): string {
    if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
        return token.slice(1, -1);
    }
    if (token.startsWith('Role.')) return token.slice('Role.'.length);
    return token;
}

/** Local `const STAFF = [Role.A, Role.B]` arrays a @Roles(...) may spread. */
function constantsIn(src: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const m of src.matchAll(/const\s+([A-Z_][A-Z_0-9]*)\s*=\s*\[([^\]]*)\]/g)) {
        const roles = [...m[2].matchAll(/'[^']*'|"[^"]*"|Role\.[A-Z_]+/g)].map((t) => normalizeToken(t[0]));
        out.set(m[1], roles);
    }
    return out;
}

function parseRoles(text: string, consts: Map<string, string[]>): string[] {
    const roles: string[] = [];
for (const m of text.matchAll(/@Roles\(([^)]*)\)/g)) {
            for (const tok of m[1].matchAll(/(\.\.\.)?(?:Role\.)?([A-Z_][A-Z_0-9]*|'[^']*'|"[^"]*")/g)) {
            const spread = tok[1] === '...';
            const name = normalizeToken(tok[2]);
            if (spread) {
                const expanded = consts.get(name);
                assert.ok(expanded, `${name} is spread into @Roles but not defined in the file`);
                roles.push(...expanded);
            } else {
                roles.push(name);
            }
        }
    }
    return roles;
}

function cleanPath(raw: string): string {
    let p = raw.trim();
    if (p.startsWith("'") && p.endsWith("'")) p = p.slice(1, -1);
    else if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    return p;
}

interface Block {
    method: string;
    path: string;
    header: string;
}

function blocksIn(src: string): Block[] {
    const blocks: Block[] = [];
    const routeRe = /@(Get|Post|Put|Patch|Delete)\(([^\n]*)\)/g;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(src)) !== null) {
        blocks.push({
            method: m[1].toUpperCase(),
            path: cleanPath(m[2]),
            header: src.slice(lastEnd, m.index),
        });
        lastEnd = routeRe.lastIndex;
    }
    return blocks;
}

function classLevelRoles(src: string, consts: Map<string, string[]>): string[] | null {
    const m = src.match(/@Roles\([^)]*\)\s*\n\s*@Controller/);
    return m ? parseRoles(m[0], consts) : null;
}

test('Phase 4 fixture is wired and fully annotated', () => {
    const total = Object.values(EXPECTED_PERMISSIONS).reduce((sum, rows) => sum + rows.length, 0);
    assert.equal(total, 99, 'the mixed-surface fixture drifted from the 99 annotated platform routes');

    for (const rel of MIXED_CONTROLLERS) {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        const consts = constantsIn(src);
        const fallbackRoles = classLevelRoles(src, consts);

        for (const block of blocksIn(src)) {
            const declaredPerms = block.header.match(/@RequirePermissions\(([^)]*)\)/g) ?? [];
            const expected = (EXPECTED_PERMISSIONS[rel] ?? []).find(
                (e) => e[0] === block.method && e[1] === block.path,
            );

            if (expected) {
                const permName = expected[2];
                assert.equal(
                    declaredPerms.length,
                    1,
                    `${rel} ${block.method} ${block.path || '/'} must carry exactly one permission`,
                );
                assert.ok(
                    block.header.includes(`@RequirePermissions(PERMISSIONS.${permName})`),
                    `${rel} ${block.method} ${block.path || '/'} must require PERMISSIONS.${permName}, got: ${declaredPerms}`,
                );

                // §7 rule 2: no privilege cut — every role allowed today holds it.
                const roles = parseRoles(block.header, consts);
                const effective = roles.length > 0 ? roles : (fallbackRoles ?? []);
                assert.ok(effective.length > 0, `${rel} ${block.method} ${block.path || '/'} restricts nobody`);
                const permission = PERMISSIONS[permName as keyof typeof PERMISSIONS];
                for (const role of effective) {
                    assert.ok(
                        (Role as Record<string, string>)[role],
                        `${rel}: ${role} is not a known role in the permission check`,
                    );
                    assert.ok(
                        permissionsForRole(role as Role).includes(permission),
                        `${rel}: ${block.method} ${block.path || '/'} requires ${permission} but ${role} -- who can call it today -- does not hold it`,
                    );
                }
            } else {
                assert.deepEqual(
                    declaredPerms,
                    [],
                    `${rel} ${block.method} ${block.path || '/'} is an ownership/learner route and must NOT carry @RequirePermissions`,
                );
            }
        }
    }
});

test('Phase 4 controllers that annotate routes also mount PermissionsGuard', () => {
    for (const rel of MIXED_CONTROLLERS) {
        if ((EXPECTED_PERMISSIONS[rel] ?? []).length === 0) continue;
        const src = readFileSync(join(ROOT, rel), 'utf8');
        assert.ok(src.includes('PermissionsGuard'), `${rel} annotates permissions but never registers the guard`);
    }
});

test('Phase 4 annotation count per controller matches the fixture', () => {
    for (const rel of MIXED_CONTROLLERS) {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        const annotated = (src.match(/@RequirePermissions\(/g) ?? []).length;
        const expected = (EXPECTED_PERMISSIONS[rel] ?? []).length;
        assert.equal(annotated, expected, `${rel}: ${annotated} @RequirePermissions found but ${expected} expected`);
    }
});