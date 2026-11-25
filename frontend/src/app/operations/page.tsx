"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n-context';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api, getErrorMessage, isUnauthorized } from '@/lib/api';
import {
    Activity, AlertTriangle, ArrowRight, Bot, ClipboardList, Cpu, Eye, Globe, KeyRound, LayoutGrid,
    Loader2, Lock, Monitor, MousePointerClick, RefreshCw, Search, Settings, ShieldCheck, Smartphone, Clock, Route,
    Tablet, Tv, User, UserX, X, type LucideIcon,
} from 'lucide-react';
import OperationsSettingsPanel from '@/components/OperationsSettingsPanel';

/* ------------------------------------------------------------------ types */

interface Overview {
    windowHours: number;
    since: string;
    totals: {
        devices: number;
        devicesPrevious: number;
        pageViews: number;
        pageViewsPrevious: number;
        events: number;
        eventsPrevious: number;
        authenticatedDevices: number;
        anonymousDevices: number;
        bots: number;
        activeNow: number;
    };
    eventTypes: Array<{ type: string; count: number }>;
    devices: Array<{ name: string; count: number }>;
    browsers: Array<{ name: string; count: number }>;
    operatingSystems: Array<{ name: string; count: number }>;
    topPaths: Array<{ path: string | null; count: number }>;
    referrers: Array<{ referrer: string | null; count: number }>;
}

interface TrackedSession {
    id: string;
    visitorId: string;
    ipAddress: string | null;
    deviceType: string;
    os: string | null;
    browser: string | null;
    userAgent: string | null;
    referrer: string | null;
    language: string | null;
    screen: string | null;
    timezone: string | null;
    isBot: boolean;
    isAuthenticated: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
    pageViews: number;
    user?: { id: string; email: string; role: string } | null;
}

interface TrackedEvent {
    id: string;
    type: string;
    method: string | null;
    path: string | null;
    statusCode: number | null;
    durationMs: number | null;
    label: string | null;
    meta?: Record<string, string | number> | null;
    createdAt: string;
    session: TrackedSession;
}

type SessionTimelineEvent = Omit<TrackedEvent, 'session'>;

interface AdminActivity {
    id: string;
    action: string;
    timestamp: string;
    actorEmail: string | null;
    actorRole: string | null;
    targetType: string | null;
    targetId: string | null;
    targetLabel: string | null;
    method: string | null;
    route: string | null;
    details: {
        summary?: string;
        outcome?: string;
        operation?: string;
        target?: string;
        changes?: Array<{
            field: string;
            label: string;
            value?: string | number | boolean;
            previousValue?: string | number | boolean;
            newValue?: string | number | boolean;
        }>;
    } | null;
}

interface TimelinePoint {
    hour: string;
    pageViews: number;
    apiCalls: number;
    actions: number;
}

/**
 * `GET /api/admin/operations/sessions/:id` nests the event list inside `session`, so the
 * drawer reads it from there rather than from a top-level `events` key that the
 * endpoint never returns.
 */
interface SessionDetail {
    session: TrackedSession & {
        user?: { id: string; email: string; role: string; createdAt: string } | null;
        events?: SessionTimelineEvent[];
    };
    counts: { actions: number; apiCalls: number; pageViews: number; security: number; total: number };
    summary: {
        durationMs: number;
        durationMinutes: number;
        topPages: Array<{ name: string; count: number }>;
        uniquePages: number;
        topActions: Array<{ name: string; count: number }>;
        hourlyActivity: Array<{ hour: string; count: number }>;
        routeSequence: string[];
        summarizedEvents: number;
        truncated: boolean;
    };
}

/* ------------------------------------------------------------------ helpers */

const GRANT_KEY = 'laxalab_ops_grant';
const GRANT_USER_KEY = 'laxalab_ops_grant_user';

const RANGE_OPTIONS = [
    { hours: 1, labelKey: 'ops.range_1h' },
    { hours: 24, labelKey: 'ops.range_24h' },
    { hours: 168, labelKey: 'ops.range_7d' },
    { hours: 720, labelKey: 'ops.range_30d' },
] as const;

const DEVICE_ICONS: Record<string, LucideIcon> = {
    desktop: Monitor,
    mobile: Smartphone,
    tablet: Tablet,
    tv: Tv,
    bot: Bot,
    unknown: Cpu,
};

const EVENT_ICONS: Record<string, LucideIcon> = {
    page_view: Eye,
    api_call: Activity,
    action: MousePointerClick,
    security: ShieldCheck,
};

function statusTone(code: number | null): 'green' | 'amber' | 'red' | 'gray' {
    if (code === null) return 'gray';
    if (code >= 500) return 'red';
    if (code >= 400) return 'amber';
    if (code >= 200 && code < 300) return 'green';
    return 'gray';
}

/** Percent change, or null when there is no meaningful baseline. */
function delta(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null;
    return Math.round(((current - previous) / previous) * 100);
}

function shortPath(path: string): string {
    return path.length > 60 ? `…${path.slice(-58)}` : path;
}

/* ---------------------------------------------------------------- the page */

