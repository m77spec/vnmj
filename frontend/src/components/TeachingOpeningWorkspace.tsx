"use client";

import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import RosterGrades from '@/components/RosterGrades';
import TasksPanel from '@/components/TasksPanel';
import CourseChat from '@/components/CourseChat';
import LessonExplorer from '@/components/LessonExplorer';
import InstructorAnnouncements from '@/components/InstructorAnnouncements';
import AcademicCalendar from '@/components/AcademicCalendar';
import LiveSessionManager from '@/components/LiveSessionManager';
import InstructorQuizManager from '@/components/InstructorQuizManager';
import { Settings2, ClipboardList, MessagesSquare, BarChart3, Flag, Users, BookOpen, Hash, ArrowLeft, Megaphone, Calendar, Video, Pencil, Loader } from 'lucide-react';
import OpeningContentEditor from '@/components/OpeningContentEditor';

interface MyOpening {
    id: string;
    instructorId: string;
    nameAr?: string | null;
    nameEn?: string | null;
    status: string;
    course: { id: string; titleAr?: string | null; titleEn?: string | null; contentType?: string | null };
    access: {
        canReadContent: boolean;
        canManageTasks: boolean;
        canGrade: boolean;
        canManageSessions: boolean;
        canManageAnnouncements: boolean;
        canViewAnalytics: boolean;
        isPrimaryInstructor: boolean;
    };
}

interface RosterData {
    enrollments: { id: string }[];
}

interface TaskData {
    id: string;
}

interface ModuleData {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    chapterId?: string | null;
    chapterOrderIndex?: number | null;
    orderIndex?: number | null;
    createdAt?: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    videoUrl?: string | null;
    durationMinutes?: number | null;
    outcomes?: { descriptionAr?: string | null; descriptionEn?: string | null }[];
    files?: { url: string; nameAr?: string | null; nameEn?: string | null }[] | null;
    links?: { url: string; labelAr?: string | null; labelEn?: string | null }[] | null;
}

interface OpeningAnalyticsReport {
    id: string;
    approvedStudentCount: number;
    attendanceRate: number | null;
    taskSubmissionRate: number | null;
    needsFollowUpCount: number;
}

interface InstructorAnalyticsData {
    openingReports: OpeningAnalyticsReport[];
}

interface SyllabusData {
    chapters?: {
        id: string;
        titleAr?: string | null;
        titleEn?: string | null;
        orderIndex?: number | null;
        createdAt?: string;
        modules?: ModuleData[] | null;
    }[] | null;
}

type Tab = 'roster' | 'tasks' | 'announcements' | 'calendar' | 'sessions' | 'content' | 'quizzes' | 'chat' | 'analytics';

const VALID_TABS: Tab[] = ['roster', 'tasks', 'announcements', 'calendar', 'sessions', 'content', 'quizzes', 'chat', 'analytics'];

const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
    ANNOUNCEMENT: 'bg-brand-navy-light/10 text-brand-navy-light border border-brand-navy-light/20',
    OPEN: 'bg-green-500/10 text-green-400 border border-green-500/20',
    STARTED: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    ENDED: 'bg-gray-500/10 text-gray-500 border border-gray-500/20',
};
const statusLabelsAr: Record<string, string> = {
    DRAFT: 'مسودة', ANNOUNCEMENT: 'إعلان', OPEN: 'مفتوح', STARTED: 'قيد التنفيذ', ENDED: 'منتهي',
};
const statusLabelsEn: Record<string, string> = {
    DRAFT: 'Draft', ANNOUNCEMENT: 'Announcement', OPEN: 'Open', STARTED: 'Started', ENDED: 'Ended',
};

