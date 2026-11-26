import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { parseUserAgent, pickSafeMeta, clampText } from './operations-parser';

export const VISITOR_COOKIE = 'laxalab_vid';

/**
 * Pull one cookie out of the request's Cookie header.
 *
 * Hand-rolled on purpose: this app has no cookie-parser dependency and pinning
 * one in for a single known key is not worth the transitive surface. The header
 * is a flat `name=value; name=value` list, and the value is percent-decoded
 * because Express's writer encodes nothing we care about but a proxy might.
 */
export function readCookie(req: Request, name: string): string | null {
    const header = req.headers?.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() !== name) continue;
        const value = part.slice(eq + 1).trim();
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }
    return null;
}

/**
 * What the tracker learns about one browser, and writes down.
 *
 * The session row is the "device" the admin sees. `visitorId` comes from a
 * first-party cookie rather than the IP on purpose: a campus or a mobile
 * carrier puts hundreds of real people behind one address, and treating them as
 * one visitor would make the per-device page meaningless.
 */
export interface TrackedRequest {
    visitorId: string;
    ipAddress: string | null;
    userAgent: string | null;
    referrer: string | null;
    language: string | null;
    screen: string | null;
    timezone: string | null;
    userId: string | null;
    isBot: boolean;
    deviceType: string;
    os: string;
    browser: string;
}

/**
 * Collects "who is doing what" for the operations center.
 *
 * DESIGN NOTES THAT ARE NOT OBVIOUS
 *
 * 1. NOTHING HERE BLOCKS A RESPONSE. Every write is fire-and-forget with a
 *    catch. A tracking failure must never turn into a failed page load, so the
 *    promise is deliberately not awaited by the caller and never rejects.
 *
 * 2. Bodies are never recorded. A login body is `{email, password}`; a payment
 *    body carries card data. `pickSafeMeta` allow-lists the handful of fields
 *    that are safe, which is why `meta` cannot become a credential store.
 *
 * 3. The operations endpoints themselves are skipped. Logging the admin
 *    reading the operations center would double the write volume on every page
 *    load of that page and bury real traffic under the observer's own.
 */
/** True for Prisma's P2002, the unique-constraint error code. */
function isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

@Injectable()
export class OperationsService {
    private readonly logger = new Logger(OperationsService.name);

    /** visitorId -> session, so a request does not re-read the row every time. */
    readonly sessionCache = new Map<string, { sessionId: string; expiresAt: number; authenticated: boolean }>();
    private static readonly SESSION_CACHE_TTL_MS = 60 * 1000;

    constructor(private readonly prisma: PrismaService) {
        // Drop expired entries rather than growing the map with every visitor the
        // platform has ever seen. An interval (not a size cap) because staleness
        // is time-based: without this the map is a permanent leak keyed by traffic.
        const sweep = setInterval(() => this.pruneSessionCache(), 60 * 1000);
        // Never hold the event loop open on shutdown (tests, CLI scripts).
        sweep.unref?.();
    }

    /** Visible for tests. */
    pruneSessionCache(now: number = Date.now()): number {
        let removed = 0;
        for (const [key, value] of this.sessionCache) {
            if (value.expiresAt <= now) {
                this.sessionCache.delete(key);
                removed++;
            }
        }
        return removed;
    }

    /** Paths whose own reads would pollute the log they are displayed in. */
    private static readonly SELF_PATHS = ['/operations', '/health'];

    private isSelfPath(path: string): boolean {
        return OperationsService.SELF_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
    }

    /**
     * Record one request. Never throws and never blocks: the caller fires it
     * and moves on.
     */
    async trackRequest(
        req: Request,
        res: Response,
        startedAt: number,
        sessionId: string | null,
    ): Promise<void> {
        try {
            const path = (req.originalUrl || req.url || '/').split('?')[0];
            if (this.isSelfPath(path)) return;

            const status = res.statusCode;
            const durationMs = Date.now() - startedAt;

            // Read the resolved session from the middleware (cookie -> db). When
            // the request carried no visitor cookie at all there is nothing to
            // attach the event to, and creating a session for a bot probing
            // /health would just be noise.
            if (!sessionId) return;

            await this.prisma.visitEvent.create({
                data: {
                    sessionId,
                    type: 'api_call',
                    method: req.method,
                    path: clampText(path, 300),
                    statusCode: status,
                    durationMs,
                },
            });
        } catch (error) {
            this.logger.warn(`trackRequest failed: ${(error as Error).message}`);
        }
    }

