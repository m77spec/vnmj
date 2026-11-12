"use client";

import { useMemo, useState } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { BookOpen, Clock, CheckCircle, XCircle, GraduationCap, Award, CreditCard, ChevronRight, Video, Search, SlidersHorizontal, X, CalendarClock } from 'lucide-react';
import StudentSessionList, { StudentLiveSession } from '@/components/StudentSessionList';
import Link from 'next/link';

interface Enrollment {
    id: string;
    status: string;
    createdAt: string;
    progressPercent?: number | null;
    learningCompleted?: boolean;
    financeOfficerNotes?: string | null;
    course: {
        id: string;
        titleAr?: string | null;
        titleEn?: string | null;
        descriptionAr?: string | null;
        descriptionEn?: string | null;
    };
    opening?: {
        id?: string;
        status?: string | null;
        nameAr?: string | null;
        nameEn?: string | null;
        price: string;
        startDate?: string | null;
        endDate?: string | null;
        deliveryMode?: string | null;
    } | null;
    /** Only present when the batch is ONLINE and this enrollment is APPROVED. */
    meetLink?: string | null;
    /**
     * The batch's meeting schedule, already gated on the same rule as
     * `meetLink`: an empty array for anyone who is not APPROVED, and for a
     * student whose batch has no sessions yet.
     */
    liveSessions?: StudentLiveSession[];
}

interface GradeRow {
    id: string;
    score: number;
    assessment: { id: string; nameAr: string; nameEn: string; maxScore: number };
}

interface Assessment {
    id: string;
    nameAr: string;
    nameEn: string;
    maxScore: number;
}

interface GradedEnrollment {
    course: { id: string };
    opening?: { id: string } | null;
    grades: GradeRow[];
    assessments: Assessment[];
}

type EnrollmentFilter = 'ALL' | 'ACTIVE' | 'PENDING' | 'ENDED' | 'COMPLETED' | 'REJECTED';

const enrollmentPriority: Record<EnrollmentFilter, number> = {
    ACTIVE: 0,
    PENDING: 1,
    ENDED: 2,
    COMPLETED: 3,
    REJECTED: 4,
    ALL: 5,
};

const hasCompletedLearning = (enrollment: Enrollment) =>
    enrollment.status === 'APPROVED' && enrollment.learningCompleted === true;

const hasEndedBatch = (enrollment: Enrollment) =>
    enrollment.status === 'APPROVED' && enrollment.opening?.status === 'ENDED';

const enrollmentGroup = (enrollment: Enrollment): EnrollmentFilter => {
    if (hasCompletedLearning(enrollment)) return 'COMPLETED';
    if (hasEndedBatch(enrollment)) return 'ENDED';
    if (enrollment.status === 'APPROVED') return 'ACTIVE';
    if (enrollment.status === 'REJECTED') return 'REJECTED';
    return 'PENDING';
};