export default function TeachingOpeningWorkspace() {
    const { openingId } = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const { t, pick, locale } = useI18n();
    const { user } = useAuth();
    const isAr = locale === 'ar';
    const isAdministrative = user?.role === 'ADMIN' || user?.role === 'COURSE_MANAGER';

    const urlTab = searchParams?.get('tab') as Tab | null;
    const [lastTab, setLastTab] = useState<Tab>(urlTab && VALID_TABS.includes(urlTab) ? urlTab : 'roster');
    const [editingOpeningContent, setEditingOpeningContent] = useState(false);
    const requestedTab: Tab = urlTab && VALID_TABS.includes(urlTab) ? urlTab : lastTab;

    const setTab = (key: Tab) => {
        setLastTab(key);
        router.push(`${pathname}?tab=${key}`, { scroll: false });
    };

    const { data: openings, loading: openingsLoading, error: openingsError, refetch: refetchOpenings } = useFetchData<MyOpening[]>('/openings/mine');
    const opening = (openings || []).find((o) => o.id === openingId);
    const { data: rosterData } = useFetchData<RosterData>(
        opening?.access.canGrade ? `/openings/${openingId}/roster` : null,
    );
    const { data: tasksData } = useFetchData<TaskData[]>(
        opening?.access.canManageTasks || opening?.access.canGrade ? `/tasks/opening/${openingId}` : null,
    );
    const { data: modulesData } = useFetchData<ModuleData[]>(
        opening?.access.canReadContent ? `/openings/${openingId}/modules` : null,
    );
    const { data: analyticsData } = useFetchData<InstructorAnalyticsData>(
        !isAdministrative && opening?.access.canViewAnalytics ? '/analytics/instructor-dashboard' : null,
    );
    const openingReport = analyticsData?.openingReports.find((report) => report.id === openingId);
    // A recorded course has no meeting schedule to manage: the tab is hidden, and
    // a direct ?tab=sessions link must not resurrect what the button cannot open.
    const isRecorded = opening?.course.contentType === 'RECORDED';
    const canManageOpeningContent = !!opening?.access.canReadContent && ['OPEN', 'STARTED'].includes(opening.status);
    const canManageQuizzes = canManageOpeningContent;
    const availableTabs: Tab[] = opening ? [
        ...(opening.access.canGrade ? ['roster' as const] : []),
        ...(opening.access.canManageTasks || opening.access.canGrade ? ['tasks' as const] : []),
        ...(opening.access.canManageAnnouncements ? ['announcements' as const] : []),
        ...(opening.access.isPrimaryInstructor ? ['calendar' as const] : []),
        ...(!isAdministrative && opening.access.isPrimaryInstructor ? ['chat' as const] : []),
        ...(!isRecorded && opening.access.canManageSessions ? ['sessions' as const] : []),
        ...(opening.access.canReadContent ? ['content' as const] : []),
        ...(canManageQuizzes ? ['quizzes' as const] : []),
        ...(!isAdministrative && opening.access.canViewAnalytics ? ['analytics' as const] : []),
    ] : [];
    const tab: Tab = availableTabs.includes(requestedTab)
        ? requestedTab
        : (availableTabs[0] ?? 'roster');
    const tabLabel = (key: Tab) => ({
        roster: isAr ? 'الطلاب والدرجات' : 'Roster',
        tasks: t('tasks.tasks_title'),
        announcements: isAr ? 'الإعلانات' : 'Announcements',
        calendar: isAr ? 'التقويم' : 'Calendar',
        sessions: isAr ? 'الجلسات' : 'Sessions',
        content: isAr ? 'المحتوى' : 'Content',
        quizzes: isAr ? 'الاختبارات' : 'Quizzes',
        chat: isAr ? 'الدردشة' : 'Chat',
        analytics: isAr ? 'الإحصائيات' : 'Analytics',
    })[key];

    const { data: syllabusData } = useFetchData<SyllabusData>(
        opening?.access.canReadContent ? `/lms/courses/${opening.course.id}/syllabus` : null,
    );
    const quizLessons = useMemo(() => {
        const chapters = [...(syllabusData?.chapters || [])].sort(
            (left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0)
                || (left.createdAt || '').localeCompare(right.createdAt || '')
                || left.id.localeCompare(right.id),
        );
        const chapterOrder = new Map(chapters.map((chapter, index) => [chapter.id, index + 1]));
        const uniqueLessons = new Map<string, ModuleData>();
        const sourceLessons = modulesData
            ?? chapters.flatMap((chapter) => chapter.modules || []);
        const lessonKey = (lesson: ModuleData) => [
            lesson.orderIndex ?? 0,
            (lesson.titleAr || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
            (lesson.titleEn || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
        ].join('|');
        const chapterLessonKeys = new Set(
            sourceLessons.filter((lesson) => lesson.chapterId).map(lessonKey),
        );
        const seenLessonKeys = new Set<string>();

        for (const lesson of sourceLessons) {
            const key = lessonKey(lesson);
            // Replacing a course's chapters can leave the old chapter lessons
            // detached while creating their replacements under the new chapters.
            if (!lesson.chapterId && chapterLessonKeys.has(key)) continue;
            const structuralKey = `${lesson.chapterId || 'root'}|${key}`;
            if (seenLessonKeys.has(structuralKey)) continue;
            seenLessonKeys.add(structuralKey);
            const chapterIndex = lesson.chapterId ? chapterOrder.get(lesson.chapterId) : undefined;
            uniqueLessons.set(lesson.id, {
                ...uniqueLessons.get(lesson.id),
                ...lesson,
                chapterOrderIndex: chapterIndex ?? lesson.chapterOrderIndex ?? null,
            });
        }

        return [...uniqueLessons.values()].sort((left, right) => {
            const leftChapter = left.chapterOrderIndex ?? 0;
            const rightChapter = right.chapterOrderIndex ?? 0;
            return leftChapter - rightChapter
                || (left.orderIndex ?? 0) - (right.orderIndex ?? 0)
                || (left.createdAt || '').localeCompare(right.createdAt || '')
                || (left.titleAr || left.titleEn || '').localeCompare(right.titleAr || right.titleEn || '')
                || left.id.localeCompare(right.id);
        });
    }, [modulesData, syllabusData]);

    const studentCount = rosterData?.enrollments?.length;
    const taskCount = Array.isArray(tasksData) ? tasksData.length : null;
    const statusLabel = opening
        ? ((isAr ? statusLabelsAr[opening.status] : statusLabelsEn[opening.status]) ?? opening.status)
        : null;

    const statusBadge = (status: string) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${statusColors[status] || statusColors.DRAFT}`}>
            {isAr ? (statusLabelsAr[status] ?? status) : (statusLabelsEn[status] ?? status)}
        </span>
    );

    const tabBtn = (key: Tab, icon: React.ReactNode, label: string) => (
        <button
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer whitespace-nowrap ${
                tab === key
                    ? 'bg-brand-gold/10 text-brand-gold-light border border-brand-gold/20'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
        >
            {icon}
            {label}
        </button>
    );

    const statPill = (icon: React.ReactNode, value: string | number | null | undefined, label: string) => (
        <div className="inline-flex items-center gap-3 bg-brand-navy-dark border border-white/5 rounded-xl px-4 py-2.5">
            <div className="text-brand-gold-light">{icon}</div>
            <div>
                <p className="text-white font-black text-sm leading-tight">{value ?? '—'}</p>
                <p className="text-gray-400 text-xs">{label}</p>
            </div>
        </div>
    );

    return (
        <ProtectedRoute allowedRoles={['INSTRUCTOR', 'ADMIN', 'COURSE_MANAGER']}>
            <div className="min-w-0 bg-gray-50 dark:bg-brand-navy-dark animate-fade-in space-y-5 sm:space-y-6 p-2 sm:p-4 lg:p-8">
                <Link
                    href={isAdministrative ? `/dashboard/admin/openings/${openingId}` : '/dashboard/teaching'}
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-400 hover:text-white transition mb-2"
                >
                    <ArrowLeft size={16} /> {isAdministrative
                        ? (isAr ? 'العودة إلى متابعة الدفعة' : 'Back to batch oversight')
                        : (isAr ? 'العودة لمركز التدريس' : 'Back to Teaching Hub')}
                </Link>

                {openingsLoading ? (
                    <div role="status" className="flex items-center justify-center gap-3 rounded-2xl border border-white/5 bg-brand-navy-dark p-10 text-gray-300">
                        <Loader className="animate-spin text-brand-gold-light" size={22} />
                        {isAr ? 'جارٍ تحميل مساحة التدريس...' : 'Loading teaching workspace...'}
                    </div>
                ) : openingsError ? (
                    <div role="alert" className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-300">
                        <p>{openingsError}</p>
                        <button
                            type="button"
                            onClick={() => void refetchOpenings()}
                            className="rounded-xl bg-red-500/15 px-4 py-2 text-sm font-bold hover:bg-red-500/25"
                        >
                            {isAr ? 'إعادة المحاولة' : 'Try again'}
                        </button>
                    </div>
                ) : !opening ? (
                    <div role="alert" className="space-y-4 rounded-2xl border border-white/5 bg-brand-navy-dark p-5 text-gray-300">
                        <p>{isAr ? 'لم نعثر على هذه الدفعة أو لا تملك صلاحية الوصول إليها.' : 'This opening was not found or you do not have access to it.'}</p>
                        <Link href={isAdministrative ? '/dashboard/admin/openings' : '/dashboard/teaching'} className="inline-flex rounded-xl bg-brand-gold/10 px-4 py-2 text-sm font-bold text-brand-gold-light hover:bg-brand-gold/20">
                            {isAdministrative
                                ? (isAr ? 'العودة إلى إدارة الدفعات' : 'Back to opening management')
                                : (isAr ? 'العودة إلى مركز التدريس' : 'Back to Teaching Hub')}
                        </Link>
                    </div>
                ) : isAdministrative && !['OPEN', 'STARTED'].includes(opening.status) ? (
                    <div role="alert" className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-amber-200">
                        <p>{isAr ? 'إدارة المحتوى متاحة للدفعات المفتوحة أو قيد التنفيذ فقط.' : 'Content management is available only for open or in-progress batches.'}</p>
                        <Link href={`/dashboard/admin/openings/${openingId}`} className="inline-flex rounded-xl bg-amber-500/15 px-4 py-2 text-sm font-bold hover:bg-amber-500/25">
                            {isAr ? 'العودة إلى متابعة الدفعة' : 'Back to batch oversight'}
                        </Link>
                    </div>
                ) : (
                    <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="min-w-0 break-words text-xl sm:text-2xl font-black text-white tracking-tight">
                                {isAdministrative
                                    ? (isAr ? 'إدارة الدفعة' : 'Batch management')
                                    : (pick(opening, 'name') || t('manageCourses.opening_default'))}
                            </h2>
                            {opening && statusBadge(opening.status)}
                        </div>
                        <p className="text-gray-400 text-sm mt-0.5 flex items-center gap-1.5">
                            <BookOpen size={13} className="text-gray-500" />
                            {opening ? pick(opening.course, 'title') : '...'}
                        </p>
                    </div>
                    {opening?.access.isPrimaryInstructor && !isAdministrative && (
                        <a
                            href={`/dashboard/teaching?close=${openingId}`}
                            className="inline-flex items-center gap-2 text-sm font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-2.5 rounded-xl hover:bg-red-500 hover:text-white transition"
                        >
                            <Flag size={15} /> {t('teaching.request_close_btn')}
                        </a>
                    )}
                    {tab === 'quizzes' && opening && canManageQuizzes && (
                        <InstructorQuizManager
                            openingId={opening.id}
                            courseId={opening.course.id}
                            lessons={quizLessons}
                            administrative={isAdministrative}
                        />
                    )}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {statPill(<Users size={16} />, studentCount, isAr ? 'طالب' : 'Students')}
                    {statPill(<ClipboardList size={16} />, taskCount, isAr ? 'مهمة' : 'Tasks')}
                    {statPill(<Hash size={16} />, statusLabel, isAr ? 'الحالة' : 'Status')}
                </div>

                <label className="block md:hidden">
                    <span className="mb-2 block text-xs font-bold text-gray-400">
                        {isAr ? 'انتقل إلى قسم الدفعة' : 'Go to batch section'}
                    </span>
                    <select
                        value={tab}
                        onChange={(event) => {
                            const nextTab = availableTabs.find((item) => item === event.target.value);
                            if (nextTab) setTab(nextTab);
                        }}
                        className="w-full rounded-xl border border-white/10 bg-brand-navy-dark px-4 py-3 text-sm font-bold text-white outline-none focus:border-brand-gold/50 focus:ring-2 focus:ring-brand-gold/20 [&>option]:bg-brand-navy"
                    >
                        {availableTabs.map((item) => (
                            <option key={item} value={item}>{tabLabel(item)}</option>
                        ))}
                    </select>
                </label>

                <div className="hidden min-w-0 w-full items-center gap-1 overflow-x-auto rounded-2xl border border-white/5 bg-brand-navy-dark p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex">
                    {availableTabs.includes('roster') && tabBtn('roster', <Settings2 size={16} />, isAr ? 'الطلاب والدرجات' : 'Roster')}
                    {availableTabs.includes('tasks') && tabBtn('tasks', <ClipboardList size={16} />, t('tasks.tasks_title'))}
                    {availableTabs.includes('announcements') && tabBtn('announcements', <Megaphone size={16} />, isAr ? 'الإعلانات' : 'Announcements')}
                    {availableTabs.includes('calendar') && tabBtn('calendar', <Calendar size={16} />, isAr ? 'التقويم' : 'Calendar')}
                    {/* A pre-recorded course has no meetings to schedule, so the
                        tab is not offered at all rather than shown empty. */}
                    {availableTabs.includes('sessions') && tabBtn('sessions', <Video size={16} />, isAr ? 'الجلسات' : 'Sessions')}
                    {availableTabs.includes('content') && tabBtn('content', <BookOpen size={16} />, isAr ? 'المحتوى' : 'Content')}
                    {availableTabs.includes('quizzes') && tabBtn('quizzes', <ClipboardList size={16} />, isAr ? 'الاختبارات' : 'Quizzes')}
                    {availableTabs.includes('chat') && tabBtn('chat', <MessagesSquare size={16} />, isAr ? 'الدردشة' : 'Chat')}
                    {availableTabs.includes('analytics') && tabBtn('analytics', <BarChart3 size={16} />, isAr ? 'الإحصائيات' : 'Analytics')}
                </div>

                {tab === 'roster' && !!openingId && <RosterGrades openingId={String(openingId)} />}
                {tab === 'tasks' && !!openingId && opening && (
                    <TasksPanel
                        openingId={String(openingId)}
                        canManageTasks={opening.access.canManageTasks}
                        canGrade={opening.access.canGrade}
                    />
                )}
                {tab === 'announcements' && !!openingId && <InstructorAnnouncements openingId={String(openingId)} />}
                {tab === 'calendar' && !!openingId && (
                    <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-4 sm:p-6">
                        <AcademicCalendar openingId={String(openingId)} />
                    </div>
                )}
                {tab === 'sessions' && !isRecorded && !!openingId && (
                    <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-6">
                        <LiveSessionManager openingId={String(openingId)} />
                    </div>
                )}
                {tab === 'content' && opening && !!openingId && (
                    <div className="space-y-4">
                        {canManageOpeningContent && (
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => setEditingOpeningContent((current) => !current)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/30 bg-brand-navy-dark px-4 py-2.5 text-sm font-bold text-brand-gold-light hover:bg-brand-gold/10"
                                >
                                    <Pencil size={15} />
                                    {editingOpeningContent
                                        ? (isAr ? 'العودة لمحتوى الدروس والواجبات' : 'Back to lessons and tasks')
                                        : (isAr ? 'تعديل محتوى هذه الدفعة' : 'Edit this batch content')}
                                </button>
                            </div>
                        )}
                        {editingOpeningContent && canManageOpeningContent
                            ? <OpeningContentEditor openingId={opening.id} />
                            : <LessonExplorer
                                courseId={opening.course.id}
                                modules={modulesData || []}
                                chapters={syllabusData?.chapters}
                                openingId={String(openingId)}
                                mode="instructor"
                            />}
                    </div>
                )}
                {tab === 'chat' && opening && !isAdministrative && (
                    <div className="bg-brand-navy-dark border border-white/5 rounded-2xl p-6">
                        <CourseChat courseId={opening.course.id} />
                    </div>
                )}
                {tab === 'analytics' && opening && (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        <div className="min-w-0 bg-brand-navy-dark border border-white/5 rounded-2xl p-3 sm:p-6">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center">
                                    <Users size={20} className="text-brand-gold-light" />
                                </div>
                                <p className="text-gray-400 text-xs sm:text-sm font-bold">{isAr ? 'إجمالي الطلاب' : 'Total Students'}</p>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-white">{openingReport?.approvedStudentCount ?? '—'}</p>
                        </div>
                        <div className="min-w-0 bg-brand-navy-dark border border-white/5 rounded-2xl p-3 sm:p-6">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center">
                                    <ClipboardList size={20} className="text-brand-gold-light" />
                                </div>
                                <p className="text-gray-400 text-xs sm:text-sm font-bold">{isAr ? 'نسبة الحضور' : 'Attendance rate'}</p>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-white">
                                {openingReport?.attendanceRate == null ? '—' : `${openingReport.attendanceRate}%`}
                            </p>
                        </div>
                        <div className="min-w-0 bg-brand-navy-dark border border-white/5 rounded-2xl p-3 sm:p-6">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center">
                                    <BookOpen size={20} className="text-brand-gold-light" />
                                </div>
                                <p className="text-gray-400 text-xs sm:text-sm font-bold">{isAr ? 'تسليم الواجبات' : 'Task submissions'}</p>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-white">
                                {openingReport?.taskSubmissionRate == null ? '—' : `${openingReport.taskSubmissionRate}%`}
                            </p>
                        </div>
                        <div className="min-w-0 bg-brand-navy-dark border border-white/5 rounded-2xl p-3 sm:p-6">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center">
                                    <Hash size={20} className="text-brand-gold-light" />
                                </div>
                                <p className="text-gray-400 text-xs sm:text-sm font-bold">{isAr ? 'يحتاجون متابعة' : 'Need follow-up'}</p>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-white">{openingReport?.needsFollowUpCount ?? '—'}</p>
                        </div>
                    </div>
                )}
                    </>
                )}
            </div>
        </ProtectedRoute>
    );
}