function OperationsCenterPage() {
    const { t } = useI18n();

    // The gate has three states: unknown (checking storage), locked (needs the
    // second password) and unlocked (has a live grant). Rendering the dashboard
    // before the grant is confirmed would briefly show an empty shell that then
    // 401s, so the locked screen owns the whole view until it passes.
    const [grant, setGrant] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [key, setKey] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const [unlockError, setUnlockError] = useState<string | null>(null);

    const [tab, setTab] = useState<'overview' | 'live' | 'activity' | 'devices' | 'settings'>('overview');
    const [hours, setHours] = useState(24);
    const [overview, setOverview] = useState<Overview | null>(null);
    const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
    const [events, setEvents] = useState<TrackedEvent[]>([]);
    const [eventTotal, setEventTotal] = useState(0);
    const [eventPage, setEventPage] = useState(0);
    const [adminActivity, setAdminActivity] = useState<AdminActivity[]>([]);
    const [adminActivityTotal, setAdminActivityTotal] = useState(0);
    const [adminActivityPage, setAdminActivityPage] = useState(0);
    const [adminActivitySearch, setAdminActivitySearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [search, setSearch] = useState('');
    const [devices, setDevices] = useState<TrackedSession[]>([]);
    const [deviceTotal, setDeviceTotal] = useState(0);
    const [devicePage, setDevicePage] = useState(0);
    const [deviceTypeFilter, setDeviceTypeFilter] = useState('');
    const [selected, setSelected] = useState<SessionDetail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [loadingMoreEvents, setLoadingMoreEvents] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const PAGE_SIZE = 25;

    /*
     * `sessionStorage` does not exist during SSR, so the grant cannot be read
     * during render without breaking hydration -- it has to be picked up after
     * mount. That is exactly the "sync with an external system" case effects
     * exist for, so the rule is silenced here rather than worked around.
     */
    useEffect(() => {
        // A grant is bound to the account that minted it, so a different admin
        // on the same browser must not inherit an unlocked page.
        const storedUser = typeof window !== 'undefined' ? localStorage.getItem(GRANT_USER_KEY) : null;
        const stored = typeof window !== 'undefined' ? sessionStorage.getItem(GRANT_KEY) : null;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setGrant(storedUser === 'me' && stored ? stored : null);
        setReady(true);
    }, []);

    const headers = useMemo(() => (grant ? { 'x-ops-grant': grant } : undefined), [grant]);

    const unlock = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!key) return;
        setUnlocking(true);
        setUnlockError(null);
        try {
            const res = await api.post('/api/admin/operations/unlock', { key });
            sessionStorage.setItem(GRANT_KEY, res.data.grant);
            localStorage.setItem(GRANT_USER_KEY, 'me');
            setGrant(res.data.grant);
            setKey('');
        } catch (err) {
            setUnlockError(
                isUnauthorized(err) ? t('ops.unlock_wrong') : (getErrorMessage(err) || t('ops.unlock_failed')),
            );
        } finally {
            setUnlocking(false);
        }
    };

    const recoverPassword = async (values: {
        accountPassword: string;
        twoFactorCode: string;
        newPassword: string;
        confirmPassword: string;
    }) => {
        setUnlocking(true);
        setUnlockError(null);
        try {
            const res = await api.post('/api/admin/operations/recover-password', {
                ...values,
                twoFactorCode: values.twoFactorCode || undefined,
            });
            sessionStorage.setItem(GRANT_KEY, res.data.grant);
            localStorage.setItem(GRANT_USER_KEY, 'me');
            setGrant(res.data.grant);
        } catch (err) {
            setUnlockError(
                isUnauthorized(err) ? t('ops.recovery_failed') : (getErrorMessage(err) || t('ops.unlock_failed')),
            );
        } finally {
            setUnlocking(false);
        }
    };

    const lock = useCallback(() => {
        sessionStorage.removeItem(GRANT_KEY);
        localStorage.removeItem(GRANT_USER_KEY);
        setGrant(null);
        setOverview(null);
        setTimeline([]);
        setEvents([]);
        setDevices([]);
        setSelected(null);
    }, []);

    /** 401 on any operations call means the grant died; drop back to the gate. */
    const handleApiError = useCallback((err: unknown) => {
        if (isUnauthorized(err)) {
            lock();
            return true;
        }
        setError(getErrorMessage(err) || t('common.error'));
        return false;
    }, [lock, t]);

    const loadOverview = useCallback(async () => {
        try {
            const [o, tl] = await Promise.all([
                api.get(`/api/admin/operations/overview?hours=${hours}`, { headers }),
                api.get(`/api/admin/operations/timeline?hours=${hours}`, { headers }),
            ]);
            setOverview(o.data);
            setTimeline(tl.data);
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            handleApiError(err);
        }
    }, [hours, headers, handleApiError]);

    const loadEvents = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                skip: String(eventPage * PAGE_SIZE),
                take: String(PAGE_SIZE),
            });
            if (typeFilter) params.set('type', typeFilter);
            if (search.trim()) params.set('search', search.trim());
            const res = await api.get(`/api/admin/operations/events?${params}`, { headers });
            setEvents(res.data.items);
            setEventTotal(res.data.total);
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            handleApiError(err);
        }
    }, [eventPage, typeFilter, search, headers, handleApiError]);

    const loadAdminActivity = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                skip: String(adminActivityPage * PAGE_SIZE),
                take: String(PAGE_SIZE),
            });
            if (adminActivitySearch.trim()) params.set('search', adminActivitySearch.trim());
            const res = await api.get(`/api/admin/operations/admin-activity?${params}`, { headers });
            setAdminActivity(res.data.items);
            setAdminActivityTotal(res.data.total);
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            handleApiError(err);
        }
    }, [adminActivityPage, adminActivitySearch, headers, handleApiError]);

    const loadDevices = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                skip: String(devicePage * PAGE_SIZE),
                take: String(PAGE_SIZE),
            });
            if (deviceTypeFilter) params.set('deviceType', deviceTypeFilter);
            if (search.trim()) params.set('search', search.trim());
            const res = await api.get(`/api/admin/operations/sessions?${params}`, { headers });
            setDevices(res.data.items);
            setDeviceTotal(res.data.total);
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            handleApiError(err);
        }
    }, [devicePage, deviceTypeFilter, search, headers, handleApiError]);

    const openDevice = useCallback(async (id: string) => {
        setLoadingDetail(true);
        setSelected(null);
        try {
            const res = await api.get(`/api/admin/operations/sessions/${id}`, { headers });
            setSelected(res.data);
        } catch (err) {
            handleApiError(err);
        } finally {
            setLoadingDetail(false);
        }
    }, [headers, handleApiError]);

    const loadMoreDeviceEvents = useCallback(async () => {
        if (!selected || loadingMoreEvents) return;
        const sessionId = selected.session.id;
        const currentEvents = selected.session.events ?? [];
        setLoadingMoreEvents(true);
        try {
            const params = new URLSearchParams({
                sessionId,
                take: '50',
            });
            if (currentEvents.length > 0) {
                params.set('cursor', currentEvents[currentEvents.length - 1].id);
            }
            const res = await api.get(`/api/admin/operations/events?${params}`, { headers });
            setSelected(current => {
                if (!current || current.session.id !== sessionId) return current;
                const existing = new Set((current.session.events ?? []).map(event => event.id));
                const olderEvents = res.data.items.filter((event: TrackedEvent) => !existing.has(event.id));
                return {
                    ...current,
                    session: {
                        ...current.session,
                        events: [...(current.session.events ?? []), ...olderEvents],
                    },
                };
            });
            setError(null);
        } catch (err) {
            handleApiError(err);
        } finally {
            setLoadingMoreEvents(false);
        }
    }, [selected, loadingMoreEvents, headers, handleApiError]);

    // Pull only what the visible tab needs. Polling every tab at once would
    // triple the write-free read load for data nobody is looking at.
    // Fetching from the API is the external-system case effects are for; the
    // state is only written after the response resolves, never during render.
    useEffect(() => {
        if (!grant) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (tab === 'overview') void loadOverview();
        if (tab === 'live') void loadEvents();
        if (tab === 'activity') void loadAdminActivity();
        if (tab === 'devices') void loadDevices();
    }, [grant, tab, loadOverview, loadEvents, loadAdminActivity, loadDevices]);

    useEffect(() => {
        if (!grant || !autoRefresh) return;
        const timer = setInterval(() => {
            if (tab === 'overview') void loadOverview();
            if (tab === 'live' && eventPage === 0) void loadEvents();
            if (tab === 'activity' && adminActivityPage === 0) void loadAdminActivity();
            if (tab === 'devices') void loadDevices();
        }, 30_000);
        return () => clearInterval(timer);
    }, [grant, autoRefresh, tab, eventPage, adminActivityPage, loadOverview, loadEvents, loadAdminActivity, loadDevices]);

    const maxTimeline = Math.max(1, ...timeline.map((p) => p.pageViews + p.apiCalls + p.actions));

    if (!ready) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-brand-navy-dark">
                <Loader2 size={40} className="animate-spin text-brand-gold" />
            </div>
        );
    }

    if (!grant) {
        return (
            <Gate
                keyValue={key}
                setKeyValue={setKey}
                error={unlockError}
                busy={unlocking}
                onSubmit={unlock}
                onRecover={recoverPassword}
                clearError={() => setUnlockError(null)}
                t={t}
            />
        );
    }

    const totals = overview?.totals;
    const devicesDelta = totals ? delta(totals.devices, totals.devicesPrevious) : null;
    const viewsDelta = totals ? delta(totals.pageViews, totals.pageViewsPrevious) : null;

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100/80 via-brand-white to-brand-white dark:from-[#071629] dark:via-brand-navy-dark dark:to-[#071629] text-brand-charcoal dark:text-white">
            {/* Masthead. Deliberately not the admin shell: the page must not be
                reachable from any navigation, so it carries no links out. */}
            <header className="bg-gradient-to-br from-brand-navy-dark via-brand-navy to-[#173c6d] border-b border-white/10 shadow-xl shadow-brand-navy-dark/15">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7 flex flex-wrap items-center justify-between gap-5">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-gold/25 to-white/5 ring-1 ring-white/15 shadow-inner flex items-center justify-center shrink-0">
                            <ShieldCheck size={24} className="text-brand-gold-light" />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl font-black text-ink-on-navy tracking-tight">{t('ops.title')}</h1>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                <p className="text-xs text-ink-on-navy-subtle">{t('ops.subtitle')}</p>
                                {totals && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        {totals.activeNow} {t('ops.status_online')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex w-full sm:w-auto flex-wrap items-center gap-2.5">
                        {/* Drives the same `hours` window the stats, chart and
                            breakdowns use, so one control re-scopes the page. */}
                        <div className="flex items-center rounded-xl border border-white/15 bg-black/10 p-1 shadow-inner">
                            {RANGE_OPTIONS.map(opt => (
                                <button
                                    key={opt.hours}
                                    onClick={() => setHours(opt.hours)}
                                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                        hours === opt.hours ? 'bg-brand-gold text-brand-navy-dark shadow-sm' : 'text-ink-on-navy-muted hover:text-ink-on-navy'
                                    }`}
                                >
                                    {t(opt.labelKey)}
                                </button>
                            ))}
                        </div>
                        <label className="flex items-center gap-2 text-xs font-bold text-ink-on-navy-muted cursor-pointer select-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10 transition">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={e => setAutoRefresh(e.target.checked)}
                                className="w-4 h-4 accent-brand-gold cursor-pointer"
                            />
                            {t('ops.auto_refresh')}
                        </label>
                        <button
                            onClick={lock}
                            data-ops-action="operations.lock"
                            className="inline-flex items-center gap-2 bg-white/5 hover:bg-red-400/10 border border-white/15 hover:border-red-200/20 text-ink-on-navy px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                            <Lock size={15} />
                            {t('ops.lock')}
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 flex gap-2 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {([
                        ['overview', LayoutGrid, 'ops.tab_overview'],
                        ['live', Activity, 'ops.tab_live'],
                        ['activity', ClipboardList, 'ops.tab_admin_activity'],
                        ['devices', Monitor, 'ops.tab_devices'],
                        ['settings', Settings, 'ops.tab_settings'],
                    ] as const).map(([id, Icon, label]) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            data-ops-action={`operations.tab.${id}`}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition cursor-pointer rounded-xl whitespace-nowrap ${
                                tab === id
                                    ? 'bg-white/12 text-white shadow-sm ring-1 ring-white/10'
                                    : 'text-ink-on-navy-muted hover:text-ink-on-navy hover:bg-white/5'
                            }`}
                        >
                            <Icon size={17} />
                            {t(label)}
                        </button>
                    ))}
                </div>
            </header>

            <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-gray-200/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-brand-navy-dark/80">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50"></span>
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                        </span>
                        <span className="text-xs font-black text-brand-navy dark:text-white">{t('ops.professional_view')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                        <RefreshCw size={12} className={autoRefresh ? 'text-emerald-500' : ''} />
                        <span>{t('ops.last_updated')}:</span>
                        <span className="font-mono text-brand-navy dark:text-gray-200" dir="ltr">
                            {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
                        </span>
                    </div>
                </div>

                {error && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-xl">
                        <AlertTriangle size={18} className="shrink-0" />
                        <span className="text-sm font-bold">{error}</span>
                    </div>
                )}

                {tab === 'overview' && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
                            <Stat
                                icon={Monitor}
                                label={t('ops.stat_devices')}
                                value={totals?.devices}
                                change={devicesDelta}
                                tone="blue"
                            />
                            <Stat
                                icon={Eye}
                                label={t('ops.stat_page_views')}
                                value={totals?.pageViews}
                                change={viewsDelta}
                                tone="gold"
                            />
                            <Stat icon={Activity} label={t('ops.stat_events')} value={totals?.events} tone="purple" />
                            <Stat icon={User} label={t('ops.stat_signed_in')} value={totals?.authenticatedDevices} tone="green" />
                            <Stat icon={UserX} label={t('ops.stat_guests')} value={totals?.anonymousDevices} tone="gray" />
                            <Stat icon={Bot} label={t('ops.stat_bots')} value={totals?.bots} tone="amber" />
                        </div>

                        {/* Activity sparkline. Pure CSS bars: a charting library
                            for one row of hourly counts would be the heaviest
                            dependency on this page. */}
                        <Panel icon={Activity} title={t('ops.activity_title')} subtitle={t('ops.activity_subtitle')}>
                            <div className="flex items-end gap-1 h-44 rounded-xl border border-gray-100 bg-[linear-gradient(to_bottom,rgba(148,163,184,.12)_1px,transparent_1px)] bg-[size:100%_25%] px-2 pt-3 dark:border-white/5" dir="ltr">
                                {timeline.length === 0 && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400 py-8">{t('ops.no_activity')}</p>
                                )}
                                {timeline.map((point) => {
                                    const total = point.pageViews + point.apiCalls + point.actions;
                                    return (
                                        <div key={point.hour} className="flex-1 min-w-[6px] h-full flex items-end group relative">
                                            <div
                                                className="w-full max-w-5 mx-auto flex flex-col-reverse overflow-hidden rounded-t-md hover:brightness-110 transition"
                                                style={{ height: `${Math.max(total > 0 ? 5 : 0, (total / maxTimeline) * 100)}%` }}
                                                title={`${new Date(point.hour).toLocaleString()} · ${total}`}
                                            >
                                                {total > 0 && (
                                                    <>
                                                        <span className="bg-brand-navy-light" style={{ height: `${(point.pageViews / total) * 100}%` }} />
                                                        <span className="bg-sky-400" style={{ height: `${(point.apiCalls / total) * 100}%` }} />
                                                        <span className="bg-brand-gold" style={{ height: `${(point.actions / total) * 100}%` }} />
                                                    </>
                                                )}
                                            </div>
                                            {total > 0 && (
                                                <span className="absolute -top-8 start-1/2 -translate-x-1/2 hidden group-hover:block text-[10px] font-bold bg-brand-navy-dark text-white px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                                                    {total}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex gap-4 mt-4 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                                <Legend color="bg-brand-navy-light" label={t('ops.legend_pages')} />
                                <Legend color="bg-sky-400" label={t('ops.legend_calls')} />
                                <Legend color="bg-brand-gold" label={t('ops.legend_actions')} />
                            </div>
                        </Panel>

                        <div className="grid lg:grid-cols-2 gap-6">
                            <Breakdown title={t('ops.breakdown_devices')} rows={overview?.devices ?? []} />
                            <Breakdown title={t('ops.breakdown_browsers')} rows={overview?.browsers ?? []} />
                            <Breakdown title={t('ops.breakdown_os')} rows={overview?.operatingSystems ?? []} />
                            <Panel icon={Globe} title={t('ops.top_paths')} subtitle={t('ops.top_paths_sub')}>
                                {(overview?.topPaths ?? []).length === 0 ? (
                                    <EmptyPanel text={t('ops.no_data')} />
                                ) : (
                                    <ul className="space-y-2.5">
                                        {overview!.topPaths.map((row) => {
                                            const max = Math.max(...overview!.topPaths.map((p) => p.count), 1);
                                            return (
                                                <li key={row.path ?? 'x'}>
                                                    <div className="flex items-center justify-between gap-3 text-xs font-bold mb-1">
                                                        <span className="font-mono text-brand-navy dark:text-white truncate" dir="ltr">
                                                            {shortPath(row.path ?? t('ops.unknown_path'))}
                                                        </span>
                                                        <span className="text-gray-500 dark:text-gray-400 shrink-0">{row.count}</span>
                                                    </div>
                                                    <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                                                        <div className="h-full bg-brand-gold rounded-full" style={{ width: `${(row.count / max) * 100}%` }} />
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </Panel>
                        </div>

                        <Panel icon={Globe} title={t('ops.referrers')} subtitle={t('ops.referrers_sub')}>
                            {(overview?.referrers ?? []).length === 0 ? (
                                <EmptyPanel text={t('ops.no_data')} />
                            ) : (
                                <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {overview!.referrers.map((row) => (
                                        <li key={row.referrer ?? 'x'} className="flex items-center gap-3 bg-gray-50 dark:bg-white/5 rounded-xl px-3.5 py-3">
                                            <Globe size={15} className="text-gray-400 shrink-0" />
                                            <span className="text-xs font-bold text-brand-navy dark:text-white truncate flex-1" dir="ltr">
                                                {row.referrer}
                                            </span>
                                            <span className="text-xs font-black text-brand-gold-dark dark:text-brand-gold shrink-0">{row.count}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Panel>
                    </>
                )}

                {tab === 'live' && (
                    <Panel
                        icon={Activity}
                        title={t('ops.live_title')}
                        subtitle={`${t('ops.live_subtitle')}: ${eventTotal}`}
                        actions={
                            <>
                                <div className="relative">
                                    <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                                    <input
                                        value={search}
                                        onChange={e => { setSearch(e.target.value); setEventPage(0); }}
                                        placeholder={t('ops.search_placeholder')}
                                        className="ps-9 pe-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm w-56 bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-brand-gold outline-none transition"
                                    />
                                </div>
                                <select
                                    value={typeFilter}
                                    onChange={e => { setTypeFilter(e.target.value); setEventPage(0); }}
                                    className="px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-gold font-bold"
                                >
                                    <option value="">{t('ops.filter_all_types')}</option>
                                    <option value="page_view">{t('ops.type_page_view')}</option>
                                    <option value="api_call">{t('ops.type_api_call')}</option>
                                    <option value="action">{t('ops.type_action')}</option>
                                    <option value="security">{t('ops.type_security')}</option>
                                </select>
                                <button
                                    onClick={() => void loadEvents()}
                                    className="inline-flex items-center gap-2 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-white/10 px-3.5 py-2 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition cursor-pointer"
                                >
                                    <RefreshCw size={15} />
                                </button>
                            </>
                        }
                    >
                        <EventTable
                            events={events}
                            onOpenDevice={openDevice}
                            loadingDetail={loadingDetail}
                            t={t}
                        />
                        <Pager
                            page={eventPage}
                            total={eventTotal}
                            pageSize={PAGE_SIZE}
                            onChange={setEventPage}
                            t={t}
                        />
                    </Panel>
                )}

                {tab === 'activity' && (
                    <Panel
                        icon={ClipboardList}
                        title={t('ops.admin_activity_title')}
                        subtitle={`${t('ops.admin_activity_subtitle')}: ${adminActivityTotal}`}
                        actions={
                            <>
                                <div className="relative">
                                    <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                                    <input
                                        value={adminActivitySearch}
                                        onChange={e => { setAdminActivitySearch(e.target.value); setAdminActivityPage(0); }}
                                        placeholder={t('ops.admin_activity_search')}
                                        className="ps-9 pe-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm w-56 bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-brand-gold outline-none transition"
                                    />
                                </div>
                                <button
                                    onClick={() => void loadAdminActivity()}
                                    aria-label={t('ops.refresh_activity')}
                                    className="inline-flex items-center gap-2 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-white/10 px-3.5 py-2 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition cursor-pointer"
                                >
                                    <RefreshCw size={15} />
                                </button>
                            </>
                        }
                    >
                        {adminActivity.length === 0 ? (
                            <EmptyPanel text={t('ops.no_admin_activity')} />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[900px] text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 dark:border-white/10 text-start text-xs text-gray-500 dark:text-gray-400">
                                            <th className="px-3 py-3 font-bold">{t('ops.col_time')}</th>
                                            <th className="px-3 py-3 font-bold">{t('ops.activity_actor')}</th>
                                            <th className="px-3 py-3 font-bold">{t('ops.col_action')}</th>
                                            <th className="px-3 py-3 font-bold">تفصيل العملية والنتيجة</th>
                                            <th className="px-3 py-3 font-bold">{t('ops.activity_changes')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {adminActivity.map((item) => (
                                            <tr key={item.id} className="border-b border-gray-100 align-top transition hover:bg-slate-50/80 dark:border-white/5 dark:hover:bg-white/[0.035]">
                                                <td className="px-3 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                                                    {new Date(item.timestamp).toLocaleString()}
                                                </td>
                                                <td className="px-3 py-4">
                                                    <div className="font-bold text-brand-navy dark:text-white">{item.actorEmail ?? t('ops.na')}</div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        {item.actorRole === 'ADMIN' ? t('ops.role_admin')
                                                            : item.actorRole === 'FINANCE' ? t('ops.role_finance')
                                                                : item.actorRole === 'COURSE_MANAGER' ? t('ops.role_course_manager')
                                                                    : item.actorRole ?? t('ops.na')}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-4 font-bold text-brand-navy dark:text-white">
                                                    <div>{item.action}</div>
                                                    <div className="mt-1 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                                        {item.details?.outcome ?? 'نجح التنفيذ'}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-4 text-gray-700 dark:text-gray-300">
                                                    <div className="font-medium text-brand-navy dark:text-white">
                                                        {item.details?.summary ?? `${item.actorEmail ?? 'المستخدم'} نفّذ «${item.action}» على ${item.targetLabel ?? item.targetType ?? 'عنصر إداري'}.`}
                                                    </div>
                                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                                        الهدف: {item.targetLabel ?? item.targetType ?? t('ops.na')}
                                                    </div>
                                                    {item.targetId && <div className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 break-all" dir="ltr">ID: {item.targetId}</div>}
                                                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-all" dir="ltr">{item.method} · {item.route}</div>
                                                </td>
                                                <td className="px-3 py-4 text-gray-700 dark:text-gray-300">
                                                    {item.details?.changes?.length ? (
                                                        <ul className="space-y-2">
                                                            {item.details.changes.map((change, index) => (
                                                                <li key={`${change.field}-${index}`}>
                                                                    <div className="font-bold">{change.label}</div>
                                                                    {change.previousValue !== undefined && (
                                                                        <div className="text-xs text-red-600 dark:text-red-300">قبل: {String(change.previousValue)}</div>
                                                                    )}
                                                                    {(change.newValue !== undefined || change.value !== undefined) && (
                                                                        <div className="text-xs text-green-700 dark:text-green-300">
                                                                            {change.previousValue !== undefined ? 'بعد: ' : 'القيمة المسجلة: '}
                                                                            {String(change.newValue ?? change.value)}
                                                                        </div>
                                                                    )}
                                                                    {change.previousValue === undefined && change.newValue === undefined && change.value === undefined && (
                                                                        <div className="text-xs text-gray-500">تم إرسال هذا الحقل</div>
                                                                    )}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : <span className="text-gray-500 dark:text-gray-400">{t('ops.no_field_details')}</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <Pager
                            page={adminActivityPage}
                            total={adminActivityTotal}
                            pageSize={PAGE_SIZE}
                            onChange={setAdminActivityPage}
                            t={t}
                        />
                    </Panel>
                )}

                {tab === 'devices' && (
                    <Panel
                        icon={Monitor}
                        title={t('ops.devices_title')}
                        subtitle={`${t('ops.devices_subtitle')}: ${deviceTotal}`}
                        actions={
                            <>
                                <div className="relative">
                                    <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                                    <input
                                        value={search}
                                        onChange={e => { setSearch(e.target.value); setDevicePage(0); }}
                                        placeholder={t('ops.search_devices')}
                                        className="ps-9 pe-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm w-56 bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-brand-gold outline-none transition"
                                    />
                                </div>
                                <select
                                    value={deviceTypeFilter}
                                    onChange={e => { setDeviceTypeFilter(e.target.value); setDevicePage(0); }}
                                    className="px-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-gold font-bold"
                                >
                                    <option value="">{t('ops.filter_all_types')}</option>
                                    <option value="desktop">{t('ops.device_desktop')}</option>
                                    <option value="mobile">{t('ops.device_mobile')}</option>
                                    <option value="tablet">{t('ops.device_tablet')}</option>
                                    <option value="tv">{t('ops.device_tv')}</option>
                                    <option value="bot">{t('ops.device_bot')}</option>
                                    <option value="unknown">{t('ops.device_unknown')}</option>
                                </select>
                            </>
                        }
                    >
                        <DeviceTable
                            devices={devices}
                            onOpen={openDevice}
                            loadingDetail={loadingDetail}
                            t={t}
                        />
                        <Pager
                            page={devicePage}
                            total={deviceTotal}
                            pageSize={PAGE_SIZE}
                            onChange={setDevicePage}
                            t={t}
                        />
                    </Panel>
                )}
                {tab === 'settings' && (
                    <OperationsSettingsPanel headers={headers} t={t} onGrantLost={lock} />
                )}
            </main>

            {selected && (
                <DeviceDrawer
                    detail={selected}
                    loadingMore={loadingMoreEvents}
                    onLoadMore={loadMoreDeviceEvents}
                    onClose={() => setSelected(null)}
                    t={t}
                />
            )}
        </div>
    );
}

/* -------------------------------------------------------------- sub-views */

function Gate({
    keyValue, setKeyValue, error, busy, onSubmit, onRecover, clearError, t,
}: {
    keyValue: string;
    setKeyValue: (v: string) => void;
    error: string | null;
    busy: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onRecover: (values: {
        accountPassword: string;
        twoFactorCode: string;
        newPassword: string;
        confirmPassword: string;
    }) => Promise<void>;
    clearError: () => void;
    t: (k: string) => string;
}) {
    const [recovering, setRecovering] = useState(false);
    const [accountPassword, setAccountPassword] = useState('');
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const submitRecovery = (e: React.FormEvent) => {
        e.preventDefault();
        void onRecover({ accountPassword, twoFactorCode, newPassword, confirmPassword });
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-brand-navy-dark via-brand-navy to-[#0e2a52] flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute -top-32 -start-32 w-[28rem] h-[28rem] bg-brand-gold/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 end-0 w-96 h-96 bg-brand-gold/5 rounded-full blur-3xl" />

            <div className="relative w-full max-w-md">
                <div className="text-center mb-7">
                    <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center mx-auto mb-4">
                        <ShieldCheck size={30} className="text-brand-gold-light" />
                    </div>
                    <h1 className="text-2xl font-black text-ink-on-navy tracking-tight">{recovering ? t('ops.recovery_title') : t('ops.title')}</h1>
                    <p className="text-sm text-ink-on-navy-subtle mt-2 leading-relaxed">{t('ops.gate_subtitle')}</p>
                </div>

                <form onSubmit={recovering ? submitRecovery : onSubmit} className="bg-white dark:bg-brand-navy-dark/95 backdrop-blur-xl border border-white/10 rounded-3xl p-7 shadow-2xl space-y-5">
                    {recovering ? (
                        <>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{t('ops.recovery_hint')}</p>
                            <div>
                                <label htmlFor="ops-account-password" className="block text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    {t('ops.account_password')}
                                </label>
                                <input
                                    id="ops-account-password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={accountPassword}
                                    onChange={e => setAccountPassword(e.target.value)}
                                    className="w-full px-4 py-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-brand-navy dark:text-white focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition"
                                />
                            </div>
                            <div>
                                <label htmlFor="ops-recovery-totp" className="block text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    {t('ops.recovery_2fa')}
                                </label>
                                <input
                                    id="ops-recovery-totp"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    value={twoFactorCode}
                                    onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className="w-full px-4 py-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-brand-navy dark:text-white focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition"
                                />
                            </div>
                            <div>
                                <label htmlFor="ops-new-password" className="block text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    {t('ops.new_password')}
                                </label>
                                <input
                                    id="ops-new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={12}
                                    maxLength={200}
                                    required
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    className="w-full px-4 py-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-brand-navy dark:text-white focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition"
                                />
                            </div>
                            <div>
                                <label htmlFor="ops-confirm-password" className="block text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    {t('ops.confirm_password')}
                                </label>
                                <input
                                    id="ops-confirm-password"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={12}
                                    maxLength={200}
                                    required
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    className="w-full px-4 py-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-brand-navy dark:text-white focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition"
                                />
                            </div>
                        </>
                    ) : (
                        <div>
                            <label htmlFor="ops-key" className="block text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                {t('ops.gate_label')}
                            </label>
                            <div className="relative">
                                <KeyRound size={18} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    id="ops-key"
                                    type="password"
                                    autoFocus
                                    autoComplete="off"
                                    value={keyValue}
                                    onChange={e => setKeyValue(e.target.value)}
                                    placeholder="••••••••••••"
                                    className="w-full ps-11 pe-4 py-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-brand-navy dark:text-white placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition"
                                />
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2.5 p-3.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                            <AlertTriangle size={17} className="text-red-500 shrink-0 mt-0.5" />
                            <p className="text-sm font-bold text-red-700 dark:text-red-400">{error}</p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={busy || (recovering ? !accountPassword || !newPassword || !confirmPassword : !keyValue)}
                        data-ops-action={recovering ? 'operations.password.recover' : 'operations.unlock'}
                        className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-light hover:to-brand-gold text-black py-3.5 rounded-2xl font-black shadow-lg shadow-brand-gold/25 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                    >
                        {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                        {busy ? t('ops.unlocking') : recovering ? t('ops.recovery_submit') : t('ops.unlock')}
                    </button>

                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            clearError();
                            setRecovering(!recovering);
                        }}
                        className="w-full text-sm font-bold text-brand-navy dark:text-brand-gold-light hover:underline disabled:opacity-50"
                    >
                        {recovering ? t('ops.recovery_back') : t('ops.recover_link')}
                    </button>

                    <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed text-center">
                        {t('ops.gate_hint')}
                    </p>
                </form>
            </div>
        </div>
    );
}

function Stat({
    icon: Icon, label, value, change, tone,
}: {
    icon: LucideIcon;
    label: string;
    value?: number;
    change?: number | null;
    tone: 'blue' | 'gold' | 'purple' | 'green' | 'gray' | 'amber';
}) {
    const tiles: Record<string, string> = {
        blue: 'bg-brand-navy-light/15 text-brand-navy-light',
        gold: 'bg-brand-gold/15 text-brand-gold-light',
        purple: 'bg-purple-500/15 text-purple-400',
        green: 'bg-emerald-500/15 text-emerald-400',
        gray: 'bg-gray-500/15 text-gray-400',
        amber: 'bg-orange-500/15 text-orange-400',
    };
    return (
        <div className="group relative overflow-hidden bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-[0_8px_30px_rgba(15,42,67,0.06)] hover:shadow-[0_16px_40px_rgba(15,42,67,0.12)] hover:-translate-y-0.5 transition-all duration-200">
            <div className={`absolute inset-x-0 top-0 h-1 opacity-70 ${tone === 'gold' ? 'bg-brand-gold' : tone === 'green' ? 'bg-emerald-500' : tone === 'purple' ? 'bg-purple-500' : tone === 'amber' ? 'bg-orange-500' : 'bg-brand-navy-light'}`} />
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${tiles[tone]}`}>
                <Icon size={18} />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-brand-navy dark:text-white tabular-nums tracking-tight">{value === undefined ? '—' : value.toLocaleString()}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">{label}</span>
                {change !== null && change !== undefined && (
                    <span className={`text-[10px] font-black rounded-full px-1.5 py-0.5 ${change >= 0 ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10' : 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-500/10'}`}>
                        {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
                    </span>
                )}
            </div>
        </div>
    );
}

function Panel({
    icon: Icon, title, subtitle, actions, children,
}: {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-6 shadow-[0_8px_30px_rgba(15,42,67,0.05)] hover:shadow-[0_14px_36px_rgba(15,42,67,0.09)] transition-shadow">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-gold/20 to-brand-gold/5 text-brand-gold-dark dark:text-brand-gold-light ring-1 ring-brand-gold/10 flex items-center justify-center shrink-0">
                        <Icon size={18} />
                    </div>
                    <div>
                        <h2 className="font-black text-brand-navy dark:text-white leading-tight">{title}</h2>
                        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold mt-0.5">{subtitle}</p>}
                    </div>
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
            </div>
            {children}
        </section>
    );
}

function Legend({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
            {label}
        </span>
    );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
    const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
    return (
        <Panel icon={Monitor} title={title}>
            {rows.length === 0 ? (
                <EmptyPanel text="—" />
            ) : (
                <ul className="space-y-3">
                    {rows.map((row) => (
                        <li key={row.name}>
                            <div className="flex items-center justify-between gap-3 text-xs font-bold mb-1.5">
                                <span className="text-brand-navy dark:text-white">{row.name}</span>
                                <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                                    {row.count} · {Math.round((row.count / total) * 100)}%
                                </span>
                            </div>
                            <div className="h-2 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-brand-navy to-brand-navy-light rounded-full" style={{ width: `${(row.count / total) * 100}%` }} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Panel>
    );
}

function EmptyPanel({ text }: { text: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <span className="w-11 h-11 rounded-2xl bg-gray-100 dark:bg-white/5 text-gray-400 flex items-center justify-center">
                <Activity size={18} />
            </span>
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">{text}</p>
        </div>
    );
}

function EventTable({
    events, onOpenDevice, loadingDetail, t,
}: {
    events: TrackedEvent[];
    onOpenDevice: (id: string) => void;
    loadingDetail: boolean;
    t: (k: string) => string;
}) {
    if (events.length === 0) {
        return <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-10">{t('ops.no_events')}</p>;
    }
    return (
        <div className="overflow-x-auto -mx-5 sm:-mx-6">
            <table className="w-full text-start text-sm min-w-[900px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-[#102542]">
                    <tr className="border-b border-gray-200 dark:border-white/5">
                        <Th>{t('ops.col_time')}</Th>
                        <Th>{t('ops.col_type')}</Th>
                        <Th>{t('ops.col_action')}</Th>
                        <Th>{t('ops.col_device')}</Th>
                        <Th>{t('ops.col_user')}</Th>
                        <Th center>{t('ops.col_status')}</Th>
                        <Th>{t('ops.col_device_action')}</Th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                    {events.map((event) => {
                        const Icon = EVENT_ICONS[event.type] ?? Activity;
                        const DeviceIcon = DEVICE_ICONS[event.session.deviceType] ?? Cpu;
                        return (
                            <tr key={event.id} className="border-b border-gray-100/80 hover:bg-slate-50/80 dark:border-white/5 dark:hover:bg-white/[0.035] transition-colors">
                                <td className="px-4 py-3 font-mono text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    {new Date(event.createdAt).toLocaleString()}
                                </td>
                                <td className="px-4 py-3">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-navy dark:text-white">
                                        <Icon size={14} className="text-brand-gold-dark dark:text-brand-gold" />
                                        {t(`ops.type_${event.type}`)}
                                    </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-[11px] text-gray-600 dark:text-gray-300 max-w-[280px] truncate" dir="ltr">
                                    {event.type === 'api_call'
                                        ? `${event.method} ${shortPath(event.path ?? '')}`
                                        : (event.label ?? event.path ?? '—')}
                                </td>
                                <td className="px-4 py-3">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                        <DeviceIcon size={14} />
                                        {event.session.browser ?? '—'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs">
                                    {event.session.user ? (
                                        <span className="font-bold text-brand-navy dark:text-white truncate block max-w-[160px]">
                                            {event.session.user.email}
                                        </span>
                                    ) : (
                                        <span className="text-gray-400 italic">{t('ops.guest')}</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {event.statusCode !== null ? (
                                        <Pill tone={statusTone(event.statusCode)}>{event.statusCode}</Pill>
                                    ) : (
                                        <span className="text-gray-400 text-xs">—</span>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <button
                                        onClick={() => onOpenDevice(event.session.id)}
                                        disabled={loadingDetail}
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-gold-dark dark:text-brand-gold hover:underline disabled:opacity-50 cursor-pointer"
                                    >
                                        {t('ops.view_device')}
                                        <ArrowRight size={13} className="rtl:rotate-180" />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function DeviceTable({
    devices, onOpen, loadingDetail, t,
}: {
    devices: TrackedSession[];
    onOpen: (id: string) => void;
    loadingDetail: boolean;
    t: (k: string) => string;
}) {
    if (devices.length === 0) {
        return <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-10">{t('ops.no_devices')}</p>;
    }
    return (
        <div className="overflow-x-auto -mx-5 sm:-mx-6">
            <table className="w-full text-start text-sm min-w-[900px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-[#102542]">
                    <tr className="border-b border-gray-200 dark:border-white/5">
                        <Th>{t('ops.col_device')}</Th>
                        <Th>{t('ops.col_os')}</Th>
                        <Th>{t('ops.col_ip')}</Th>
                        <Th>{t('ops.col_user')}</Th>
                        <Th center>{t('ops.col_pages')}</Th>
                        <Th>{t('ops.col_last_seen')}</Th>
                        <Th>{t('ops.col_device_action')}</Th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                    {devices.map((device) => {
                        const DeviceIcon = DEVICE_ICONS[device.deviceType] ?? Cpu;
                        return (
                            <tr key={device.id} className="group border-b border-gray-100/80 hover:bg-slate-50/80 dark:border-white/5 dark:hover:bg-white/[0.035] transition-colors">
                                <td className="px-4 py-3">
                                    <span className="inline-flex items-center gap-2 text-xs font-bold text-brand-navy dark:text-white">
                                        <span className="w-8 h-8 rounded-xl bg-brand-gold/10 flex items-center justify-center">
                                            <DeviceIcon size={15} className="text-brand-gold-dark dark:text-brand-gold" />
                                        </span>
                                        {t(`ops.device_${device.deviceType}`)}
                                        <span className="text-gray-500 dark:text-gray-400 font-normal">
                                            {device.browser ?? '—'}
                                        </span>
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">{device.os ?? '—'}</td>
                                <td className="px-4 py-3 font-mono text-[11px] text-gray-600 dark:text-gray-300" dir="ltr">
                                    {device.ipAddress ?? t('ops.na')}
                                </td>
                                <td className="px-4 py-3 text-xs">
                                    {device.user ? (
                                        <span className="font-bold text-brand-navy dark:text-white">{device.user.email}</span>
                                    ) : (
                                        <span className="text-gray-400 italic">{t('ops.guest')}</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center text-xs font-black text-brand-navy dark:text-white tabular-nums">
                                    {device.pageViews}
                                </td>
                                <td className="px-4 py-3 font-mono text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    {new Date(device.lastSeenAt).toLocaleString()}
                                </td>
                                <td className="px-4 py-3">
                                    <button
                                        onClick={() => onOpen(device.id)}
                                        disabled={loadingDetail}
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-navy dark:text-white bg-gray-100 dark:bg-white/5 group-hover:bg-brand-gold group-hover:text-brand-navy-dark px-3 py-2 rounded-lg transition disabled:opacity-50 cursor-pointer"
                                    >
                                        {t('ops.view_device')}
                                        <ArrowRight size={13} className="rtl:rotate-180" />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function DeviceDrawer({
    detail, loadingMore, onLoadMore, onClose, t,
}: {
    detail: SessionDetail;
    loadingMore: boolean;
    onLoadMore: () => void;
    onClose: () => void;
    t: (k: string) => string;
}) {
    const { session, counts, summary } = detail;
    const events = session.events ?? [];
    const DeviceIcon = DEVICE_ICONS[session.deviceType] ?? Cpu;
    const rows: Array<[string, string]> = [
        [t('ops.field_visitor_id'), session.visitorId],
        [t('ops.field_ip'), session.ipAddress ?? t('ops.na')],
        [t('ops.field_device'), t(`ops.device_${session.deviceType}`)],
        [t('ops.field_browser'), session.browser ?? t('ops.na')],
        [t('ops.field_os'), session.os ?? t('ops.na')],
        [t('ops.field_screen'), session.screen ?? t('ops.na')],
        [t('ops.field_timezone'), session.timezone ?? t('ops.na')],
        [t('ops.field_language'), session.language ?? t('ops.na')],
        [t('ops.field_referrer'), session.referrer ?? t('ops.na')],
        [t('ops.field_account'), session.user?.email ?? t('ops.guest')],
        [t('ops.field_first_seen'), new Date(session.firstSeenAt).toLocaleString()],
        [t('ops.field_last_seen'), new Date(session.lastSeenAt).toLocaleString()],
    ];

    return (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <aside className="relative w-full max-w-3xl bg-slate-50 dark:bg-[#0b1c32] border-s border-gray-200 dark:border-white/10 shadow-2xl flex flex-col animate-fade-in">
                <div className="relative overflow-hidden bg-gradient-to-br from-brand-navy-dark via-brand-navy to-[#204779] px-5 sm:px-7 py-6 sm:py-7">
                    <div className="absolute -top-20 -end-10 w-56 h-56 rounded-full bg-brand-gold/10 blur-3xl pointer-events-none" />
                    <div className="relative flex items-start justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                            <div className="w-14 h-14 rounded-2xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center shrink-0">
                                <DeviceIcon size={26} className="text-brand-gold-light" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-lg sm:text-xl font-black text-white">{t('ops.drawer_title')}</h2>
                                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${session.isAuthenticated ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-200/20' : 'bg-white/10 text-white/75 ring-white/10'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${session.isAuthenticated ? 'bg-emerald-400' : 'bg-white/40'}`} />
                                        {session.isAuthenticated ? t('ops.stat_signed_in') : t('ops.guest')}
                                    </span>
                                </div>
                                <p className="text-xs text-white/65 mt-1.5 font-mono truncate" dir="ltr">{session.visitorId}</p>
                                <p className="text-xs text-white/80 mt-1">
                                    {[t(`ops.device_${session.deviceType}`), session.browser, session.os].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            aria-label={t('common.close')}
                            className="w-10 h-10 rounded-xl bg-white/10 text-white/80 hover:bg-white/20 hover:text-white ring-1 ring-white/10 flex items-center justify-center transition cursor-pointer shrink-0"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {([
                            [t('ops.count_pages'), counts.pageViews, Eye],
                            [t('ops.count_calls'), counts.apiCalls, Activity],
                            [t('ops.count_actions'), counts.actions, MousePointerClick],
                            [t('ops.count_security'), counts.security, ShieldCheck],
                        ] as const).map(([label, value, Icon]) => (
                            <div key={label} className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-3.5 text-center shadow-sm">
                                <div className="w-8 h-8 rounded-xl bg-brand-gold/10 mx-auto mb-2 flex items-center justify-center">
                                    <Icon size={15} className="text-brand-gold-dark dark:text-brand-gold" />
                                </div>
                                <div className="text-xl font-black text-brand-navy dark:text-white tabular-nums">{value.toLocaleString()}</div>
                                <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
                            </div>
                        ))}
                    </div>

                    {summary && (
                        <>
                            <section className="grid sm:grid-cols-3 gap-3">
                                <div className="bg-gradient-to-br from-brand-navy-dark to-brand-navy text-white border border-white/10 rounded-2xl p-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-brand-gold-light text-[10px] font-bold mb-2"><Clock size={14} /> {t('ops.summary_duration')}</div>
                                    <p className="text-2xl font-black tabular-nums">{summary.durationMinutes} <span className="text-xs text-white/60">{t('ops.summary_minutes')}</span></p>
                                </div>
                                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-[10px] font-bold mb-2"><Route size={14} /> {t('ops.summary_unique_pages')}</div>
                                    <p className="text-2xl font-black text-brand-navy dark:text-white tabular-nums">{summary.uniquePages}</p>
                                </div>
                                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-[10px] font-bold mb-2"><Activity size={14} /> {t('ops.summary_analyzed')}</div>
                                    <p className="text-2xl font-black text-brand-navy dark:text-white tabular-nums">{summary.summarizedEvents.toLocaleString()}</p>
                                </div>
                            </section>

                            <section className="grid lg:grid-cols-2 gap-4">
                                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-sm min-w-0">
                                    <h3 className="text-xs font-black text-brand-navy dark:text-white mb-4 flex items-center gap-2"><Eye size={14} className="text-brand-gold-dark dark:text-brand-gold" /> {t('ops.summary_top_pages')}</h3>
                                    <div className="space-y-3">
                                        {summary.topPages.length === 0 ? <p className="text-xs text-gray-400">—</p> : summary.topPages.map((item) => {
                                            const max = summary.topPages[0]?.count || 1;
                                            return (
                                                <div key={item.name}>
                                                    <div className="flex items-center gap-3 mb-1.5">
                                                        <span className="text-[11px] font-mono text-gray-600 dark:text-gray-300 truncate flex-1" dir="ltr" title={item.name}>{item.name}</span>
                                                        <span className="text-xs font-black text-brand-navy dark:text-white tabular-nums">{item.count}</span>
                                                    </div>
                                                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-brand-gold" style={{ width: `${Math.max(8, item.count / max * 100)}%` }} /></div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-sm min-w-0">
                                    <h3 className="text-xs font-black text-brand-navy dark:text-white mb-4 flex items-center gap-2"><MousePointerClick size={14} className="text-brand-gold-dark dark:text-brand-gold" /> {t('ops.summary_top_actions')}</h3>
                                    <div className="space-y-3">
                                        {summary.topActions.length === 0 ? <p className="text-xs text-gray-400">—</p> : summary.topActions.map((item) => {
                                            const max = summary.topActions[0]?.count || 1;
                                            return (
                                                <div key={item.name}>
                                                    <div className="flex items-center gap-3 mb-1.5">
                                                        <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate flex-1" title={item.name}>{item.name}</span>
                                                        <span className="text-xs font-black text-brand-navy dark:text-white tabular-nums">{item.count}</span>
                                                    </div>
                                                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(8, item.count / max * 100)}%` }} /></div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>

                            <section className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-sm">
                                <h3 className="text-xs font-black text-brand-navy dark:text-white mb-4 flex items-center gap-2"><Route size={14} className="text-brand-gold-dark dark:text-brand-gold" /> {t('ops.summary_route')}</h3>
                                {summary.routeSequence.length === 0 ? (
                                    <p className="text-xs text-gray-400">—</p>
                                ) : (
                                    <div className="flex items-center gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
                                        {summary.routeSequence.map((route, index) => (
                                            <div key={`${route}-${index}`} className="flex items-center gap-2 shrink-0">
                                                <span className="max-w-44 truncate rounded-lg bg-brand-navy/5 dark:bg-white/5 border border-gray-100 dark:border-white/5 px-3 py-2 text-[10px] font-mono text-brand-navy dark:text-white" dir="ltr" title={route}>{route}</span>
                                                {index < summary.routeSequence.length - 1 && <ArrowRight size={12} className="text-gray-400 rtl:rotate-180" />}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </>
                    )}

                    <section className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-sm">
                        <h3 className="text-xs font-black text-brand-navy dark:text-white mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-5 rounded-full bg-brand-gold" />
                            {t('ops.drawer_fingerprint')}
                        </h3>
                        <dl className="grid sm:grid-cols-2 gap-x-6">
                            {rows.map(([label, value]) => (
                                <div key={label} className="flex flex-col gap-1 py-2.5 border-b border-gray-100 dark:border-white/5 min-w-0">
                                    <dt className="text-[10px] text-gray-500 dark:text-gray-400 font-bold">{label}</dt>
                                    <dd className="text-xs text-brand-navy dark:text-white font-semibold truncate" dir="auto" title={value}>{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {session.userAgent && (
                            <div className="mt-4">
                                <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-2">{t('ops.field_user_agent')}</p>
                                <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300 break-all bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 rounded-xl p-3" dir="ltr">
                                    {session.userAgent}
                                </p>
                            </div>
                        )}
                    </section>

                    <section className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-sm">
                        <h3 className="text-xs font-black text-brand-navy dark:text-white mb-4 flex items-center gap-2">
                            <span className="w-1.5 h-5 rounded-full bg-brand-gold" />
                            {t('ops.drawer_timeline')}
                            <span className="ms-auto text-[10px] text-gray-500 dark:text-gray-400 font-bold tabular-nums">{events.length} / {counts.total}</span>
                        </h3>
                        <ol className="relative space-y-3 max-h-[32rem] overflow-y-auto pe-1 before:absolute before:top-3 before:bottom-3 before:start-[15px] before:w-px before:bg-gray-200 dark:before:bg-white/10">
                            {events.map((event) => {
                                const Icon = EVENT_ICONS[event.type] ?? Activity;
                                return (
                                    <li key={event.id} className="relative flex items-start gap-3">
                                        <span className="relative z-10 w-8 h-8 rounded-xl bg-brand-navy text-white ring-4 ring-white dark:ring-brand-navy-dark flex items-center justify-center shrink-0">
                                            <Icon size={13} className="text-brand-gold-light" />
                                        </span>
                                        <div className="flex-1 min-w-0 rounded-xl bg-gray-50/80 dark:bg-white/[0.03] border border-gray-100 dark:border-white/5 p-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-black text-brand-navy dark:text-white">
                                                    {t(`ops.type_${event.type}`)}
                                                </span>
                                                {event.statusCode !== null && <Pill tone={statusTone(event.statusCode)}>{event.statusCode}</Pill>}
                                                {event.durationMs !== null && (
                                                    <span className="text-[10px] font-mono text-gray-400">{event.durationMs}ms</span>
                                                )}
                                            </div>
                                            <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate" dir="ltr">
                                                {event.type === 'api_call'
                                                    ? `${event.method} ${event.path ?? ''}`
                                                    : event.type === 'page_view'
                                                        ? (event.path ?? event.label ?? '—')
                                                        : (event.label ?? '—')}
                                            </p>
                                            {event.type === 'page_view' && event.label && event.label !== event.path && (
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{event.label}</p>
                                            )}
                                            {event.type === 'action' && event.path && (
                                                <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400 truncate" dir="ltr">
                                                    {event.path}
                                                </p>
                                            )}
                                            {event.meta && Object.keys(event.meta).length > 0 && (
                                                <dl className="flex flex-wrap gap-1.5 mt-1.5">
                                                    {Object.entries(event.meta).map(([key, value]) => (
                                                        <div
                                                            key={key}
                                                            className="inline-flex items-center gap-1 rounded-md bg-brand-gold/10 px-2 py-1 text-[10px]"
                                                        >
                                                            <dt className="font-bold text-gray-600 dark:text-gray-300">{t(`ops.meta_${key}`)}:</dt>
                                                            <dd className="font-mono text-brand-navy dark:text-white break-all" dir="auto">{String(value)}</dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                            )}
                                            <p className="text-[10px] text-gray-400 font-mono">{new Date(event.createdAt).toLocaleString()}</p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                        {events.length < counts.total && (
                            <button
                                type="button"
                                onClick={onLoadMore}
                                disabled={loadingMore}
                                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-white/10 px-4 py-2.5 text-xs font-bold text-brand-navy dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-60 transition"
                            >
                                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                                {loadingMore ? t('ops.loading_more_events') : t('ops.load_more_events')}
                                {!loadingMore && <span className="text-gray-500">({counts.total - events.length})</span>}
                            </button>
                        )}
                    </section>
                </div>

                <div className="p-4 sm:px-6 border-t border-gray-200 dark:border-white/10 bg-white/80 dark:bg-brand-navy-dark/90">
                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-xl bg-brand-navy text-white font-bold shadow-lg shadow-brand-navy/15 hover:bg-brand-navy-light transition cursor-pointer"
                    >
                        {t('common.close')}
                    </button>
                </div>
            </aside>
        </div>
    );
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
    return (
        <th className={`border-b border-gray-200/80 bg-slate-50/95 px-4 py-3.5 text-[10px] font-black uppercase tracking-[0.12em] text-gray-500 whitespace-nowrap backdrop-blur dark:border-white/5 dark:bg-[#102542]/95 dark:text-gray-400 ${center ? 'text-center' : 'text-start'}`}>
            {children}
        </th>
    );
}

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'gray'; children: React.ReactNode }) {
    const tones: Record<string, string> = {
        green: 'bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/20',
        amber: 'bg-brand-gold/15 text-brand-gold-dark dark:text-brand-gold-light ring-1 ring-brand-gold/20',
        red: 'bg-red-500/15 text-red-500 ring-1 ring-red-500/20',
        gray: 'bg-gray-500/15 text-gray-500 ring-1 ring-gray-500/20',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-black tabular-nums ${tones[tone]}`}>
            {children}
        </span>
    );
}

function Pager({
    page, total, pageSize, onChange, t,
}: {
    page: number;
    total: number;
    pageSize: number;
    onChange: (p: number) => void;
    t: (k: string) => string;
}) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (pages <= 1) return null;
    return (
        <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-gray-200 dark:border-white/5">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                {`${t('ops.pager_label')} ${page + 1} / ${pages}`}
            </span>
            <div className="flex gap-2">
                <PagerBtn disabled={page === 0} onClick={() => onChange(page - 1)} t={t}>
                    {t('ops.pager_prev')}
                </PagerBtn>
                <PagerBtn disabled={page >= pages - 1} onClick={() => onChange(page + 1)} t={t}>
                    {t('ops.pager_next')}
                </PagerBtn>
            </div>
        </div>
    );
}

function PagerBtn({
    children, disabled, onClick, t,
}: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick: () => void;
    t: (k: string) => string;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={t('ops.pager_next')}
            className="inline-flex items-center gap-1.5 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-white/10 px-3.5 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
            {children}
        </button>
    );
}

/**
 * The page is ADMIN-only in the UI as well as the API.
 *
 * This wrapper is not the security boundary -- the backend refuses a non-admin
 * token and a missing grant regardless of what the browser renders. It exists
 * so a non-admin who types the path gets the ordinary "not authorized" screen
 * instead of a password box that would fail a moment later.
 */
export default function OperationsCenter() {
    return (
        <ProtectedRoute allowedRoles={['ADMIN']}>
            <OperationsCenterPage />
        </ProtectedRoute>
    );
}
