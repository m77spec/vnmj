import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserAgent, pickSafeMeta, clampText } from '../src/operations/operations-parser';
import { OperationsService, readCookie } from '../src/operations/operations.service';
import { OperationsKeyService, OperationsTrackerMiddleware } from '../src/operations/operations-tracker.middleware';
import { OperationsController } from '../src/operations/operations.controller';
import { AdminOperationsController } from '../src/operations/admin-operations.controller';
import { OperationsSettingsService } from '../src/operations/operations-settings.service';
import { OperationsQueriesService } from '../src/operations/operations-queries.service';
import { EventsQueryDto, SessionsQueryDto } from '../src/operations/dto/operations.dto';
import { plainToInstance } from 'class-transformer';
import { UnauthorizedException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { generateSecret, generateSync } from 'otplib';

/**
 * Tests for the operations center.
 *
 * The security-relevant claims are the ones asserted here, because each is a
 * boundary that a later refactor can quietly break:
 *
 *   - the second password must fail CLOSED when unset (an unset key locking the
 *     page is correct; an unset key opening it is a catastrophic regression),
 *   - a grant must not be substitutable by a normal access token,
 *   - request bodies must never reach the event log,
 *   - a browser must not be able to forge a server-authored event type,
 *   - the visitor cache must not grow without bound,
 *   - a session must never be labelled with an unverified token identity.
 */

const SECRET = 'a'.repeat(48);

function buildService(over: { onTouch?: () => void } = {}) {
    const prisma: any = {
        visitSession: {
            findUnique: async () => null,
            create: async ({ data }: any) => ({ id: `sess_${data.visitorId.slice(0, 8)}` }),
            update: async () => {
                over.onTouch?.();
            },
        },
        visitEvent: { create: async () => ({}) },
    };
    return new OperationsService(prisma);
}

function req(over: { headers?: Record<string, unknown>; url?: string; method?: string; ip?: string; cookie?: string } = {}) {
    return {
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
            // Cookies reach the server in the `Cookie` header, which is what the
            // hand-rolled reader parses -- `req.cookies` only exists once
            // cookie-parser has run, and this app does not use it.
            ...(over.cookie !== undefined ? { cookie: over.cookie } : {}),
            ...(over.headers ?? {}),
        },
        originalUrl: over.url ?? '/courses',
        url: over.url ?? '/courses',
        method: over.method ?? 'GET',
        ip: over.ip ?? '203.0.113.7',
    } as any;
}

