import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read side of the operations center: the aggregates, the filters and the
 * per-device timeline.
 *
 * Everything here is ADMIN-only at the controller. The queries themselves are
 * plain Prisma reads with no tenant scoping, because a device log has no tenant
 * -- the isolation boundary for this data is the role check plus the second
 * password, both enforced before a query is ever built.
 */
@Injectable()
export class OperationsQueriesService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * The dashboard header. Counts are cheap (`count` with a where) while the
     * grouped breakdowns are `groupBy`, which Postgres answers from an index on
     * the grouped column -- so a 24h window is a handful of small queries rather
     * than a scan.
     */
    async overview(windowHours = 24) {
        const since = new Date(Date.now() - windowHours * 3600 * 1000);
        const prevSince = new Date(Date.now() - windowHours * 2 * 3600 * 1000);

        const [
            sessionsInWindow,
            sessionsPrevWindow,
            pageViewsInWindow,
            pageViewsPrevWindow,
            eventsInWindow,
            eventsPrevWindow,
            authenticatedInWindow,
            botsInWindow,
            activeNow,
            byDevice,
            byBrowser,
            byOs,
            byTopPath,
            byReferrer,
            eventTypes,
        ] = await Promise.all([
            this.prisma.visitSession.count({ where: { lastSeenAt: { gte: since } } }),
            this.prisma.visitSession.count({ where: { lastSeenAt: { gte: prevSince, lt: since } } }),
            this.prisma.visitEvent.count({ where: { type: 'page_view', createdAt: { gte: since } } }),
            this.prisma.visitEvent.count({ where: { type: 'page_view', createdAt: { gte: prevSince, lt: since } } }),
            this.prisma.visitEvent.count({ where: { createdAt: { gte: since } } }),
            this.prisma.visitEvent.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
            this.prisma.visitSession.count({ where: { lastSeenAt: { gte: since }, isAuthenticated: true } }),
            this.prisma.visitSession.count({ where: { lastSeenAt: { gte: since }, isBot: true } }),
            // "Online" here means seen in the last 5 minutes, not a socket: the
            // tracker has no heartbeat, and claiming more precision than the data
            // supports would make the number lie.
            this.prisma.visitSession.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } }),
            this.prisma.visitSession.groupBy({ by: ['deviceType'], where: { lastSeenAt: { gte: since } }, _count: { _all: true } }),
            this.prisma.visitSession.groupBy({ by: ['browser'], where: { lastSeenAt: { gte: since } }, _count: { _all: true } }),
            this.prisma.visitSession.groupBy({ by: ['os'], where: { lastSeenAt: { gte: since } }, _count: { _all: true } }),
            this.prisma.visitEvent.groupBy({ by: ['path'], where: { type: 'page_view', createdAt: { gte: since }, path: { not: null } }, _count: { _all: true }, orderBy: { _count: { path: 'desc' } }, take: 10 }),
            this.prisma.visitSession.groupBy({ by: ['referrer'], where: { lastSeenAt: { gte: since }, referrer: { not: null } }, _count: { _all: true }, orderBy: { _count: { referrer: 'desc' } }, take: 10 }),
            this.prisma.visitEvent.groupBy({ by: ['type'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        ]);

        return {
            windowHours,
            since: since.toISOString(),
            totals: {
                devices: sessionsInWindow,
                devicesPrevious: sessionsPrevWindow,
                pageViews: pageViewsInWindow,
                pageViewsPrevious: pageViewsPrevWindow,
                events: eventsInWindow,
                eventsPrevious: eventsPrevWindow,
                authenticatedDevices: authenticatedInWindow,
                anonymousDevices: sessionsInWindow - authenticatedInWindow,
                bots: botsInWindow,
                activeNow,
            },
            eventTypes: eventTypes.map((r) => ({ type: r.type, count: r._count._all })),
            devices: rank(byDevice, 'deviceType'),
            browsers: rank(byBrowser, 'browser'),
            operatingSystems: rank(byOs, 'os'),
            topPaths: byTopPath.map((r) => ({ path: r.path, count: r._count._all })),
            referrers: byReferrer.map((r) => ({ referrer: r.referrer, count: r._count._all })),
        };
    }

    /** Hour-by-hour event counts, for the activity sparkline. */
    async timeline(hours = 24) {
        const since = new Date(Date.now() - hours * 3600 * 1000);
        const rows = await this.prisma.$queryRaw<
            Array<{ bucket: Date; page_views: bigint; api_calls: bigint; actions: bigint }>
        >`
            SELECT date_trunc('hour', "createdAt") AS bucket,
                   count(*) FILTER (WHERE type = 'page_view') AS page_views,
                   count(*) FILTER (WHERE type = 'api_call')  AS api_calls,
                   count(*) FILTER (WHERE type = 'action')    AS actions
            FROM "VisitEvent"
            WHERE "createdAt" >= ${since}
            GROUP BY bucket
            ORDER BY bucket ASC
        `;
        return rows.map((r) => ({
            hour: r.bucket.toISOString(),
            pageViews: Number(r.page_views),
            apiCalls: Number(r.api_calls),
            actions: Number(r.actions),
        }));
    }

    /**
     * Filtered event feed. `search` is matched against path, label and the
     * session's IP -- the three things an admin actually types when hunting for
     * "that request from that address".
     */
    async events(filters: {
        type?: string;
        sessionId?: string;
        cursor?: string;
        search?: string;
        from?: Date;
        to?: Date;
        authenticatedOnly?: boolean;
        skip: number;
        take: number;
    }) {
        const where: Record<string, unknown> = {};

        if (filters.type) where.type = filters.type;
        if (filters.sessionId) where.sessionId = filters.sessionId;
        if (filters.from || filters.to) {
            where.createdAt = {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
            };
        }
        if (filters.search) {
            where.OR = [
                { path: { contains: filters.search, mode: 'insensitive' } },
                { label: { contains: filters.search, mode: 'insensitive' } },
                { session: { ipAddress: { contains: filters.search, mode: 'insensitive' } } },
                { session: { visitorId: { contains: filters.search, mode: 'insensitive' } } },
                { session: { user: { email: { contains: filters.search, mode: 'insensitive' } } } },
            ];
        }
        if (filters.authenticatedOnly) where.session = { isAuthenticated: true };

        const [items, total] = await Promise.all([
            this.prisma.visitEvent.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : { skip: filters.skip }),
                take: filters.take,
                include: {
                    session: {
                        select: {
                            id: true,
                            visitorId: true,
                            ipAddress: true,
                            deviceType: true,
                            os: true,
                            browser: true,
                            isBot: true,
                            isAuthenticated: true,
                            user: { select: { id: true, email: true, role: true } },
                        },
                    },
                },
            }),
            this.prisma.visitEvent.count({ where }),
        ]);

        return { items, total };
    }

    /** Paginated business activity carried out by staff accounts. */
    async adminActivity(filters: { search?: string; skip: number; take: number }) {
        const where = {
            actorRole: { in: ['ADMIN', 'FINANCE', 'COURSE_MANAGER'] },
            method: { not: null },
            ...(filters.search
                ? {
                    OR: [
                        { action: { contains: filters.search, mode: 'insensitive' as const } },
                        { actorEmail: { contains: filters.search, mode: 'insensitive' as const } },
                        { actorRole: { contains: filters.search, mode: 'insensitive' as const } },
                        { targetType: { contains: filters.search, mode: 'insensitive' as const } },
                        { targetId: { contains: filters.search, mode: 'insensitive' as const } },
                        { targetLabel: { contains: filters.search, mode: 'insensitive' as const } },
                    ],
                }
                : {}),
        };

        const [items, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: filters.skip,
                take: filters.take,
                select: {
                    id: true,
                    action: true,
                    timestamp: true,
                    actorEmail: true,
                    actorRole: true,
                    targetType: true,
                    targetId: true,
                    targetLabel: true,
                    method: true,
                    route: true,
                    details: true,
                },
            }),
            this.prisma.auditLog.count({ where }),
        ]);
        return { items, total };
    }

    /** The device list, with the event counts the admin filters on. */
    async sessions(filters: {
        search?: string;
        deviceType?: string;
        authenticatedOnly?: boolean;
        botsOnly?: boolean;
        from?: Date;
        skip: number;
        take: number;
    }) {
        const where: Record<string, unknown> = {};

        if (filters.deviceType) where.deviceType = filters.deviceType;
        if (filters.authenticatedOnly) where.isAuthenticated = true;
        if (filters.botsOnly) where.isBot = true;
        if (filters.from) where.lastSeenAt = { gte: filters.from };
        if (filters.search) {
            where.OR = [
                { ipAddress: { contains: filters.search, mode: 'insensitive' } },
                { visitorId: { contains: filters.search, mode: 'insensitive' } },
                { browser: { contains: filters.search, mode: 'insensitive' } },
                { os: { contains: filters.search, mode: 'insensitive' } },
                { user: { email: { contains: filters.search, mode: 'insensitive' } } },
            ];
        }

        const [items, total] = await Promise.all([
            this.prisma.visitSession.findMany({
                where,
                orderBy: { lastSeenAt: 'desc' },
                skip: filters.skip,
                take: filters.take,
                include: {
                    user: { select: { id: true, email: true, role: true } },
                    _count: { select: { events: true } },
                },
            }),
            this.prisma.visitSession.count({ where }),
        ]);

        return { items, total };
    }

    /**
     * One device's fingerprint, its newest events, and counts for the full
     * history. Older events are fetched from the paginated event feed.
     */
    async sessionDetail(id: string) {
        const session = await this.prisma.visitSession.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, email: true, role: true, createdAt: true } },
                events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 },
            },
        });
        if (!session) return null;

        const [actions, apiCalls, pageViews, securityEvents] = await Promise.all([
            this.prisma.visitEvent.count({ where: { sessionId: id, type: 'action' } }),
            this.prisma.visitEvent.count({ where: { sessionId: id, type: 'api_call' } }),
            this.prisma.visitEvent.count({ where: { sessionId: id, type: 'page_view' } }),
            this.prisma.visitEvent.count({ where: { sessionId: id, type: 'security' } }),
        ]);

        return {
            session,
            counts: { actions, apiCalls, pageViews, security: securityEvents, total: actions + apiCalls + pageViews + securityEvents },
        };
    }

    /** Distinct values for the filter dropdowns. */
    async filterOptions() {
        const [devices, browsers, systems] = await Promise.all([
            this.prisma.visitSession.findMany({ distinct: ['deviceType'], select: { deviceType: true }, orderBy: { deviceType: 'asc' } }),
            this.prisma.visitSession.findMany({ distinct: ['browser'], select: { browser: true }, orderBy: { browser: 'asc' } }),
            this.prisma.visitSession.findMany({ distinct: ['os'], select: { os: true }, orderBy: { os: 'asc' } }),
        ]);
        return {
            deviceTypes: devices.map((d) => d.deviceType),
            browsers: browsers.map((b) => b.browser).filter(Boolean),
            operatingSystems: systems.map((s) => s.os).filter(Boolean),
        };
    }
}

/**
 * Flattens a Prisma `groupBy` result into `{name, count}` pairs sorted
 * descending. The `_count` generic comes back as `unknown` on a grouped row, so
 * it is narrowed here rather than cast at seven call sites.
 */
function rank<T extends Record<string, unknown>>(rows: T[], key: string) {
    return rows
        .map((r) => ({
            name: (r[key] as string | null) ?? 'unknown',
            count: (r._count as { _all: number })._all,
        }))
        .sort((a, b) => b.count - a.count);
}