    /**
     * Resolve (or create) the VisitSession for a request and return its id.
     *
     * Called once per request by the middleware. Attaches the session id to the
     * request so the response hook can write the matching event without a
     * second lookup.
     *
     * THE CACHE IS LOAD-BEARING
     * Without it this method performs a SELECT and an UPDATE on every single
     * request the platform serves, including the anonymous page-load majority.
     * `lastSeenAt` at one-second resolution is not worth two round trips, so the
     * cache holds the mapping for a minute and the write is skipped inside that
     * window. It is per process and unbounded in intent but not in size: entries
     * expire on read and the map is swept periodically, so a busy site holds
     * roughly (active visitors in the last minute) entries, not (all visitors
     * ever).
     *
     * A stale cache entry after a deploy is harmless -- it maps a visitor id to
     * a session id that still exists, and no session is ever deleted by this
     * code, so the mapping cannot become wrong. Only the id's own lifecycle
     * could invalidate it, and nothing does that.
     */
    async resolveSession(
        req: Request,
        opts: { userId: string | null },
    ): Promise<{ visitorId: string; sessionId: string; isNew: boolean } | null> {
        try {
            const visitorId = this.readOrIssueVisitorId(req);
            const now = Date.now();
            const cached = this.sessionCache.get(visitorId);

            if (cached && cached.expiresAt > now) {
                // Still promote an anonymous session to its user the first time
                // we see a token on it, which is when someone logs in on a page
                // they were already browsing.
                if (opts.userId && !cached.authenticated) {
                    const promoted = await this.promoteSession(cached.sessionId, opts.userId);
                    cached.authenticated = promoted;
                    cached.expiresAt = promoted ? now + OperationsService.SESSION_CACHE_TTL_MS : 0;
                }
                return { visitorId, sessionId: cached.sessionId, isNew: false };
            }

            const existing = await this.prisma.visitSession.findUnique({
                where: { visitorId },
                select: { id: true, userId: true },
            });

            if (existing) {
                const shouldPromote = !!opts.userId && !existing.userId;
                this.sessionCache.set(visitorId, {
                    sessionId: existing.id,
                    expiresAt: now + OperationsService.SESSION_CACHE_TTL_MS,
                    authenticated: !!existing.userId,
                });
                if (shouldPromote && opts.userId) {
                    const promoted = await this.promoteSession(existing.id, opts.userId);
                    const cachedSession = this.sessionCache.get(visitorId);
                    if (cachedSession) {
                        cachedSession.authenticated = promoted;
                        if (!promoted) cachedSession.expiresAt = 0;
                    }
                } else {
                    // Refresh last-seen data outside the request path.
                    void this.touchSession(existing.id, null, this.clientIp(req));
                }
                return { visitorId, sessionId: existing.id, isNew: false };
            }

            const info = parseUserAgent(req.headers['user-agent']);
            const ua = clampText(req.headers['user-agent'], 512);
            const acceptLang = clampText(req.headers['accept-language'], 32);

            let sessionId: string;
            try {
                const created = await this.prisma.visitSession.create({
                    data: {
                        visitorId,
                        userId: opts.userId,
                        isAuthenticated: !!opts.userId,
                        ipAddress: clampText(this.clientIp(req), 64),
                        userAgent: ua,
                        deviceType: info.deviceType,
                        os: info.os,
                        browser: info.browser,
                        isBot: info.isBot,
                        referrer: clampText(req.headers.referer, 500),
                        language: acceptLang,
                    },
                });
                sessionId = created.id;
            } catch (createError) {
                // `visitorId` is UNIQUE, and a browser fires several requests at
                // once on first load. Two of them both miss the SELECT above and
                // race into INSERT; the loser gets P2002. Without this branch a
                // single page load could throw and log itself as an error, so the
                // duplicate is resolved by re-reading instead.
                if (!isUniqueViolation(createError)) {
                    throw createError;
                }
                const winner = await this.prisma.visitSession.findUnique({
                    where: { visitorId },
                    select: { id: true, userId: true },
                });
                if (!winner) throw createError;
                sessionId = winner.id;
                const authenticated = winner.userId
                    ? true
                    : opts.userId
                        ? await this.promoteSession(sessionId, opts.userId)
                        : false;
                this.sessionCache.set(visitorId, {
                    sessionId,
                    expiresAt: authenticated ? now + OperationsService.SESSION_CACHE_TTL_MS : 0,
                    authenticated,
                });
                return { visitorId, sessionId, isNew: false };
            }

            this.sessionCache.set(visitorId, {
                sessionId,
                expiresAt: now + OperationsService.SESSION_CACHE_TTL_MS,
                authenticated: !!opts.userId,
            });
            return { visitorId, sessionId, isNew: true };
        } catch (error) {
            this.logger.warn(`resolveSession failed: ${(error as Error).message}`);
            return null;
        }
    }

    /** Refresh `lastSeenAt`, and attach the user when a session is promoted. */
    private async touchSession(sessionId: string, userId: string | null, ip?: string): Promise<boolean> {
        try {
            await this.prisma.visitSession.update({
                where: { id: sessionId },
                data: {
                    lastSeenAt: new Date(),
                    ...(ip ? { ipAddress: clampText(ip, 64) } : {}),
                    ...(userId ? { userId, isAuthenticated: true } : {}),
                },
            });
            return true;
        } catch (error) {
            this.logger.warn(`touchSession failed: ${(error as Error).message}`);
            return false;
        }
    }