describe('OPERATIONS: user-agent classification', () => {
    test('distinguishes Chromium from Safari', () => {
        // The ordering bug this guards: Chrome's UA contains "Safari", so a
        // naive Safari-first check reports every Chromium browser as Safari.
        const chrome = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        assert.equal(chrome.browser, 'Chrome');
        assert.equal(chrome.os, 'Windows');

        const safari = parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15');
        assert.equal(safari.browser, 'Safari');
        assert.equal(safari.os, 'macOS');
    });

    test('detects Edge and Opera before their Chrome claim', () => {
        assert.equal(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0').browser, 'Edge');
        assert.equal(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0').browser, 'Opera');
    });

    test('separates tablet from phone', () => {
        const ipad = parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1');
        assert.equal(ipad.deviceType, 'tablet');
        assert.equal(ipad.os, 'iOS');

        const iphone = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
        assert.equal(iphone.deviceType, 'mobile');

        const androidPhone = parseUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
        assert.equal(androidPhone.deviceType, 'mobile');
        assert.equal(androidPhone.os, 'Android');

        const androidTablet = parseUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
        assert.equal(androidTablet.deviceType, 'tablet');
    });

    test('classifies crawlers as bots, not desktop browsers', () => {
        // A bot UA usually also carries "Safari" and "Intel"; if bot detection
        // ran after browser detection it would show up in the desktop list and
        // bury genuine traffic.
        for (const ua of [
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
            'facebookexternalhit/1.1',
            'curl/8.4.0',
            'PostmanRuntime/7.35.0',
            'python-requests/2.31.0',
        ]) {
            const parsed = parseUserAgent(ua);
            assert.equal(parsed.isBot, true, `expected bot: ${ua}`);
            assert.equal(parsed.deviceType, 'bot');
        }
    });

    test('separates smart TVs from desktop Linux', () => {
        const parsed = parseUserAgent('Mozilla/5.0 (Linux; Android 11; SmartTV) AppleWebKit/537.36 Chrome/94.0 Safari/537.36');
        assert.equal(parsed.deviceType, 'tv');
    });

    test('returns unknown rather than guessing on an empty UA', () => {
        for (const input of ['', '   ', null, undefined]) {
            const parsed = parseUserAgent(input as any);
            assert.equal(parsed.deviceType, 'unknown');
            assert.equal(parsed.isBot, false);
        }
    });
});

describe('OPERATIONS: event metadata cannot become a credential store', () => {
    test('drops everything not on the allow-list', () => {
        const meta = pickSafeMeta({
            resourceId: 'course_123',
            count: 4,
            // The shapes that must never be persisted:
            password: 'hunter2',
            token: 'eyJhbGciOi...',
            cardNumber: '4242424242424242',
            cvv: '123',
            email: 'victim@example.com',
        });
        assert.deepEqual(meta, { resourceId: 'course_123', count: 4 });
        assert.equal(JSON.stringify(meta).includes('hunter2'), false);
        assert.equal(JSON.stringify(meta).includes('4242'), false);
    });

    test('ignores non-scalars and long strings', () => {
        assert.equal(pickSafeMeta({ resourceId: { nested: true } }), undefined);
        const clamped = pickSafeMeta({ resourceId: 'x'.repeat(500) })!.resourceId;
        assert.equal(typeof clamped, 'string');
        assert.equal((clamped as string).length, 120);
        assert.equal(pickSafeMeta(null), undefined);
        assert.equal(pickSafeMeta([1, 2, 3]), undefined);
        assert.equal(pickSafeMeta('a string'), undefined);
    });

    test('clamps text and treats blanks as absent', () => {
        assert.equal(clampText('x'.repeat(900), 512)!.length, 512);
        assert.equal(clampText('   ', 10), null);
        assert.equal(clampText(undefined, 10), null);
        assert.equal(clampText('hello', 10), 'hello');
    });
});

/**
 * A minimal in-memory Prisma stand-in for the settings service.
 *
 * Only the operations models are modelled, and the allowlist is a real Set so the
 * "cannot empty the list" rule is exercised against actual state changes rather
 * than a stub that returns whatever the assertion expects.
 */
function buildSettings(over: {
    keyHash?: string | null;
    keyVersion?: number;
    users?: Record<string, { role: string; isActive: boolean }>;
    allowlist?: string[];
} = {}) {
    const state = {
        keyHash: over.keyHash ?? null,
        keyVersion: over.keyVersion ?? 1,
        users: over.users ?? { 'admin-1': { role: 'ADMIN', isActive: true } } as Record<string, { role: string; isActive: boolean }>,
        allowlist: new Set(over.allowlist ?? []),
    };
    const prisma: any = {
        operationsSetting: {
            findUnique: async () => (state.keyHash === null && state.keyVersion === 1 && !state.allowlist.size
                ? null
                : { id: 'singleton', keyHash: state.keyHash, keyVersion: state.keyVersion }),
            create: async ({ data }: any) => {
                state.keyHash = data.keyHash ?? null;
                state.keyVersion = data.keyVersion ?? 1;
                return { id: 'singleton', ...data };
            },
            upsert: async ({ create, update }: any) => {
                if (state.keyHash === null && state.keyVersion === 1) {
                    state.keyHash = create.keyHash;
                    state.keyVersion = create.keyVersion;
                } else {
                    state.keyHash = update.keyHash;
                    state.keyVersion += update.keyVersion.increment;
                }
                return { id: 'singleton', keyHash: state.keyHash, keyVersion: state.keyVersion };
            },
        },
        operationsAllowlistEntry: {
            count: async () => state.allowlist.size,
            findUnique: async ({ where }: any) => (state.allowlist.has(where.userId) ? { id: 'e', userId: where.userId } : null),
            findMany: async () => [...state.allowlist].map((userId) => ({
                id: `e_${userId}`, userId, grantedById: null, createdAt: new Date(0),
                user: { id: userId, email: `${userId}@example.com`, name: userId, role: 'ADMIN', isActive: true },
            })),
            create: async ({ data }: any) => {
                state.allowlist.add(data.userId);
                return { id: 'e', ...data };
            },
            deleteMany: async ({ where }: any) => {
                const had = state.allowlist.delete(where.userId);
                return { count: had ? 1 : 0 };
            },
        },
        user: {
            findUnique: async ({ where }: any) => state.users[where.id] ?? null,
            findMany: async () => Object.entries(state.users)
                .filter(([, u]) => u.role === 'ADMIN' && u.isActive)
                .map(([id, u]) => ({ id, email: `${id}@example.com`, name: id, lastLoginAt: null })),
        },
    };
    const svc = new OperationsSettingsService(prisma);
    return { svc, state };
}

describe('OPERATIONS: the second password fails closed', () => {
    beforeEach(() => {
        process.env.OPERATIONS_KEY = 'correct-horse-battery-staple';
        process.env.JWT_SECRET = SECRET;
    });

    test('rejects when OPERATIONS_KEY is unset', async () => {
        delete process.env.OPERATIONS_KEY;
        const { svc } = buildSettings();
        // This is the load-bearing assertion of the whole feature: an unset
        // variable must LOCK the page. If it ever returns true, anyone with an
        // admin token can read the device log with no second factor.
        assert.equal(await svc.verifyKey('anything'), false);
        assert.equal(await svc.verifyKey(undefined), false);
    });

    test('rejects wrong, right-length-wrong, and empty keys', async () => {
        const { svc } = buildSettings();
        assert.equal(await svc.verifyKey('wrong'), false);
        assert.equal(await svc.verifyKey('correct-horse-battery-stapl'), false, 'prefix must not pass');
        assert.equal(await svc.verifyKey('correct-horse-battery-staples'), false, 'extension must not pass');
        assert.equal(await svc.verifyKey(''), false);
        assert.equal(await svc.verifyKey(undefined), false);
    });

    test('accepts only the exact key', async () => {
        const { svc } = buildSettings();
        assert.equal(await svc.verifyKey('correct-horse-battery-staple'), true);
    });
});

describe('OPERATIONS: a stored password is a bcrypt hash and beats the env var', () => {
    beforeEach(() => {
        process.env.OPERATIONS_KEY = 'correct-horse-battery-staple';
        process.env.JWT_SECRET = SECRET;
    });

    test('never stores the password in plain text', async () => {
        const { svc, state } = buildSettings();
        await svc.setKey('a-long-new-password', 'admin-1');
        assert.ok(state.keyHash, 'a hash must exist after setting a password');
        assert.notEqual(state.keyHash, 'a-long-new-password');
        // $2a$/$2b$ prefix is what makes this a bcrypt digest rather than a
        // reversible encoding.
        assert.match(state.keyHash!, /^\$2[aby]\$\d{2}\$/);
    });

    test('the env var stops working once a password is set in-app', async () => {
        const { svc } = buildSettings();
        await svc.setKey('a-long-new-password', 'admin-1');
        // The whole reason rotation has to touch the database: if OPERATIONS_KEY
        // still opened the page, changing the password in the UI would be a lie.
        assert.equal(await svc.verifyKey('correct-horse-battery-staple'), false, 'stale env key must stop working');
        assert.equal(await svc.verifyKey('a-long-new-password'), true);
    });

    test('changing the password bumps the version so old grants die', async () => {
        const { svc, state } = buildSettings();
        await svc.setKey('a-long-new-password', 'admin-1');
        const first = state.keyVersion;
        await svc.setKey('another-long-password', 'admin-1');
        assert.ok(state.keyVersion > first, 'keyVersion must increase on rotation');
    });

    test('refuses a password too short to be worth hashing', async () => {
        const { svc } = buildSettings();
        await assert.rejects(() => svc.setKey('short', 'admin-1'), /at least 12 characters/);
    });
});

describe('OPERATIONS: the allowlist gates who may read', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = SECRET;
    });

    test('an empty list means any active admin', async () => {
        const { svc } = buildSettings();
        assert.equal(await svc.isAllowed('admin-1'), true);
    });

    test('a non-empty list excludes admins who are not on it', async () => {
        const {
            svc,
        } = buildSettings({
            allowlist: ['admin-2'],
            users: { 'admin-1': { role: 'ADMIN', isActive: true }, 'admin-2': { role: 'ADMIN', isActive: true } },
        });
        assert.equal(await svc.isAllowed('admin-2'), true);
        assert.equal(await svc.isAllowed('admin-1'), false);
        assert.equal(await svc.isAllowed('nobody'), false);
    });

    test('being on the list does not survive a role change or a suspension', async () => {
        const { svc } = buildSettings({
            allowlist: ['admin-1'],
            users: { 'admin-1': { role: 'ADMIN', isActive: true } },
        });
        assert.equal(await svc.isAllowed('admin-1'), true);

        // The JWT still says ADMIN. Only a database read catches this, which is
        // why the controller re-checks on every request instead of trusting the
        // role claim for the life of the grant.
        const demoted = buildSettings({
            allowlist: ['admin-1'],
            users: { 'admin-1': { role: 'INSTRUCTOR', isActive: true } },
        });
        assert.equal(await demoted.svc.isAllowed('admin-1'), false);

        const suspended = buildSettings({
            allowlist: ['admin-1'],
            users: { 'admin-1': { role: 'ADMIN', isActive: false } },
        });
        assert.equal(await suspended.svc.isAllowed('admin-1'), false);
    });

    test('the last entry cannot be removed', async () => {
        const { svc } = buildSettings({ allowlist: ['admin-1'] });
        // An empty list is the "any admin" fallback, so this would not actually
        // lock anyone out -- but silently widening access via a "remove" click is
        // never what the operator meant. Clearing the list is a separate,
        // deliberate gesture.
        await assert.rejects(() => svc.removeFromAllowlist('admin-1', 'admin-1'), /last allowed admin/i);
    });

    test('an admin may remove themselves while another remains', async () => {
        const { svc, state } = buildSettings({
            allowlist: ['admin-1', 'admin-2'],
            users: { 'admin-1': { role: 'ADMIN', isActive: true }, 'admin-2': { role: 'ADMIN', isActive: true } },
        });
        const result = await svc.removeFromAllowlist('admin-1', 'admin-1');
        assert.equal(result.removedSelf, true);
        assert.equal(state.allowlist.has('admin-1'), false);
        assert.equal(await svc.isAllowed('admin-1'), false);
    });

    test('refuses to list a non-admin, which would grant nothing', async () => {
        const { svc } = buildSettings({
            users: { 'admin-1': { role: 'ADMIN', isActive: true }, 'user-9': { role: 'INSTRUCTOR', isActive: true } },
        });
        await assert.rejects(() => svc.addToAllowlist('user-9', 'admin-1'), /Only ADMIN/);
        await assert.rejects(() => svc.addToAllowlist('missing', 'admin-1'), /User not found/);
    });
});

