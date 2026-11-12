"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ArrowLeft,
    BookOpen,
    CheckCircle2,
    ClipboardCheck,
    ExternalLink,
    FileText,
    GraduationCap,
    RefreshCw,
    Search,
    Star,
    Users,
    Video,
} from 'lucide-react';
import { api, API_BASE_URL, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { PageHeader, StatCard } from '../../components';

type Person = { id: string; email: string; name?: string; role?: string; metadata?: Record<string, unknown> | null };
type ActivityRow = {
    id: string;
    type: string;
    action: string;
    createdAt: string;
    actor: Person | null;
    details: Record<string, unknown>;
};
type Resource = { url: string; nameAr?: string | null; nameEn?: string | null; labelAr?: string | null; labelEn?: string | null };
type Oversight = {
    opening: {
        id: string;
        nameAr?: string | null;
        nameEn?: string | null;
        status: string;
        startDate?: string | null;
        endDate?: string | null;
        course: { titleAr: string; titleEn: string };
        instructor: Person;
    };
    summary: {
        studentCount: number;
        approvedStudentCount: number;
        lessonCount: number;
        taskCount: number;
        quizCount: number;
        submissionCount: number;
        quizAttemptCount: number;
        evaluationCount: number;
    };
    students: Array<{
        id: string;
        email: string;
        name: string;
        status: string;
        enrolledAt: string;
        completedLessons: number;
        submissions: number;
        quizAttempts: number;
        evaluated: boolean;
    }>;
    content: Array<{
        id: string;
        titleAr: string;
        titleEn: string;
        isHidden: boolean;
        updatedAt: string;
        videoUrl?: string | null;
        files: Resource[];
        links: Resource[];
    }>;
    tasks: Array<{
        id: string;
        titleAr: string;
        titleEn: string;
        dueDate?: string | null;
        attachmentUrl?: string | null;
        attachmentType?: string | null;
        _count: { submissions: number };
        submissions: Array<{
            id: string;
            submittedAt: string;
            updatedAt: string;
            content?: string | null;
            attachmentUrl?: string | null;
            attachmentName?: string | null;
            attachmentType?: string | null;
            score?: number | null;
            notes?: string | null;
            enrollment: { student: Person };
        }>;
    }>;
    quizzes: Array<{
        id: string;
        titleAr: string;
        titleEn: string;
        isPublished: boolean;
        isFinal: boolean;
        _count: { questions: number; attempts: number };
        questions: Array<{ id: string; type: string; textAr: string; textEn: string }>;
        attempts: Array<{
            id: string;
            score: number;
            passed: boolean;
            submittedAt: string;
            enrollment: { student: Person };
        }>;
    }>;
    evaluations: Array<{
        id: string;
        courseRating: number;
        instructorRating: number;
        commentAr?: string | null;
        commentEn?: string | null;
        createdAt: string;
        enrollment: { student: Person };
    }>;
    activity: ActivityRow[];
    activityTruncated: boolean;
};

type Tab = 'overview' | 'content' | 'students' | 'teacher';

function displayDate(value: string | null | undefined, locale: string) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function personName(person: Person) {
    if (person.name) return person.name;
    for (const key of ['nameAr', 'nameEn', 'fullName']) {
        const value = person.metadata?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return person.email;
}

function fileHref(value: string | null | undefined) {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/uploads/')) return `${API_BASE_URL}${value}`;
    return null;
}

export default function OpeningOversightPage() {
    const params = useParams<{ openingId: string }>();
    const openingId = params.openingId;
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [data, setData] = useState<Oversight | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [tab, setTab] = useState<Tab>('overview');
    const [query, setQuery] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        let active = true;
        api.get(`/openings/${openingId}/oversight`)
            .then((response) => {
                if (active) setData(response.data as Oversight);
            })
            .catch((cause) => {
                if (active) {
                    setError(true);
                    setData(null);
                    setErrorMessage(getErrorMessage(cause));
                    console.error('Failed to load opening oversight', cause);
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [openingId, refreshKey]);

    const searchTerm = query.trim().toLocaleLowerCase();
    const students = useMemo(() => (data?.students ?? []).filter((student) =>
        !searchTerm || student.name.toLocaleLowerCase().includes(searchTerm) || student.email.toLocaleLowerCase().includes(searchTerm),
    ), [data?.students, searchTerm]);
    const studentActivity = useMemo(() => (data?.activity ?? []).filter((row) =>
        row.actor?.role === 'STUDENT' &&
        (!searchTerm || (row.actor.name ?? '').toLocaleLowerCase().includes(searchTerm) || row.actor.email.toLocaleLowerCase().includes(searchTerm) || row.action.toLocaleLowerCase().includes(searchTerm)),
    ), [data?.activity, searchTerm]);
    const teacherActivity = useMemo(() => (data?.activity ?? []).filter((row) =>
        row.actor?.role !== 'STUDENT' &&
        (!searchTerm || (row.actor?.name ?? '').toLocaleLowerCase().includes(searchTerm) || (row.actor?.email ?? '').toLocaleLowerCase().includes(searchTerm) || row.action.toLocaleLowerCase().includes(searchTerm)),
    ), [data?.activity, searchTerm]);

    const title = data?.opening.nameAr || data?.opening.nameEn ||
        (isAr ? data?.opening.course.titleAr : data?.opening.course.titleEn);
    const openingStatus = data?.opening.status === 'STARTED'
        ? (isAr ? 'قيد التنفيذ' : 'In progress')
        : data?.opening.status === 'OPEN'
            ? (isAr ? 'مفتوحة' : 'Open')
            : data?.opening.status === 'ENDED'
                ? (isAr ? 'منتهية' : 'Ended')
                : data?.opening.status === 'ANNOUNCEMENT'
                    ? (isAr ? 'إعلان' : 'Announced')
                    : (isAr ? 'مسودة' : 'Draft');
    const tabs: { key: Tab; label: string }[] = [
        { key: 'overview', label: isAr ? 'نظرة عامة' : 'Overview' },
        { key: 'content', label: isAr ? 'المحتوى والملفات' : 'Content & files' },
        { key: 'students', label: isAr ? 'نشاط الطلاب' : 'Student activity' },
        { key: 'teacher', label: isAr ? 'عمليات المدرّس' : 'Instructor actions' },
    ];

    const eventLabel = (row: ActivityRow) => {
        const details = row.details;
        switch (row.type) {
            case 'instructor_change':
                if (row.action === 'lesson_created') return isAr ? 'أضاف درسًا للدفعة' : 'Added a lesson to this batch';
                if (row.action === 'lesson_updated') return isAr ? 'عدّل محتوى درس' : 'Updated lesson content';
                if (row.action === 'quiz_created') return isAr ? 'أنشأ اختبارًا' : 'Created a quiz';
                if (row.action === 'quiz_updated') return isAr ? 'عدّل اختبارًا' : 'Updated a quiz';
                if (row.action === 'quiz_deleted') return isAr ? 'حذف اختبارًا' : 'Deleted a quiz';
                if (row.action === 'task_created') return isAr ? 'أنشأ واجبًا' : 'Created an assignment';
                if (row.action === 'task_updated') return isAr ? 'عدّل واجبًا' : 'Updated an assignment';
                if (row.action === 'task_deleted') return isAr ? 'حذف واجبًا' : 'Deleted an assignment';
                if (row.action === 'submission_graded') return isAr ? 'صحّح تسليم طالب' : 'Graded a student submission';
                return isAr ? 'عملية على محتوى الدورة' : 'Course content action';
            case 'task_submission': return isAr ? 'سلّم واجبًا' : 'Submitted an assignment';
            case 'quiz_attempt': return isAr ? 'حلّ اختبارًا' : 'Completed a quiz';
            case 'student_action': return isAr ? 'نشاط للطالب' : 'Student activity';
            case 'course_evaluation': return isAr ? 'أرسل تقييم نهاية الدورة' : 'Submitted the course evaluation';
            case 'lesson_completed': return isAr ? 'أكمل درسًا' : 'Completed a lesson';
            case 'enrollment': return isAr ? `تسجيل في الدفعة (${String(details.status ?? '')})` : `Enrollment (${String(details.status ?? '')})`;
            case 'legacy_activity': return row.action;
            default: return row.action;
        }
    };

    const detailTitle = (row: ActivityRow) => {
        const details = row.details;
        const ar = (key: string) => typeof details[key] === 'string' ? String(details[key]) : '';
        const en = (keyAr: string, keyEn: string) => (isAr ? ar(keyAr) : ar(keyEn)) || ar(keyAr) || ar(keyEn);
        if (row.type === 'task_submission') return en('taskTitleAr', 'taskTitleEn');
        if (row.type === 'quiz_attempt') return en('quizTitleAr', 'quizTitleEn');
        if (row.type === 'lesson_completed') return en('lessonTitleAr', 'lessonTitleEn');
        return en('titleAr', 'titleEn') || en('quizTitleAr', 'quizTitleEn') || en('taskTitleAr', 'taskTitleEn');
    };

    const refresh = () => {
        setLoading(true);
        setError(false);
        setErrorMessage('');
        setRefreshKey((value) => value + 1);
    };

    const openFile = (url?: string | null, label?: string | null) => {
        const href = fileHref(url);
        if (!href) return null;
        return (
            <a key={`${href}-${label ?? ''}`} href={href} target="_blank" rel="noreferrer"
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-brand-navy hover:border-brand-gold hover:text-brand-gold-dark dark:border-white/10 dark:text-white">
                <FileText size={15} className="shrink-0" />
                <span className="truncate">{label || (isAr ? 'عرض الملف' : 'Open file')}</span>
                <ExternalLink size={13} className="shrink-0" />
            </a>
        );
    };

    const activityCard = (row: ActivityRow) => (
        <article key={row.id} className="flex gap-3 rounded-xl border border-gray-100 bg-white p-4 dark:border-white/5 dark:bg-brand-navy-dark">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                row.actor?.role === 'STUDENT' ? 'bg-blue-500/10 text-blue-600' : 'bg-brand-gold/10 text-brand-gold-dark'
            }`}>
                {row.type === 'quiz_attempt' ? <ClipboardCheck size={17} /> : row.type === 'lesson_completed' ? <CheckCircle2 size={17} /> : <Activity size={17} />}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-bold text-brand-navy dark:text-white">{row.actor?.name || row.actor?.email || (isAr ? 'النظام' : 'System')}</p>
                    <time className="text-xs text-gray-400">{displayDate(row.createdAt, locale)}</time>
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{eventLabel(row)}</p>
                {detailTitle(row) && <p className="mt-1 text-sm font-bold text-gray-800 dark:text-gray-100">{detailTitle(row)}</p>}
                {row.type === 'task_submission' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {openFile(String(row.details.attachmentUrl ?? ''), String(row.details.attachmentName ?? ''))}
                        {typeof row.details.score === 'number' && (
                            <span className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-black text-emerald-700 dark:text-emerald-300">
                                {row.details.score} / {String(row.details.maxScore ?? 100)}
                            </span>
                        )}
                    </div>
                )}
                {row.type === 'quiz_attempt' && (
                    <p className="mt-2 text-sm font-black text-brand-navy dark:text-white">
                        {isAr ? 'النتيجة' : 'Score'}: {String(row.details.score ?? 0)}% · {row.details.passed ? (isAr ? 'ناجح' : 'Passed') : (isAr ? 'لم يجتز' : 'Not passed')}
                    </p>
                )}
                {row.type === 'course_evaluation' && (
                    <div className="mt-2 space-y-1 text-sm">
                        <p className="flex items-center gap-1 font-bold text-amber-600">
                            <Star size={14} /> {isAr ? 'الدورة' : 'Course'}: {String(row.details.courseRating ?? '—')} / 5 · {isAr ? 'المدرّس' : 'Instructor'}: {String(row.details.instructorRating ?? '—')} / 5
                        </p>
                        {Boolean(row.details.commentAr || row.details.commentEn) && (
                            <p className="rounded-lg bg-gray-50 p-3 text-gray-600 dark:bg-white/5 dark:text-gray-300">
                                {String((isAr ? row.details.commentAr : row.details.commentEn) || row.details.commentAr || row.details.commentEn)}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </article>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Link href="/dashboard/admin/openings" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-brand-gold-dark dark:text-gray-400">
                        <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} />
                        {isAr ? 'العودة لإدارة الدورات المفتوحة' : 'Back to open courses'}
                    </Link>
                    <PageHeader
                        title={loading ? (isAr ? 'جارٍ تحميل إدارة الدفعة...' : 'Loading batch oversight...') : title || (isAr ? 'إدارة الدفعة' : 'Batch oversight')}
                        subtitle={data ? `${isAr ? data.opening.course.titleAr : data.opening.course.titleEn} · ${data.opening.instructor.name}` : (isAr ? 'متابعة محتوى الدفعة ونشاط المدرّس والطلاب' : 'Review batch content and instructor and student activity')}
                    />
                    {data && <span className="mt-2 inline-flex rounded-full bg-brand-gold/10 px-3 py-1 text-xs font-black text-brand-gold-dark dark:text-brand-gold-light">{openingStatus}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {data && ['OPEN', 'STARTED'].includes(data.opening.status) && (
                        <Link
                            href={`/dashboard/admin/openings/${openingId}/manage`}
                            className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-black text-brand-navy hover:bg-brand-gold-light"
                        >
                            <BookOpen size={16} />
                            {isAr ? 'إدارة محتوى الدفعة' : 'Manage batch'}
                        </Link>
                    )}
                    <button type="button" onClick={refresh} disabled={loading}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-brand-navy hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-white dark:hover:bg-white/5">
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        {isAr ? 'تحديث' : 'Refresh'}
                    </button>
                </div>
            </div>

            {loading && <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center font-bold text-gray-400 dark:border-white/5 dark:bg-brand-navy-dark">{isAr ? 'جارٍ تحميل بيانات الدفعة...' : 'Loading batch data...'}</div>}
            {!loading && error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-500/20 dark:bg-red-500/5">
                    <p className="font-bold text-red-700 dark:text-red-300">{isAr ? 'تعذر تحميل بيانات الدفعة.' : 'Could not load batch data.'}</p>
                    <button type="button" onClick={refresh} className="mt-3 font-black text-red-800 underline dark:text-red-200">{isAr ? 'إعادة المحاولة' : 'Try again'}</button>
                    <p className="mt-2 text-sm text-red-600 dark:text-red-300">{errorMessage || (isAr ? 'يرجى التحقق من صلاحياتك ثم المحاولة مجددًا.' : 'Check your access and try again.')}</p>
                </div>
            )}
            {!loading && data && (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <StatCard icon={Users} color="blue" value={`${data.summary.approvedStudentCount}/${data.summary.studentCount}`} label={isAr ? 'الطلاب المقبولون / المسجلون' : 'Approved / enrolled students'} />
                        <StatCard icon={BookOpen} color="green" value={data.summary.lessonCount} label={isAr ? 'الدروس في هذه الدفعة' : 'Lessons in this batch'} />
                        <StatCard icon={FileText} color="amber" value={`${data.summary.submissionCount} / ${data.summary.taskCount}`} label={isAr ? 'تسليمات / واجبات' : 'Submissions / assignments'} />
                        <StatCard icon={ClipboardCheck} color="purple" value={`${data.summary.quizAttemptCount} / ${data.summary.quizCount}`} label={isAr ? 'محاولات / اختبارات' : 'Attempts / quizzes'} />
                        <StatCard icon={Star} color="orange" value={data.summary.evaluationCount} label={isAr ? 'تقييمات نهاية الدورة' : 'Course evaluations'} />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-2" role="tablist">
                            {tabs.map((item) => (
                                <button key={item.key} type="button" role="tab" aria-selected={tab === item.key}
                                    onClick={() => setTab(item.key)}
                                    className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${
                                        tab === item.key ? 'bg-brand-navy text-white dark:bg-brand-gold dark:text-brand-navy' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-brand-navy-dark dark:text-gray-300'
                                    }`}>
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        {(tab === 'students' || tab === 'teacher') && (
                            <label className="flex min-w-[220px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-brand-navy-dark">
                                <Search size={16} className="text-gray-400" />
                                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isAr ? 'بحث بالاسم أو البريد' : 'Search by name or email'} className="w-full bg-transparent text-sm outline-none dark:text-white" />
                            </label>
                        )}
                    </div>

                    {tab === 'overview' && (
                        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
                            <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-white/5 dark:bg-brand-navy-dark">
                                <div className="border-b border-gray-100 p-4 dark:border-white/5">
                                    <h2 className="flex items-center gap-2 font-black text-brand-navy dark:text-white"><Users size={18} /> {isAr ? 'ملخص الطلاب' : 'Student overview'}</h2>
                                </div>
                                {data.students.length === 0 ? <p className="p-6 text-sm text-gray-400">{isAr ? 'لا يوجد طلاب مسجلون في هذه الدفعة.' : 'No students are enrolled in this batch.'}</p> : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[620px] text-sm">
                                            <thead className="bg-gray-50 text-xs font-black text-gray-500 dark:bg-white/5 dark:text-gray-400">
                                                <tr><th className="p-3 text-start">{isAr ? 'الطالب' : 'Student'}</th><th className="p-3 text-center">{isAr ? 'الدروس' : 'Lessons'}</th><th className="p-3 text-center">{isAr ? 'الواجبات' : 'Assignments'}</th><th className="p-3 text-center">{isAr ? 'الاختبارات' : 'Quizzes'}</th><th className="p-3 text-center">{isAr ? 'التقييم' : 'Evaluation'}</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                                                {students.map((student) => (
                                                    <tr key={student.id}>
                                                        <td className="p-3"><p className="font-bold text-brand-navy dark:text-white">{student.name}</p><p className="text-xs text-gray-400">{student.email}</p></td>
                                                        <td className="p-3 text-center font-bold">{student.completedLessons}/{data.summary.lessonCount}</td>
                                                        <td className="p-3 text-center font-bold">{student.submissions}</td>
                                                        <td className="p-3 text-center font-bold">{student.quizAttempts}</td>
                                                        <td className="p-3 text-center">{student.evaluated ? <span className="font-black text-emerald-600">{isAr ? 'مرسل' : 'Submitted'}</span> : <span className="text-gray-400">{isAr ? 'بانتظار' : 'Pending'}</span>}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </section>
                            <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/5 dark:bg-brand-navy-dark">
                                <h2 className="mb-4 flex items-center gap-2 font-black text-brand-navy dark:text-white"><Activity size={18} /> {isAr ? 'أحدث النشاطات' : 'Latest activity'}</h2>
                                <div className="space-y-3">
                                    {data.activity.slice(0, 6).map(activityCard)}
                                    {data.activity.length === 0 && <p className="py-5 text-sm text-gray-400">{isAr ? 'لا توجد نشاطات مسجلة بعد.' : 'No activity recorded yet.'}</p>}
                                </div>
                            </section>
                        </div>
                    )}

                    {tab === 'content' && (
                        <div className="space-y-5">
                            <section className="space-y-3">
                                <h2 className="flex items-center gap-2 text-lg font-black text-brand-navy dark:text-white"><BookOpen size={19} /> {isAr ? 'الدروس والملفات' : 'Lessons and files'}</h2>
                                {data.content.map((lesson) => (
                                    <article key={lesson.id} className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/5 dark:bg-brand-navy-dark">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div><h3 className="font-black text-brand-navy dark:text-white">{isAr ? lesson.titleAr : lesson.titleEn}</h3><p className="mt-1 text-xs text-gray-400">{isAr ? 'آخر تعديل للمحتوى' : 'Content last updated'}: {displayDate(lesson.updatedAt, locale)}</p></div>
                                            {lesson.isHidden && <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-700">{isAr ? 'مخفي عن الطلاب' : 'Hidden from students'}</span>}
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {fileHref(lesson.videoUrl) && <a href={fileHref(lesson.videoUrl) ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold dark:border-white/10 dark:text-white"><Video size={15} />{isAr ? 'الفيديو' : 'Video'}<ExternalLink size={13} /></a>}
                                            {lesson.files.map((file) => openFile(file.url, isAr ? file.nameAr || file.nameEn : file.nameEn || file.nameAr))}
                                            {lesson.links.map((link) => openFile(link.url, isAr ? link.labelAr || link.labelEn : link.labelEn || link.labelAr))}
                                            {!lesson.videoUrl && lesson.files.length === 0 && lesson.links.length === 0 && <span className="text-sm text-gray-400">{isAr ? 'لا توجد ملفات أو روابط مضافة.' : 'No files or links attached.'}</span>}
                                        </div>
                                    </article>
                                ))}
                                {data.content.length === 0 && <p className="rounded-xl bg-white p-6 text-sm text-gray-400 dark:bg-brand-navy-dark">{isAr ? 'لا يوجد محتوى في هذه الدفعة.' : 'No content found in this batch.'}</p>}
                            </section>
                            <section className="grid gap-5 xl:grid-cols-2">
                                <div className="space-y-3">
                                    <h2 className="flex items-center gap-2 text-lg font-black text-brand-navy dark:text-white"><FileText size={19} /> {isAr ? 'الواجبات والتسليمات' : 'Assignments and submissions'}</h2>
                                    {data.tasks.map((task) => (
                                        <article key={task.id} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/5 dark:bg-brand-navy-dark">
                                            <div className="flex justify-between gap-3"><h3 className="font-black text-brand-navy dark:text-white">{isAr ? task.titleAr : task.titleEn}</h3><span className="shrink-0 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-black text-blue-700">{task._count.submissions} {isAr ? 'تسليم' : 'submissions'}</span></div>
                                            {task.dueDate && <p className="mt-1 text-xs text-gray-400">{isAr ? 'موعد التسليم' : 'Due'}: {displayDate(task.dueDate, locale)}</p>}
                                            {task.attachmentUrl && <div className="mt-3">{openFile(task.attachmentUrl, isAr ? 'ملف الواجب' : 'Assignment file')}</div>}
                                            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-white/5">
                                                {task.submissions.map((submission) => (
                                                    <div key={submission.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                                        <span><b className="text-brand-navy dark:text-white">{personName(submission.enrollment.student)}</b><span className="ms-2 text-xs text-gray-400">{displayDate(submission.updatedAt || submission.submittedAt, locale)}</span></span>
                                                        {openFile(submission.attachmentUrl, submission.attachmentName || (isAr ? 'ملف الطالب' : 'Student file'))}
                                                        {typeof submission.score === 'number' && <span className="text-xs font-black text-emerald-600">{submission.score}</span>}
                                                        {submission.content && <details className="w-full rounded-lg bg-gray-50 p-3 dark:bg-white/5"><summary className="cursor-pointer text-xs font-black text-brand-navy dark:text-white">{isAr ? 'عرض إجابة الطالب' : 'View student response'}</summary><p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{submission.content}</p></details>}
                                                        {submission.notes && <p className="w-full text-xs text-gray-500 dark:text-gray-400">{isAr ? 'ملاحظة التصحيح' : 'Grading note'}: {submission.notes}</p>}
                                                    </div>
                                                ))}
                                                {task.submissions.length === 0 && <p className="text-sm text-gray-400">{isAr ? 'لا توجد تسليمات بعد.' : 'No submissions yet.'}</p>}
                                            </div>
                                        </article>
                                    ))}
                                    {data.tasks.length === 0 && <p className="rounded-xl bg-white p-5 text-sm text-gray-400 dark:bg-brand-navy-dark">{isAr ? 'لا توجد واجبات.' : 'No assignments.'}</p>}
                                </div>
                                <div className="space-y-3">
                                    <h2 className="flex items-center gap-2 text-lg font-black text-brand-navy dark:text-white"><ClipboardCheck size={19} /> {isAr ? 'الاختبارات والنتائج' : 'Quizzes and results'}</h2>
                                    {data.quizzes.map((quiz) => (
                                        <article key={quiz.id} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/5 dark:bg-brand-navy-dark">
                                            <div className="flex justify-between gap-3"><h3 className="font-black text-brand-navy dark:text-white">{isAr ? quiz.titleAr : quiz.titleEn}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-black ${quiz.isPublished ? 'bg-emerald-500/10 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{quiz.isPublished ? (isAr ? 'منشور' : 'Published') : (isAr ? 'مسودة' : 'Draft')}</span></div>
                                            <p className="mt-1 text-xs text-gray-400">{quiz.isFinal ? (isAr ? 'اختبار نهائي' : 'Final exam') : (isAr ? 'اختبار درس' : 'Lesson quiz')} · {quiz._count.questions} {isAr ? 'سؤال' : 'questions'}</p>
                                            {quiz.questions.length > 0 && (
                                                <details className="mt-3 rounded-xl bg-gray-50 p-3 dark:bg-white/5">
                                                    <summary className="cursor-pointer text-sm font-bold text-brand-navy dark:text-white">{isAr ? 'عرض أسئلة الاختبار' : 'View quiz questions'}</summary>
                                                    <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm text-gray-600 dark:text-gray-300">
                                                        {quiz.questions.map((question) => <li key={question.id}>{isAr ? question.textAr : question.textEn}</li>)}
                                                    </ol>
                                                </details>
                                            )}
                                            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-white/5">
                                                {quiz.attempts.map((attempt) => (
                                                    <div key={attempt.id} className="flex items-center justify-between gap-2 text-sm">
                                                        <span><b className="text-brand-navy dark:text-white">{personName(attempt.enrollment.student)}</b><span className="ms-2 text-xs text-gray-400">{displayDate(attempt.submittedAt, locale)}</span></span>
                                                        <span className={`font-black ${attempt.passed ? 'text-emerald-600' : 'text-red-500'}`}>{attempt.score}%</span>
                                                    </div>
                                                ))}
                                                {quiz.attempts.length === 0 && <p className="text-sm text-gray-400">{isAr ? 'لا توجد محاولات بعد.' : 'No attempts yet.'}</p>}
                                            </div>
                                        </article>
                                    ))}
                                    {data.quizzes.length === 0 && <p className="rounded-xl bg-white p-5 text-sm text-gray-400 dark:bg-brand-navy-dark">{isAr ? 'لا توجد اختبارات.' : 'No quizzes.'}</p>}
                                </div>
                            </section>
                        </div>
                    )}

                    {tab === 'students' && (
                        <section className="space-y-3">
                            <h2 className="flex items-center gap-2 text-lg font-black text-brand-navy dark:text-white"><GraduationCap size={19} /> {isAr ? 'نشاط الطلاب وتسليماتهم' : 'Student activity and submissions'}</h2>
                            {data.activityTruncated && <p className="text-center text-xs text-gray-400">{isAr ? 'تم اختصار السجل إلى أحدث 1000 نشاط.' : 'The activity feed is limited to the latest 1,000 events.'}</p>}
                            {studentActivity.map(activityCard)}
                            {studentActivity.length === 0 && <p className="rounded-xl bg-white p-6 text-sm text-gray-400 dark:bg-brand-navy-dark">{isAr ? 'لا توجد نشاطات طلاب مطابقة.' : 'No matching student activity.'}</p>}
                        </section>
                    )}

                    {tab === 'teacher' && (
                        <section className="space-y-3">
                            <h2 className="flex items-center gap-2 text-lg font-black text-brand-navy dark:text-white"><Activity size={19} /> {isAr ? 'سجل عمليات المدرّس والإدارة' : 'Instructor and staff activity log'}</h2>
                            {teacherActivity.map(activityCard)}
                            {data.activityTruncated && <p className="text-center text-xs text-gray-400">{isAr ? 'تم اختصار السجل إلى أحدث 1000 نشاط.' : 'The activity feed is limited to the latest 1,000 events.'}</p>}
                            {teacherActivity.length === 0 && <p className="rounded-xl bg-white p-6 text-sm text-gray-400 dark:bg-brand-navy-dark">{isAr ? 'لم تُسجل تغييرات بعد. ستظهر التعديلات الجديدة هنا.' : 'No changes recorded yet. New edits will appear here.'}</p>}
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