    private async promoteSession(sessionId: string, userId: string): Promise<boolean> {
        return this.touchSession(sessionId, userId);
    }

    /**
     * A page view or a named UI action reported by the browser.
     *
     * This is the half of the picture the server cannot see: the SPA navigates
     * without a request, so opening a page or clicking "enroll" leaves no trace
     * on the API log.
     */
    async trackClientEvent(
        sessionId: string,
        input: { type: 'page_view' | 'action'; path?: string; label?: string; screen?: string; timezone?: string; meta?: unknown },
    ): Promise<void> {
        try {
            if (input.type === 'page_view') {
                await this.prisma.$transaction([
                    this.prisma.visitEvent.create({
                        data: {
                            sessionId,
                            type: 'page_view',
                            path: clampText(input.path, 300),
                            label: clampText(input.label, 200),
                        },
                    }),
                    this.prisma.visitSession.update({
                        where: { id: sessionId },
                        data: { lastSeenAt: new Date(), pageViews: { increment: 1 } },
                    }),
                ]);
                return;
            }

            await this.prisma.visitEvent.create({
                data: {
                    sessionId,
                    type: 'action',
                    label: clampText(input.label, 200),
                    path: clampText(input.path, 300),
                    meta: pickSafeMeta(input.meta) ?? undefined,
                },
            });
        } catch (error) {
            this.logger.warn(`trackClientEvent failed: ${(error as Error).message}`);
        }
    }

    /**
     * Fill in the browser-supplied fingerprint fields the HTTP request cannot
     * carry (screen size and timezone are client-only facts).
     */
    async enrichSession(sessionId: string, input: { screen?: string; timezone?: string }): Promise<void> {
        try {
            await this.prisma.visitSession.update({
                where: { id: sessionId },
                data: {
                    screen: clampText(input.screen, 40) ?? undefined,
                    timezone: clampText(input.timezone, 60) ?? undefined,
                },
            });
        } catch (error) {
            this.logger.warn(`enrichSession failed: ${(error as Error).message}`);
        }
    }

    /**
     * A security-relevant event: a rejected operations-key attempt, a denied
     * admin call. Kept as its own `security` type so the admin can filter for
     * them without scanning the whole timeline.
     */
    async trackSecurity(input: {
        sessionId: string | null;
        label: string;
        ipAddress: string | null;
        userAgent: string | null;
        meta?: unknown;
    }): Promise<void> {
        try {
            if (!input.sessionId) return;
            await this.prisma.visitEvent.create({
                data: {
                    sessionId: input.sessionId,
                    type: 'security',
                    label: clampText(input.label, 200),
                    meta: pickSafeMeta(input.meta) ?? undefined,
                },
            });
        } catch (error) {
            this.logger.warn(`trackSecurity failed: ${(error as Error).message}`);
        }
    }

    /** The client IP, honouring exactly one trusted proxy hop (see main.ts). */
    private clientIp(req: Request): string | undefined {
        const ip = req.ip || (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
        return typeof ip === 'string' ? ip : undefined;
    }

    /**
     * The visitor cookie. SameSite=Lax so it rides normal navigation but is not
     * attached to cross-site POSTs, where it would be a CSRF-adjacent identifier.
     *
     * The Cookie header is parsed by hand rather than with cookie-parser: reading
     * one known cookie does not justify a dependency, and this app deliberately
     * pins its whole transitive tree. Writing uses Express's built-in
     * `res.cookie`, which needs no parser.
     */
    private readOrIssueVisitorId(req: Request): string {
        const existing = readCookie(req, VISITOR_COOKIE);
        if (existing && /^[a-f0-9-]{36}$/.test(existing)) return existing;
        const visitorId = crypto.randomUUID();
        try {
            (req.res as Response).cookie?.(VISITOR_COOKIE, visitorId, {
                httpOnly: true,
                sameSite: 'lax',
                maxAge: 60 * 60 * 24 * 365,
                path: '/',
                secure: process.env.NODE_ENV === 'production',
            });
        } catch {
            // cookie-parser absent in some test contexts: the id still works for
            // this request, it just will not persist to the next one.
        }
        return visitorId;
    }

    // NOTE: the operations password used to be verified here, directly against
    // OPERATIONS_KEY. It now lives in OperationsSettingsService, because the
    // password is only one of the things the settings page owns and keeping a
    // second, env-only verifier here would be a way to reintroduce the "rotated
    // the password but the env var still opens the door" bug the moment a
    // caller reached for the old method. There is one verifier, and it checks
    // the database hash first.

    /** A stable, non-reversible id for an IP, for grouping without storing more. */
    hashIp(ip: string | null | undefined): string {
        if (!ip) return 'unknown';
        return createHash('sha256').update(ip).digest('hex').slice(0, 12);
    }
}