describe('OPERATIONS: a grant is not interchangeable with an access token', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = SECRET;
    });

    test('issues a grant that verifies for its own user only', () => {
        const keys = new OperationsKeyService(buildService());
        const { grant } = keys.issueGrant('admin-1', 3);
        assert.equal(keys.verifyGrant(grant, 'admin-1', 3), true);
        // Bound to the subject: a grant lifted from one admin must not unlock
        // the page for another.
        assert.equal(keys.verifyGrant(grant, 'admin-2', 3), false);
    });

    test('refuses a plain access token, which carries no opsGrant claim', () => {
        // This is the collision that matters: an admin's everyday bearer token
        // must NOT satisfy the operations gate, or the second password is
        // decorative. Minted with the same secret and algorithm on purpose.
        const jwt = require('jsonwebtoken');
        const accessToken = jwt.sign({ sub: 'admin-1', email: 'a@b.c', role: 'ADMIN', tv: 0 }, SECRET, { algorithm: 'HS256' });
        const keys = new OperationsKeyService(buildService());
        assert.equal(keys.verifyGrant(accessToken, 'admin-1', 3), false);
    });

    test('refuses garbage and a tampered grant', () => {
        const keys = new OperationsKeyService(buildService());
        assert.equal(keys.verifyGrant('not-a-token', 'admin-1', 3), false);
        assert.equal(keys.verifyGrant(undefined, 'admin-1', 3), false);

        const { grant } = keys.issueGrant('admin-1', 3);
        const jwt = require('jsonwebtoken');
        // Re-sign the same claims with the attacker's own key.
        const forged = jwt.sign({ sub: 'admin-1', opsGrant: true, kv: 3 }, 'attacker-secret', { algorithm: 'HS256' });
        assert.equal(keys.verifyGrant(forged, 'admin-1', 3), false);
        assert.notEqual(grant, forged);
    });

    test('an expired grant stops working', () => {
        const jwt = require('jsonwebtoken');
        const keys = new OperationsKeyService(buildService());
        const expired = jwt.sign({ sub: 'admin-1', opsGrant: true, kv: 3 }, SECRET, { algorithm: 'HS256', expiresIn: -10 });
        assert.equal(keys.verifyGrant(expired, 'admin-1', 3), false);
    });

    test('a grant minted under an older password version stops working', () => {
        const keys = new OperationsKeyService(buildService());
        const { grant } = keys.issueGrant('admin-1', 3);
        // Perfectly signed, perfectly unexpired, and worthless: the password it
        // was issued under has since been rotated. This is what makes rotation
        // actually revoke instead of merely suggest.
        assert.equal(keys.verifyGrant(grant, 'admin-1', 4), false);
    });

    test('a grant predating versioning is refused rather than trusted', () => {
        const jwt = require('jsonwebtoken');
        const keys = new OperationsKeyService(buildService());
        const legacy = jwt.sign({ sub: 'admin-1', opsGrant: true }, SECRET, { algorithm: 'HS256', expiresIn: 3600 });
        // Accepting an unversioned grant would be the fail-open choice: after a
        // deploy, an hour-old stolen grant would keep reading. Refusing it means
        // everyone re-unlocks once, which is the correct cost.
        assert.equal(keys.verifyGrant(legacy, 'admin-1', 1), false);
    });
});

