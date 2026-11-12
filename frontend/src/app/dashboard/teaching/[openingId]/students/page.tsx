"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { PageHeader, Badge, EmptyState, type Tone } from '../../components';
import {
    ArrowLeft, Search, Users, Loader, UserCheck, TrendingUp, GraduationCap,
} from 'lucide-react';

interface MyOpening {
    id: string;
    nameAr?: string | null;
    nameEn?: string | null;
    status: string;
    course: { id: string; titleAr?: string | null; titleEn?: string | null };
}

interface EnrollmentRow {
    id: string;
    status: string;
    createdAt: string;
    student: {
        id: string;
        email: string;
        name?: string | null;
        nameAr?: string | null;
        nameEn?: string | null;
    };
    grades: { assessmentId: string; score: number }[];
    progressPercent?: number | null;
}

interface RosterData {
    enrollments?: EnrollmentRow[] | null;
}

const statusTone: Record<string, Tone> = {
    APPROVED: 'green',
    PENDING: 'amber',
    REJECTED: 'red',
    RESERVED: 'blue',
};

const statusLabelAr: Record<string, string> = {
    APPROVED: 'مقبول',
    PENDING: 'قيد المراجعة',
    REJECTED: 'مرفوض',
    RESERVED: 'محجوز',
};

const statusLabelEn: Record<string, string> = {
    APPROVED: 'Approved',
    PENDING: 'Pending',
    REJECTED: 'Rejected',
    RESERVED: 'Reserved',
};

const avatarTones = [
    'bg-brand-gold/20 text-brand-gold-light',
    'bg-emerald-500/20 text-emerald-400',
    'bg-sky-500/20 text-sky-400',
    'bg-violet-500/20 text-violet-400',
    'bg-rose-500/20 text-rose-400',
    'bg-cyan-500/20 text-cyan-400',
];

const avatarToneFor = (seed: string) => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return avatarTones[h % avatarTones.length];
};