export default function MyCoursesPage() {
    const { data: enrollments, loading, error } = useFetchData<Enrollment[]>('/enrollments/my');
    const { data: gradesData } = useFetchData<GradedEnrollment[]>('/enrollments/my/grades');
    const { t, pick, locale } = useI18n();
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<EnrollmentFilter>('ALL');

    const statusLabel = (status: string) => t('statuses.' + (status || '').toLowerCase()) || status;

    /**
     * A reservation only becomes money owed once the opening is OPEN. This
     * mirrors the backend trigger in CoursesService.notifyReservedPaymentDue,
     * which fires on the transition into OPEN, and it is deliberately not
     * gated on `isPublished`: the payment page offers any OPEN/ANNOUNCEMENT
     * opening regardless of publication, so gating here would hide a payable
     * seat and leave the student with a notification but no way to act on it.
     */
    const paymentDue = (enrollment: Enrollment) =>
        enrollment.status === 'RESERVED' && enrollment.opening?.status === 'OPEN';

    const dueEnrollments = (enrollments ?? []).filter(paymentDue);

    const gradeByCourse = new Map<string, GradeRow[]>();
    const assessmentsByCourse = new Map<string, Assessment[]>();
    (gradesData || []).forEach(g => {
        gradeByCourse.set(g.course.id, g.grades || []);
        assessmentsByCourse.set(g.course.id, g.assessments || []);
    });

    const courseAvg = (courseId: string): number | null => {
        const rows = gradeByCourse.get(courseId) || [];
        if (!rows.length) return null;
        const pct = rows.reduce((sum, r) => sum + (r.assessment.maxScore > 0 ? (r.score / r.assessment.maxScore) * 100 : 0), 0) / rows.length;
        return Math.round(pct);
    };

    const filterCounts = useMemo(() => {
        const counts: Record<EnrollmentFilter, number> = {
            ALL: enrollments?.length ?? 0,
            ACTIVE: 0,
            PENDING: 0,
            ENDED: 0,
            COMPLETED: 0,
            REJECTED: 0,
        };
        (enrollments ?? []).forEach(enrollment => {
            counts[enrollmentGroup(enrollment)] += 1;
        });
        return counts;
    }, [enrollments]);

    const visibleEnrollments = useMemo(() => {
        const query = searchQuery.trim().toLocaleLowerCase(locale);
        return (enrollments ?? [])
            .filter(enrollment => {
                if (statusFilter !== 'ALL' && enrollmentGroup(enrollment) !== statusFilter) return false;
                if (!query) return true;
                const searchableText = [
                    pick(enrollment.course, 'title'),
                    pick(enrollment.opening, 'name'),
                ].filter(Boolean).join(' ').toLocaleLowerCase(locale);
                return searchableText.includes(query);
            })
            .sort((a, b) => {
                const groupDifference = enrollmentPriority[enrollmentGroup(a)] - enrollmentPriority[enrollmentGroup(b)];
                if (groupDifference !== 0) return groupDifference;
                const dateA = Date.parse(a.createdAt);
                const dateB = Date.parse(b.createdAt);
                return (Number.isFinite(dateB) ? dateB : 0) - (Number.isFinite(dateA) ? dateA : 0)
                    || a.id.localeCompare(b.id);
            });
    }, [enrollments, locale, pick, searchQuery, statusFilter]);

    const filters: EnrollmentFilter[] = ['ALL', 'ACTIVE', 'PENDING', 'ENDED', 'COMPLETED', 'REJECTED'];

    return (
        <ProtectedRoute allowedRoles={['STUDENT']}>
            <div className="min-w-0 bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 min-h-[80vh]">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-black text-brand-navy dark:text-white">{t('myCourses.heading')}</h2>
                        <p className="text-gray-500 dark:text-gray-400 mt-2">{t('myCourses.subtitle')}</p>
                    </div>
                    {!loading && !error && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-brand-gold/20 bg-brand-gold/10 px-4 py-2 text-sm font-black text-brand-navy dark:text-brand-gold-light">
                            <BookOpen size={16} />
                            {t('myCourses.total_courses').replace('{n}', String(filterCounts.ALL))}
                        </span>
                    )}
                </div>

                {error && <div className="p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl mb-6">{error}</div>}

                {!loading && dueEnrollments.length > 0 && (
                    <div className="mb-6 p-5 rounded-2xl border border-brand-gold/30 bg-brand-gold/10 flex flex-wrap items-center gap-4 animate-fade-in">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gold text-brand-navy-dark">
                            <CreditCard size={22} />
                        </span>
                        <div className="flex-1 min-w-[200px]">
                            <div className="font-black text-brand-navy dark:text-brand-gold-light">
                                {t('myCourses.payment_due_title').replace('{n}', String(dueEnrollments.length))}
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{t('myCourses.payment_due_desc')}</p>
                        </div>
                        <Link
                            href="/dashboard/payments"
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-light text-brand-navy-dark text-sm font-black px-5 py-3 rounded-xl hover:shadow-lg hover:shadow-brand-gold/25 transition whitespace-nowrap"
                        >
                            {t('myCourses.payment_due_cta')}
                            <ChevronRight size={16} className="rtl:rotate-180" />
                        </Link>
                    </div>
                )}

                {loading ? (
                    <div className="h-40 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('myCourses.loading')}</div>
                ) : (
                    <>
                    {filterCounts.ALL > 0 && (
                        <div className="mb-6 space-y-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                {([
                                    { key: 'ACTIVE', icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
                                    { key: 'PENDING', icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                                    { key: 'ENDED', icon: CalendarClock, color: 'text-gray-500', bg: 'bg-gray-500/10' },
                                    { key: 'COMPLETED', icon: Award, color: 'text-violet-500', bg: 'bg-violet-500/10' },
                                ] as const).map(item => (
                                    <div key={item.key} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/5 dark:bg-white/[0.03]">
                                        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.bg} ${item.color}`}>
                                            <item.icon size={19} />
                                        </span>
                                        <div>
                                            <p className="text-xl font-black text-brand-navy dark:text-white">{filterCounts[item.key]}</p>
                                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400">{t(`myCourses.filter_${item.key.toLowerCase()}`)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/5 dark:bg-white/[0.03]">
                                <div className="flex flex-col gap-3 lg:flex-row">
                                    <label className="relative min-w-0 flex-1">
                                        <Search size={17} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="search"
                                            value={searchQuery}
                                            onChange={event => setSearchQuery(event.target.value)}
                                            placeholder={t('myCourses.search_placeholder')}
                                            aria-label={t('myCourses.search_placeholder')}
                                            className="w-full rounded-xl border border-gray-200 bg-white py-3 ps-11 pe-4 text-sm font-semibold text-brand-navy outline-none transition placeholder:font-normal placeholder:text-gray-400 focus:border-brand-gold focus:ring-2 focus:ring-brand-gold/20 dark:border-white/10 dark:bg-brand-navy-dark dark:text-white"
                                        />
                                    </label>
                                    <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0" role="group" aria-label={t('myCourses.filter_courses')}>
                                        {filters.map(filter => (
                                            <button
                                                key={filter}
                                                type="button"
                                                onClick={() => setStatusFilter(filter)}
                                                aria-pressed={statusFilter === filter}
                                                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                                                    statusFilter === filter
                                                        ? 'border-brand-navy bg-brand-navy text-white dark:border-brand-gold dark:bg-brand-gold dark:text-brand-navy-dark'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:border-brand-gold/50 dark:border-white/10 dark:bg-brand-navy-dark dark:text-gray-300'
                                                }`}
                                            >
                                                {t(`myCourses.filter_${filter.toLowerCase()}`)}
                                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusFilter === filter ? 'bg-white/15 dark:bg-brand-navy/10' : 'bg-gray-100 dark:bg-white/10'}`}>
                                                    {filterCounts[filter]}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <p className="mt-3 px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                    {t('myCourses.results_count').replace('{shown}', String(visibleEnrollments.length)).replace('{total}', String(filterCounts.ALL))}
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        {visibleEnrollments.map((enrollment) => (
                            <article key={enrollment.id} className="grid min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:border-brand-gold/40 hover:shadow-md dark:border-white/10 dark:bg-brand-navy-dark sm:rounded-3xl lg:grid-cols-[minmax(0,1fr)_280px]">
                                <div className="min-w-0 p-4 sm:p-6">
                                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gold/10 text-brand-gold-dark dark:bg-brand-gold/15 dark:text-brand-gold-light">
                                                <BookOpen size={21} />
                                            </span>
                                            <div className="min-w-0">
                                                <h3 className="line-clamp-2 text-lg font-black text-brand-navy dark:text-white sm:text-xl">
                                                    <Link
                                                        href={enrollment.status === 'APPROVED'
                                                            ? `/dashboard/courses/${enrollment.course.id}/player`
                                                            : `/courses/${enrollment.course.id}`}
                                                        className="transition-colors hover:text-brand-gold-dark dark:hover:text-brand-gold-light"
                                                    >
                                                        {pick(enrollment.course, 'title')}
                                                    </Link>
                                                </h3>
                                                {pick(enrollment.opening, 'name') && (
                                                    <p className="mt-1 truncate text-sm font-semibold text-gray-500 dark:text-gray-400">
                                                        {pick(enrollment.opening, 'name')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
                                                hasCompletedLearning(enrollment) ? 'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300' :
                                                hasEndedBatch(enrollment) ? 'border-gray-500/20 bg-gray-500/10 text-gray-700 dark:text-gray-300' :
                                                enrollment.status === 'APPROVED' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                                                enrollment.status === 'REJECTED' ? 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300' :
                                                enrollment.status === 'RESERVED' ? 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300' :
                                                'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                            }`}>
                                                {hasCompletedLearning(enrollment) ? <Award size={13} /> :
                                                    hasEndedBatch(enrollment) ? <CalendarClock size={13} /> :
                                                    enrollment.status === 'APPROVED' ? <CheckCircle size={13} /> :
                                                        enrollment.status === 'REJECTED' ? <XCircle size={13} /> : <Clock size={13} />}
                                                {hasCompletedLearning(enrollment) ? t('statuses.completed') :
                                                    hasEndedBatch(enrollment) ? t('myCourses.filter_ended') : statusLabel(enrollment.status)}
                                            </span>
                                            {enrollment.opening?.status === 'ANNOUNCEMENT' && (
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-gold/40 bg-brand-gold/15 px-3 py-1.5 text-xs font-black text-brand-navy dark:text-brand-gold-light">
                                                    <CalendarClock size={13} />
                                                    {t('myCourses.announced_not_started')}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <p className="mb-4 line-clamp-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                                        {pick(enrollment.course, 'description') || t('myCourses.no_description')}
                                    </p>

                                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                                        {enrollment.opening?.price != null && (
                                            <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                                ${enrollment.opening.price}
                                            </span>
                                        )}
                                        <span>
                                            {t('myCourses.enrolled_on')}{' '}
                                            {new Date(enrollment.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US')}
                                        </span>
                                    </div>

                                    {enrollment.liveSessions?.length ? (
                                        <div className="mt-5 border-t border-gray-100 pt-4 dark:border-white/10">
                                            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-500 dark:text-gray-400">
                                                <Video size={14} className="text-brand-gold-dark dark:text-brand-gold-light" />
                                                {t('liveSessions.next_session')}
                                            </p>
                                            <StudentSessionList sessions={enrollment.liveSessions} limit={1} />
                                        </div>
                                    ) : enrollment.meetLink ? (
                                        <a
                                            href={enrollment.meetLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-5 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 transition hover:bg-emerald-500/10 dark:bg-emerald-500/10"
                                        >
                                            <span className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                                                <Video size={16} /> {t('myCourses.join_live')}
                                            </span>
                                            <span className="text-xs font-semibold text-emerald-700/70 dark:text-emerald-300/80">
                                                {t('myCourses.online_batch')}
                                            </span>
                                        </a>
                                    ) : null}

                                    {enrollment.status === 'REJECTED' && enrollment.financeOfficerNotes && (
                                        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                                            <strong>{t('myCourses.finance_note')}</strong> {enrollment.financeOfficerNotes}
                                        </div>
                                    )}
                                </div>

                                <aside className="flex min-w-0 flex-col gap-4 border-t border-gray-100 bg-gray-50/80 p-4 dark:border-white/10 dark:bg-white/[0.025] sm:p-6 lg:border-l lg:border-t-0">
                                    {enrollment.status === 'APPROVED' && enrollment.progressPercent != null && (
                                        <div>
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300">
                                                    <GraduationCap size={15} className="text-brand-gold-dark dark:text-brand-gold-light" />
                                                    {t('myCourses.progress')}
                                                </span>
                                                <span className="text-sm font-black tabular-nums text-brand-navy dark:text-white">
                                                    {enrollment.progressPercent}%
                                                </span>
                                            </div>
                                            <div
                                                className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
                                                role="progressbar"
                                                aria-valuenow={enrollment.progressPercent}
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                                aria-label={t('myCourses.progress')}
                                            >
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-brand-gold-dark to-brand-gold-light transition-all duration-500"
                                                    style={{ width: `${enrollment.progressPercent}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    {enrollment.status === 'APPROVED' && courseAvg(enrollment.course.id) != null && (
                                        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-brand-navy-dark">
                                            <span className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-300">
                                                <GraduationCap size={14} className="text-brand-gold-dark dark:text-brand-gold-light" />
                                                {t('myCourses.average_score')}
                                            </span>
                                            <span className="text-sm font-black text-brand-navy dark:text-white">{courseAvg(enrollment.course.id)}%</span>
                                        </div>
                                    )}
                                    <div className="mt-auto space-y-2 border-t border-gray-200 pt-4 dark:border-white/10">
                                        {hasCompletedLearning(enrollment) && enrollment.opening?.status === 'ENDED' ? (
                                            <>
                                                <Link href={`/dashboard/profile?tab=certificates&courseId=${enrollment.course.id}`} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-light px-4 py-3 text-sm font-black text-brand-navy-dark transition hover:shadow-md">
                                                    <Award size={15} /> {t('myCourses.view_certificate')}
                                                </Link>
                                                <Link href="/dashboard/my-grades" className="flex w-full items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:border-brand-gold/50 dark:border-white/10 dark:text-white">
                                                    {t('myCourses.view_grades')}
                                                </Link>
                                            </>
                                        ) : hasCompletedLearning(enrollment) ? (
                                            <>
                                                <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-center text-xs font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                                                    {t('myCourses.learning_completed')}
                                                </p>
                                                <Link href="/dashboard/my-grades" className="flex w-full items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:border-brand-gold/50 dark:border-white/10 dark:text-white">
                                                    {t('myCourses.view_grades')}
                                                </Link>
                                            </>
                                        ) : enrollment.status === 'APPROVED' ? (
                                            <>
                                                <Link href={`/dashboard/courses/${enrollment.course.id}/player`} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-light px-4 py-3 text-sm font-black text-brand-navy-dark transition hover:shadow-md">
                                                    <BookOpen size={15} /> {t('myCourses.continue')}
                                                </Link>
                                                <Link href="/dashboard/my-grades" className="flex w-full items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:border-brand-gold/50 dark:border-white/10 dark:text-white">
                                                    {t('myCourses.view_grades')}
                                                </Link>
                                            </>
                                        ) : paymentDue(enrollment) ? (
                                            <Link href="/dashboard/payments" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-light px-4 py-3 text-sm font-black text-brand-navy-dark transition hover:shadow-md">
                                                <CreditCard size={15} /> {t('myCourses.pay_now')}
                                            </Link>
                                        ) : enrollment.status === 'RESERVED' ? (
                                            <p className="rounded-xl bg-sky-500/5 px-3 py-3 text-center text-xs font-semibold text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
                                                {t('myCourses.reserved_waiting')}
                                            </p>
                                        ) : (
                                            <p className="px-3 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">
                                                {t('myCourses.locked')}
                                            </p>
                                        )}
                                    </div>
                                </aside>
                            </article>
                        ))}
                        {filterCounts.ALL === 0 && !error && (
                            <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400 font-semibold text-lg border-2 border-dashed border-gray-300 dark:border-white/10 rounded-xl bg-gray-100/50 dark:bg-transparent">
                                {t('myCourses.empty_title')}
                                <div className="mt-4">
                                    <Link href="/courses" className="text-brand-gold-dark dark:text-brand-gold-light hover:underline">{t('landing.explore_courses')}</Link>
                                </div>
                            </div>
                        )}
                        {filterCounts.ALL > 0 && visibleEnrollments.length === 0 && (
                            <div className="col-span-full rounded-2xl border-2 border-dashed border-gray-300 py-12 text-center dark:border-white/10">
                                <SlidersHorizontal size={28} className="mx-auto mb-3 text-gray-400" />
                                <p className="font-bold text-gray-600 dark:text-gray-300">{t('myCourses.no_results')}</p>
                                <button
                                    type="button"
                                    onClick={() => { setSearchQuery(''); setStatusFilter('ALL'); }}
                                    className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-brand-gold-dark hover:underline dark:text-brand-gold-light"
                                >
                                    <X size={14} /> {t('myCourses.clear_filters')}
                                </button>
                            </div>
                        )}
                    </div>
                    </>
                )}
            </div>
        </ProtectedRoute>
    );
}