describe('OPERATIONS: changing the password needs more than a grant', () => {
    beforeEach(() => {
        process.env.JWT_SECRET = SECRET;
    });

    function buildController(over: { currentKeyOk?: boolean } = {}) {
        const keys = { issueGrant: () => ({ grant: 'g', expiresAt: 'later' }), verifyGrant: () => true } as any;
        const ops = {
            verifyOperationsKey: () => true,
            trackClientEvent: async () => {}, enrichSession: async () => {},
            trackSecurity: async () => {}, hashIp: () => 'h',
        } as any;
        const queries = {} as any;
        const securityEvents: string[] = [];
        const settings = {
            verifyKey: async () => over.currentKeyOk ?? true,
            isAllowed: async () => true,
            assertAllowed: async () => {},
            currentKeyVersion: async () => 2,
            state: async () => ({ hasPassword: true, keyVersion: 2, allowlistEmpty: true, allowlistSize: 0 }),
            setKey: async () => 3,
            listAllowlist: async () => [],
            listEligibleAdmins: async () => [],
        } as any;
        const controller = new AdminOperationsController(
            ops, queries, keys, settings,
            { user: { findUnique: async () => null } } as any,
            { decrypt: (value: string) => value } as any,
        );
        return { controller, securityEvents };
    }

    test('rejects a password change when the current password is wrong', async () => {
        const { controller } = buildController({ currentKeyOk: false });
        const r = req();
        r.user = { userId: 'admin-1' };
        // A valid grant alone is not enough. It sits in sessionStorage for an
        // hour, so trusting it to authorise a permanent credential change would
        // let a single XSS take the door over forever.
        await assert.rejects(
            () => controller.setPassword(r, 'grant', { currentPassword: 'wrong', newPassword: 'a-long-enough-one', confirmPassword: 'a-long-enough-one' }),
            UnauthorizedException,
        );
    });

    test('rejects a mismatched confirmation', async () => {
        const { controller } = buildController();
        const r = req();
        r.user = { userId: 'admin-1' };
        await assert.rejects(
            () => controller.setPassword(r, 'grant', { currentPassword: 'cur', newPassword: 'a-long-enough-one', confirmPassword: 'different-one-here' }),
            /do not match/,
        );
    });

    test('refuses to "rotate" into the password that is already set', async () => {
        const { controller } = buildController();
        const r = req();
        r.user = { userId: 'admin-1' };
        // A typo here would bump the version and sign every other unlocked tab
        // out while the owner believes nothing changed.
        await assert.rejects(
            () => controller.setPassword(r, 'grant', { currentPassword: 'same-password-here', newPassword: 'same-password-here', confirmPassword: 'same-password-here' }),
            /must be different/,
        );
    });

    test('returns the new key version so other tabs know to re-unlock', async () => {
        const { controller } = buildController();
        const r = req();
        r.user = { userId: 'admin-1' };
        assert.deepEqual(
            await controller.setPassword(r, 'grant', { currentPassword: 'cur', newPassword: 'a-long-enough-one', confirmPassword: 'a-long-enough-one' }),
            { ok: true, keyVersion: 3 },
        );
    });
});