export default function OpeningStudentsPage() {
    const { openingId } = useParams();
    const oid = String(openingId || '');
    const { pick, locale } = useI18n();
    const isAr = locale === 'ar';
    const [search, setSearch] = useState('');

    const { data: openings, error: openingsError } = useFetchData<MyOpening[]>('/openings/mine');
    const { data: roster, loading, error } = useFetchData<RosterData>(oid ? `/openings/${oid}/roster` : null);

    const opening = (openings || []).find((o) => o.id === oid);
    const studentName = (student: EnrollmentRow['student']) => {
        const names = isAr
            ? [student.nameAr, student.name, student.nameEn]
            : [student.nameEn, student.name, student.nameAr];
        return names.find((name) => name?.trim())?.trim() || '';
    };

    const allRows = useMemo(() => {
        const enrollments = roster?.enrollments || [];
        return enrollments.map((enrollment) => ({
            ...enrollment,
            progress: enrollment.progressPercent ?? null,
        }));
    }, [roster]);

    const rows = useMemo(() => {
        const q = search.trim().toLocaleLowerCase(locale);
        return allRows.filter((enrollment) => !q || [
            enrollment.student.email,
            enrollment.student.name,
            enrollment.student.nameAr,
            enrollment.student.nameEn,
        ].some((value) => value?.toLocaleLowerCase(locale).includes(q)));
    }, [allRows, search, locale]);

    const approvedCount = allRows.filter((r) => r.status === 'APPROVED').length;
    const progressValues = allRows.map((r) => r.progress).filter((p): p is number => p != null);
    const avgProgress = progressValues.length
        ? Math.round(progressValues.reduce((s, p) => s + p, 0) / progressValues.length)
        : null;
    const enrollmentCount = roster?.enrollments?.length;

    const fmtDate = (d?: string | null) =>
        d ? new Date(d).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    return (
        <ProtectedRoute allowedRoles={['INSTRUCTOR']}>
            <div className="min-w-0 animate-fade-in space-y-5 sm:space-y-6 p-3 sm:p-4">
                <Link
                    href={`/dashboard/teaching/${oid}`}
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-400 hover:text-white transition"
                >
                    <ArrowLeft size={16} /> {isAr ? 'العودة لمساحة التدريس' : 'Back to Workspace'}
                </Link>

                <PageHeader
                    title={isAr ? 'طلاب الدفعة' : 'Opening Students'}
                    subtitle={
                        opening
                            ? `${pick(opening, 'name') || (isAr ? 'دفعة بدون عنوان' : 'Untitled Batch')} · ${pick(opening.course, 'title')}`
                            : undefined
                    }
                    actions={<Badge tone="gold"><Users size={13} /> {enrollmentCount ?? '—'} {isAr ? 'طالب' : 'Students'}</Badge>}
                />

                {(error || openingsError) && (
                    <div role="alert" className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl">
                        {error || openingsError}
                    </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                        { icon: Users, label: isAr ? 'إجمالي الطلاب' : 'Total Students', value: enrollmentCount ?? '—', color: 'text-brand-navy-light', bg: 'bg-brand-navy-light/10' },
                        { icon: UserCheck, label: isAr ? 'مقبولون' : 'Approved', value: roster ? approvedCount : '—', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                        { icon: TrendingUp, label: isAr ? 'متوسط التقدم' : 'Avg Progress', value: avgProgress != null ? `${avgProgress}%` : '—', color: 'text-brand-gold-light', bg: 'bg-brand-gold/10' },
                    ].map((s, i) => (
                        <div key={i} className="min-w-0 bg-brand-navy-dark border border-white/5 rounded-2xl p-3 sm:p-5 hover:border-white/10 transition-all">
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${s.bg} ${s.color} flex items-center justify-center shrink-0`}>
                                    <s.icon size={18} />
                                </div>
                                <p className="text-[11px] sm:text-xs font-bold leading-snug text-gray-400">{s.label}</p>
                            </div>
                            <p className="text-2xl sm:text-3xl font-black text-white">{s.value}</p>
                        </div>
                    ))}
                </div>

                <section className="bg-brand-navy-dark border border-white/5 rounded-2xl overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-4 p-4 sm:p-5 border-b border-white/5">
                        <div>
                            <h3 className="text-lg font-black text-white flex items-center gap-2">
                                <GraduationCap size={18} className="text-brand-gold-light" />
                                {isAr ? 'قائمة الطلاب' : 'Student Roster'}
                            </h3>
                            <p className="text-sm text-gray-400 mt-0.5">
                                {isAr ? 'حالة القيد وتاريخ الانضمام ونسبة التقدم لكل طالب' : 'Enrollment status, join date and progress per student'}
                            </p>
                        </div>
                        <div className="relative w-full sm:w-72">
                            <Search size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={isAr ? 'ابحث باسم الطالب أو بريده الإلكتروني...' : 'Search by student name or email...'}
                                className="w-full ps-10 pe-4 py-2.5 bg-brand-navy-dark border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold/40 outline-none transition"
                            />
                        </div>
                    </div>

                    <div className="sm:hidden divide-y divide-white/5">
                        {loading ? (
                            <div className="p-10 text-center text-gray-400">
                                <Loader className="animate-spin mx-auto mb-3" size={24} />
                                {isAr ? 'جاري التحميل...' : 'Loading...'}
                            </div>
                        ) : error ? (
                            <div role="alert" className="p-8 text-center text-sm font-semibold text-red-400">
                                {isAr ? 'تعذر تحميل قائمة الطلاب.' : 'Could not load the student roster.'}
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="p-8 text-center text-sm font-semibold text-gray-400">
                                {search.trim() ? (isAr ? 'لا يوجد طالب مطابق للبحث' : 'No students match your search') : (isAr ? 'لا يوجد طلاب مسجلون في هذه الدفعة بعد' : 'No students enrolled in this opening yet')}
                            </div>
                        ) : rows.map((r) => (
                            <article key={r.id} className="min-w-0 space-y-3 p-4">
                                <div className="flex min-w-0 items-start justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className={`w-9 h-9 rounded-full ${avatarToneFor(studentName(r.student) || r.student.email)} flex items-center justify-center font-black text-sm shrink-0`}>
                                            {(studentName(r.student) || r.student.email).charAt(0).toLocaleUpperCase(locale)}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="break-all font-bold text-white">{studentName(r.student) || r.student.email}</p>
                                            {studentName(r.student) && <p className="text-xs text-gray-500 truncate">{r.student.email}</p>}
                                        </div>
                                    </div>
                                    <Badge tone={statusTone[r.status] ?? 'gray'}>
                                        {isAr ? (statusLabelAr[r.status] ?? r.status) : (statusLabelEn[r.status] ?? r.status)}
                                    </Badge>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="text-gray-400">{isAr ? 'تاريخ الانضمام' : 'Join date'}</span>
                                    <span className="text-gray-300 font-semibold">{fmtDate(r.createdAt)}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="shrink-0 text-xs text-gray-400">{isAr ? 'التقدم' : 'Progress'}</span>
                                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-brand-gold to-brand-gold-light rounded-full transition-all duration-500" style={{ width: `${r.progress ?? 0}%` }} />
                                    </div>
                                    <span className={`text-xs font-black ${r.progress != null ? 'text-white' : 'text-gray-600'}`}>
                                        {r.progress != null ? `${r.progress}%` : '—'}
                                    </span>
                                </div>
                            </article>
                        ))}
                    </div>
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm min-w-[720px]">
                            <thead>
                                <tr className="text-xs uppercase tracking-wide text-gray-500 bg-white/[0.03] border-b border-white/5">
                                    <th className="px-6 py-4 text-start font-bold">{isAr ? 'البريد الإلكتروني' : 'Student Email'}</th>
                                    <th className="px-6 py-4 text-start font-bold">{isAr ? 'الحالة' : 'Status'}</th>
                                    <th className="px-6 py-4 text-start font-bold">{isAr ? 'تاريخ الانضمام' : 'Join Date'}</th>
                                    <th className="px-6 py-4 text-start font-bold">{isAr ? 'التقدم' : 'Progress'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={99} className="p-12 text-center text-gray-400">
                                            <Loader className="animate-spin mx-auto mb-3" size={24} />
                                            {isAr ? 'جاري التحميل...' : 'Loading...'}
                                        </td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={99} role="alert" className="p-12 text-center text-sm font-semibold text-red-400">
                                            {isAr ? 'تعذر تحميل قائمة الطلاب.' : 'Could not load the student roster.'}
                                        </td>
                                    </tr>
                                ) : rows.length === 0 ? (
                                    <EmptyState
                                        icon={GraduationCap}
                                        title={search.trim() ? (isAr ? 'لا يوجد طالب مطابق للبحث' : 'No students match your search') : (isAr ? 'لا يوجد طلاب مسجلون في هذه الدفعة بعد' : 'No students enrolled in this opening yet')}
                                    />
                                ) : (
                                    rows.map((r) => (
                                        <tr key={r.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-full ${avatarToneFor(studentName(r.student) || r.student.email)} flex items-center justify-center font-black text-sm shrink-0`}>
                                                        {(studentName(r.student) || r.student.email).charAt(0).toLocaleUpperCase(locale)}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-white truncate">{studentName(r.student) || r.student.email}</p>
                                                        {studentName(r.student) && <p className="text-xs text-gray-500 truncate">{r.student.email}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <Badge tone={statusTone[r.status] ?? 'gray'}>
                                                    {isAr ? (statusLabelAr[r.status] ?? r.status) : (statusLabelEn[r.status] ?? r.status)}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4 text-gray-300 font-semibold whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2.5 min-w-[150px]">
                                                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-gradient-to-r from-brand-gold to-brand-gold-light rounded-full transition-all duration-500"
                                                            style={{ width: `${r.progress ?? 0}%` }}
                                                        />
                                                    </div>
                                                    <span className={`text-xs font-black w-10 text-end ${r.progress != null ? 'text-white' : 'text-gray-600'}`}>
                                                        {r.progress != null ? `${r.progress}%` : '—'}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </ProtectedRoute>
    );
}