describe('OPERATIONS: the session is never labelled with an unverified identity', () => {
    /**
     * The middleware labels a session with the token's `sub` before the guards
     * run. That label is what the UI shows as "who did this", so a forged token
     * would file someone else's activity under a real account -- the exact thing
     * an audit log must not allow.
     */
    /** `secret: null` simulates an unset JWT_SECRET. */
    function userIdFor(authorization: string | undefined, secret: string | null = SECRET): string | null {
        const previous = process.env.JWT_SECRET;
        if (secret === null) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = secret;
        try {
            const mw: any = new OperationsTrackerMiddleware(buildService());
            return mw.readUserId({ headers: authorization ? { authorization } : {} });
        } finally {
            if (previous === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = previous;
        }
    }

    test('reads the subject from a correctly signed token', () => {
        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ sub: 'user-7', role: 'STUDENT' }, SECRET, { algorithm: 'HS256' });
        assert.equal(userIdFor(`Bearer ${token}`), 'user-7');
    });

    test('ignores a self-signed token that names somebody else', () => {
        const jwt = require('jsonwebtoken');
        const forged = jwt.sign({ sub: 'admin-1' }, 'attacker-secret', { algorithm: 'HS256' });
        assert.equal(userIdFor(`Bearer ${forged}`), null);
    });

    test('ignores an unsigned alg-none token', () => {
        // `alg: none` is the classic downgrade: verification must not be skipped.
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify({ sub: 'admin-1' })).toString('base64url');
        assert.equal(userIdFor(`Bearer ${header}.${body}.`), null);
    });

    test('an absent or malformed header yields null rather than throwing', () => {
        assert.equal(userIdFor(undefined), null);
        assert.equal(userIdFor('Basic dXNlcjpwYXNz'), null);
        assert.equal(userIdFor('Bearer not-a-token'), null);
    });

    test('with no JWT_SECRET configured the session is simply anonymous', () => {
        const jwt = require('jsonwebtoken');
        // Failing open here would mean an unconfigured deployment quietly labels
        // every session, so the safe direction is to treat it as anonymous.
        const token = jwt.sign({ sub: 'user-7' }, SECRET, { algorithm: 'HS256' });
        assert.equal(userIdFor(`Bearer ${token}`, null), null);
    });
});

describe('OPERATIONS: the session cache stays bounded', () => {
    test('expires and prunes entries', () => {
        const svc = buildService();
        const now = Date.now();
        svc.sessionCache.set('a', { sessionId: '1', expiresAt: now - 1, authenticated: false });
        svc.sessionCache.set('b', { sessionId: '2', expiresAt: now + 60_000, authenticated: false });
        assert.equal(svc.pruneSessionCache(now), 1);
        assert.equal(svc.sessionCache.size, 1);
    });

    test('a repeat request does not re-read the session row', async () => {
        // The reason the cache exists: without it, every request on the platform
        // costs a SELECT, and the anonymous majority is most of the traffic.
        let reads = 0;
        const prisma: any = {
            visitSession: {
                findUnique: async () => { reads++; return { id: 'existing', userId: null }; },
                create: async () => ({ id: 'created' }),
                update: async () => {},
            },
            visitEvent: { create: async () => ({}) },
        };
        const svc = new OperationsService(prisma);
        const request = req({ cookie: 'laxalab_vid=11111111-1111-4111-8111-111111111111' });

        for (let i = 0; i < 10; i++) await svc.resolveSession(request, { userId: null });
        assert.equal(reads, 1, 'expected exactly one lookup for ten requests');
    });

    test('a session is promoted once without a per-request database update', async () => {
        let reads = 0;
        let updates = 0;
        let storedUserId: string | null = null;
        const prisma: any = {
            visitSession: {
                findUnique: async () => {
                    reads++;
                    return { id: 'existing', userId: storedUserId };
                },
                update: async ({ data }: any) => {
                    updates++;
                    storedUserId = data.userId ?? storedUserId;
                },
            },
            visitEvent: { create: async () => ({}) },
        };
        const svc = new OperationsService(prisma);
        const request = req({ cookie: 'laxalab_vid=33333333-3333-4333-8333-333333333333' });

        await svc.resolveSession(request, { userId: 'user-1' });
        await svc.resolveSession(request, { userId: 'user-1' });

        assert.equal(storedUserId, 'user-1', 'the session must retain its authenticated owner');
        assert.equal(reads, 1, 'the cache should avoid a second session lookup');
        assert.equal(updates, 1, 'promotion should write once, not once per request');
    });
});

describe('OPERATIONS: concurrent first visits do not error', () => {
    test('a unique-index collision resolves to the winning row', async () => {
        // visitorId is UNIQUE, and a browser fires several requests at once on
        // first load. Both miss the SELECT and race into INSERT; the loser gets
        // P2002 and must recover by re-reading, not throw.
        let creates = 0;
        const prisma: any = {
            visitSession: {
                findUnique: async ({ where }: any) => {
                    if (creates > 0) return { id: 'winner', userId: null };
                    return null;
                },
                create: async () => {
                    creates++;
                    if (creates === 1) {
                        const err: any = new Error('Unique constraint failed');
                        err.code = 'P2002';
                        throw err;
                    }
                    return { id: 'winner' };
                },
                update: async () => {},
            },
            visitEvent: { create: async () => ({}) },
        };
        const svc = new OperationsService(prisma);
        const request = req({ cookie: 'laxalab_vid=22222222-2222-4222-8222-222222222222' });
        const result = await svc.resolveSession(request, { userId: null });
        assert.ok(result, 'a collision must resolve, not throw');
        assert.equal(result.sessionId, 'winner');
        assert.equal(result.isNew, false);
    });
});

describe('OPERATIONS: the controller enforces the gates', () => {
    function buildController(grantValid: boolean, recoveryUser: any = null) {
        const keys = {
            issueGrant: () => ({ grant: 'g', expiresAt: 'later' }),
            verifyGrant: () => grantValid,
        } as any;
        const ops = {
            verifyOperationsKey: () => true,
            trackClientEvent: async () => {},
            enrichSession: async () => {},
            trackSecurity: async () => {},
        } as any;
        const queries = {
            overview: async () => ({ ok: true }),
            timeline: async () => ({}),
            events: async () => ({ items: [], total: 0 }),
            sessions: async () => ({ items: [], total: 0 }),
            sessionDetail: async () => null,
            filterOptions: async () => ({}),
        } as any;
        // The settings service is stubbed rather than the real one so the gate
        // tests stay about the gate. The settings service's own allowlist rules
        // are asserted separately, against real in-memory state.
        const settings = {
            verifyKey: async () => true,
            isAllowed: async () => true,
            assertAllowed: async () => {},
            currentKeyVersion: async () => 1,
            setKey: async () => 2,
        } as any;
        const prisma = { user: { findUnique: async () => recoveryUser } } as any;
        const encryption = { decrypt: (value: string) => value } as any;
        return new AdminOperationsController(ops, queries, keys, settings, prisma, encryption);
    }

    // The public tracking endpoint stayed behind on `OperationsController`,
    // whose constructor now takes only the operations service.
    function buildTracker() {
        const ops = {
            trackClientEvent: async () => {},
            enrichSession: async () => {},
            trackSecurity: async () => {},
        } as any;
        return new OperationsController(ops);
    }

    test('a locked page rejects every read endpoint', async () => {
        const controller = buildController(false);
        const r = req();
        r.user = { userId: 'admin-1' };
        // `overview` throws synchronously while the others reject, so both shapes
        // are wrapped: the assertion is that the gate fires, not how it surfaces.
        await assert.rejects(async () => controller.overview(r, undefined, {}), UnauthorizedException);
        await assert.rejects(() => controller.timeline(r, undefined, {}), UnauthorizedException);
        await assert.rejects(() => controller.events(r, 'bad-grant', {}), UnauthorizedException);
        await assert.rejects(() => controller.sessions(r, undefined, {}), UnauthorizedException);
        await assert.rejects(() => controller.sessionDetail(r, undefined, 'x'), UnauthorizedException);
        await assert.rejects(() => controller.filterOptions(r, undefined), UnauthorizedException);
    });

    test('a locked page rejects every settings endpoint', async () => {
        const controller = buildController(false);
        const r = req();
        r.user = { userId: 'admin-1' };
        // Settings must be behind exactly the same gate as the reads. A settings
        // endpoint reachable without a grant would let anyone with an admin token
        // rewrite the operations password.
        await assert.rejects(() => controller.settingsState(r, undefined), UnauthorizedException);
        await assert.rejects(
            () => controller.setPassword(r, undefined, { currentPassword: 'a', newPassword: 'a-long-enough-one', confirmPassword: 'a-long-enough-one' }),
            UnauthorizedException,
        );
        await assert.rejects(() => controller.addToAllowlist(r, undefined, { userId: 'admin-2' }), UnauthorizedException);
        await assert.rejects(() => controller.removeFromAllowlist(r, undefined, 'admin-2'), UnauthorizedException);
    });

    test('an admin dropped from the allowlist is refused even with a valid grant', async () => {
        // The stubbed grant still verifies; the account is no longer allowed.
        // This is the revocation path: revoking access must take effect at once,
        // not when the current hour-long grant happens to expire.
        const { controller } = (() => {
            const keys = { verifyGrant: () => true } as any;
            const ops = { trackSecurity: async () => {} } as any;
            const queries = { overview: async () => ({ leaked: true }) } as any;
            const settings = {
                verifyKey: async () => true,
                assertAllowed: async () => { throw new ForbiddenException('not allowed'); },
                currentKeyVersion: async () => 1,
            } as any;
            return {
                controller: new AdminOperationsController(
                    ops, queries, keys, settings,
                    { user: { findUnique: async () => null } } as any,
                    { decrypt: (value: string) => value } as any,
                ),
            };
        })();
        const r = req();
        r.user = { userId: 'admin-1' };
        await assert.rejects(() => controller.overview(r, 'grant', {}), ForbiddenException);
    });

    test('an unlocked page reads', async () => {
        const controller = buildController(true);
        const r = req();
        r.user = { userId: 'admin-1' };
        assert.deepEqual(await controller.overview(r, 'grant', {}), { ok: true });
    });

    test('password recovery verifies the admin account and returns a fresh grant', async () => {
        const passwordHash = await bcrypt.hash('admin-account-password', 4);
        const controller = buildController(true, {
            passwordHash,
            twoFactorEnabled: false,
            twoFactorSecret: null,
        });
        const r = req();
        r.user = { userId: 'admin-1' };

        assert.deepEqual(
            await controller.recoverPassword(r, {
                accountPassword: 'admin-account-password',
                newPassword: 'a-new-operations-password',
                confirmPassword: 'a-new-operations-password',
            } as any),
            { grant: 'g', expiresAt: 'later', keyVersion: 2 },
        );
    });

    test('password recovery rejects an incorrect account password', async () => {
        const passwordHash = await bcrypt.hash('admin-account-password', 4);
        const controller = buildController(true, {
            passwordHash,
            twoFactorEnabled: false,
            twoFactorSecret: null,
        });
        const r = req();
        r.user = { userId: 'admin-1' };

        await assert.rejects(
            () => controller.recoverPassword(r, {
                accountPassword: 'incorrect',
                newPassword: 'a-new-operations-password',
                confirmPassword: 'a-new-operations-password',
            } as any),
            UnauthorizedException,
        );
    });

    test('password recovery requires the second factor when it is enabled', async () => {
        const passwordHash = await bcrypt.hash('admin-account-password', 4);
        const controller = buildController(true, {
            passwordHash,
            twoFactorEnabled: true,
            twoFactorSecret: 'test-secret',
        });
        const r = req();
        r.user = { userId: 'admin-1' };

        await assert.rejects(
            () => controller.recoverPassword(r, {
                accountPassword: 'admin-account-password',
                newPassword: 'a-new-operations-password',
                confirmPassword: 'a-new-operations-password',
            } as any),
            UnauthorizedException,
        );
    });

    test('password recovery accepts the current second-factor code', async () => {
        const passwordHash = await bcrypt.hash('admin-account-password', 4);
        const secret = generateSecret();
        const controller = buildController(true, {
            passwordHash,
            twoFactorEnabled: true,
            twoFactorSecret: secret,
        });
        const r = req();
        r.user = { userId: 'admin-1' };

        assert.deepEqual(
            await controller.recoverPassword(r, {
                accountPassword: 'admin-account-password',
                twoFactorCode: generateSync({ secret }),
                newPassword: 'a-new-operations-password',
                confirmPassword: 'a-new-operations-password',
            } as any),
            { grant: 'g', expiresAt: 'later', keyVersion: 2 },
        );
    });

    test('a browser cannot forge a server-authored event type', async () => {
        const controller = buildTracker();
        const r = req();
        r.opsSessionId = 'sess-1';
        // `api_call` and `security` are written by the server from the real
        // request. Accepting them from a client would let anyone fabricate
        // history against any device.
        await assert.rejects(
            () => controller.track(r, { type: 'api_call' } as any),
            ForbiddenException,
        );
        await assert.rejects(
            () => controller.track(r, { type: 'security' } as any),
            ForbiddenException,
        );
    });

    test('a browser may record a page view or a named action', async () => {
        const controller = buildTracker();
        const r = req();
        r.opsSessionId = 'sess-1';
        assert.deepEqual(await controller.track(r, { type: 'page_view', path: '/courses' }), { ok: true });
        assert.deepEqual(await controller.track(r, { type: 'action', label: 'enroll.click' }), { ok: true });
    });

    test('tracking without a session is a silent skip, not an error', async () => {
        const controller = buildTracker();
        const r = req();
        r.opsSessionId = null;
        assert.deepEqual(await controller.track(r, { type: 'page_view' }), { ok: true, skipped: true });
    });

    test('a missing session row is a 404', async () => {
        const controller = buildController(true);
        const r = req();
        r.user = { userId: 'admin-1' };
        await assert.rejects(() => controller.sessionDetail(r, 'grant', 'missing'), NotFoundException);
    });
});

describe('OPERATIONS: cookie reading', () => {
    test('finds a named cookie among others', () => {
        const request = req({ cookie: 'a=1; laxalab_vid=abc-123; b=2' });
        assert.equal(readCookie(request, 'laxalab_vid'), 'abc-123');
    });

    test('handles missing, empty and percent-encoded values', () => {
        assert.equal(readCookie(req(), 'laxalab_vid'), null);
        assert.equal(readCookie(req({ cookie: 'other=1' }), 'laxalab_vid'), null);
        assert.equal(readCookie(req({ cookie: 'laxalab_vid=' }), 'laxalab_vid'), '');
        assert.equal(readCookie(req({ cookie: 'laxalab_vid=a%20b' }), 'laxalab_vid'), 'a b');
    });

    test('does not match a cookie whose name is a suffix of another', () => {
        assert.equal(readCookie(req({ cookie: 'evil_laxalab_vid=x' }), 'laxalab_vid'), null);
    });
});

describe('OPERATIONS: query-string booleans are not coerced the wrong way', () => {
    /**
     * The naive transformation reads the string "false" as a truthy value and
     * answers "show me signed-in devices" to a request asking for the opposite,
     * silently.
     */
    function parse<T extends object>(cls: new () => T, query: Record<string, unknown>): T {
        return plainToInstance(cls, query) as T;
    }

    test('"false" stays false rather than flipping to true', () => {
        assert.equal(parse(SessionsQueryDto, { authenticatedOnly: 'false' }).authenticatedOnly, false);
        assert.equal(parse(SessionsQueryDto, { botsOnly: 'false' }).botsOnly, false);
    });

    test('"true" is still true, and 1/0 are understood', () => {
        assert.equal(parse(SessionsQueryDto, { authenticatedOnly: 'true' }).authenticatedOnly, true);
        assert.equal(parse(SessionsQueryDto, { authenticatedOnly: '1' }).authenticatedOnly, true);
        assert.equal(parse(SessionsQueryDto, { botsOnly: '0' }).botsOnly, false);
    });

    test('an absent or empty value stays undefined so no filter is applied', () => {
        assert.equal(parse(SessionsQueryDto, {}).authenticatedOnly, undefined);
        assert.equal(parse(SessionsQueryDto, { authenticatedOnly: '' }).authenticatedOnly, undefined);
        assert.equal(parse(EventsQueryDto, { authenticatedOnly: 'false' }).authenticatedOnly, false);
    });
});

describe('PLATFORM: CORS permits the headers the frontend actually sends', () => {
    /**
     * A custom header forces a preflight, and the browser rejects the request
     * outright when the header is missing from `Access-Control-Allow-Headers` --
     * with no error the API can see or report. `X-Ops-Grant` carries the
     * operations grant, so leaving it out locked the whole page.
     *
     * This reads the real `main.ts` source rather than restating the list, so a
     * header added to the frontend without updating the API fails here.
     */
    function corsAllowedHeaders(): string[] {
        const source = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
        const match = source.match(/allowedHeaders:\s*'([^']+)'/);
        assert.ok(match, 'main.ts must configure enableCors with allowedHeaders');
        return match[1].split(',').map(h => h.trim());
    }

    test('the operations grant header is allowed', () => {
        const allowed = corsAllowedHeaders().map(h => h.toLowerCase());
        assert.ok(
            allowed.includes('x-ops-grant'),
            `x-ops-grant missing from allowedHeaders: ${allowed.join(', ')}`,
        );
    });

    describe('OPERATIONS: device event history', () => {
        test('returns a stable, bounded first page and counts the complete history', async () => {
            let query: any;
            const prisma: any = {
                visitSession: {
                    findUnique: async (args: any) => {
                        query = args;
                        return { id: 'session-1', events: [{ id: 'event-1', meta: { resourceId: 'course-1' } }] };
                    },
                },
                visitEvent: {
                    count: async ({ where }: any) => ({
                        action: 2,
                        api_call: 3,
                        page_view: 4,
                        security: 1,
                    }[where.type] ?? 0),
                },
            };

            const result = await new OperationsQueriesService(prisma).sessionDetail('session-1');

            assert.equal(query.include.events.take, 50);
            assert.deepEqual(query.include.events.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
            assert.deepEqual(result?.session.events, [{ id: 'event-1', meta: { resourceId: 'course-1' } }]);
            assert.deepEqual(result?.counts, { actions: 2, apiCalls: 3, pageViews: 4, security: 1, total: 10 });
        });

        test('continues the history after the last event without relying on a shifting offset', async () => {
            let query: any;
            const prisma: any = {
                visitEvent: {
                    findMany: async (args: any) => {
                        query = args;
                        return [];
                    },
                    count: async () => 101,
                },
            };

            const result = await new OperationsQueriesService(prisma).events({
                sessionId: 'session-1',
                cursor: 'event-50',
                skip: 0,
                take: 50,
            });

            assert.deepEqual(query.cursor, { id: 'event-50' });
            assert.equal(query.skip, 1);
            assert.equal(query.take, 50);
            assert.equal(result.total, 101);
        });
    });

    test('the headers every authenticated request needs are still allowed', () => {
        const allowed = corsAllowedHeaders().map(h => h.toLowerCase());
        for (const header of ['content-type', 'authorization']) {
            assert.ok(allowed.includes(header), `${header} missing from allowedHeaders`);
        }
    });
});
