"use client";

import { useFetchData } from '@/lib/useFetchData';
import { api, API_BASE_URL, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { Fragment, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import Image from 'next/image';
import { Pencil, Trash2, CalendarPlus, Users, ArrowUpRight, Search, BookOpen, Package, ChevronDown, Download, Upload, LoaderCircle } from 'lucide-react';
import { PageHeader, Badge, EmptyState, BtnPrimary, type Tone } from '../components';
import CourseAdminPanel from '@/components/admin/CourseAdminPanel';

interface Opening {
    id: string;
    status?: string | null;
    nameAr?: string | null;
    nameEn?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    enrollmentDeadline?: string | null;
    price: string;
    currency?: string;
    priceOld?: string | null;
    maxStudents?: number | null;
    isPublished: boolean;
    instructor?: { email: string } | null;
    _count?: { enrollments?: number };
}

interface Course {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    excerptAr?: string | null;
    excerptEn?: string | null;
    coverImageUrl?: string | null;
    categoryAr?: string | null;
    categoryEn?: string | null;
    level?: string | null;
    language?: string | null;
    hoursOfContent?: number | null;
    createdAt: string;
    openings?: Opening[];
    instructor?: { email: string } | null;
    _count?: { enrollments?: number; modules?: number };
}

const statusTone = (pub: number, planned: number, ended: number): { label: string; tone: Tone } =>
    ended > 0 && pub === 0 ? { label: 'ended', tone: 'gray' }
        : pub > 0 ? { label: 'open', tone: 'green' }
            : planned > 0 ? { label: 'planned', tone: 'amber' }
                : { label: 'draft', tone: 'gray' };

export default function AdminCoursesPage() {
    const { data: courses, loading, error, refetch } = useFetchData<Course[]>('/courses?includeUnpublished=true');
    const { t, pick } = useI18n();
    const [query, setQuery] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    // Course managers need to reconcile a course from one place: details, every
    // opening state, and the full student roster. Expanding the row keeps that
    // context on the list instead of sending them off to separate pages.
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const importRef = useRef<HTMLInputElement>(null);

    const downloadTemplate = async () => {
        try {
            const response = await api.get('/api/admin/courses/import/template', { responseType: 'blob' });
            const url = URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'LaxaLab-Course-Import-Template.xlsx';
            link.click();
            URL.revokeObjectURL(url);
        } catch (err) { toast.error(getErrorMessage(err) || 'تعذر تحميل قالب Excel'); }
    };

    const importWorkbook = async (file: File) => {
        setImporting(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const response = await api.post('/api/admin/courses/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
            toast.success(`تم إنشاء ${response.data.imported} دورة بنجاح`);
            refetch();
        } catch (err) { toast.error(getErrorMessage(err) || 'تعذر استيراد ملف Excel'); }
        finally { setImporting(false); if (importRef.current) importRef.current.value = ''; }
    };

    const handleDelete = async (c: Course) => {
        if (!window.confirm(`${t('manageCourses.delete_prefix')} ${pick(c, 'title') || c.id}?`)) return;
        setDeletingId(c.id);
        try {
            await api.delete(`/api/admin/courses/${c.id}`);
            toast.success(t('admin.course_deleted'));
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('manageCourses.delete_fail'));
        }
        setDeletingId(null);
    };

    const filtered = (courses || []).filter(c => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (c.titleAr || '').toLowerCase().includes(q) || (c.titleEn || '').toLowerCase().includes(q)
            || (c.categoryAr || '').toLowerCase().includes(q) || (c.categoryEn || '').toLowerCase().includes(q);
    });

    const publishedOpenings = (c: Course) => (c.openings || []).filter(o => o.isPublished);
    const currentPrice = (c: Course) => publishedOpenings(c)[0]?.price;
    const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
    const totalEnrollments = (c: Course) => (c.openings || []).reduce((sum, o) => sum + (o._count?.enrollments ?? 0), 0);

    return (
        <div className="space-y-6 animate-fade-in">
            <PageHeader
                title={t('admin.courses_heading')}
                subtitle={t('admin.courses_subtitle')}
                actions={
                    <>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                            <input
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder={t('admin.search_courses')}
                                className="ps-9 pe-3 py-2.5 border border-gray-300 dark:border-white/10 rounded-xl text-sm w-full sm:w-56 bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold outline-none transition"
                            />
                        </div>
                        <button type="button" onClick={downloadTemplate} title="نزّل النموذج واملأ بيانات الدورة ثم ارفعه لإنشائها تلقائيًا" className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/40 px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-gold/10 dark:text-white"><Download size={16} /> تنزيل نموذج تعبئة الدورة</button>
                        <button type="button" disabled={importing} onClick={() => importRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-brand-gold bg-white px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-gold/10 disabled:opacity-60 dark:bg-brand-navy-dark dark:text-white">
                            {importing ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />} {importing ? 'جارٍ إنشاء الدورة...' : 'رفع النموذج وإنشاء الدورة'}
                        </button>
                        <input ref={importRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importWorkbook(file); }} />
                        <BtnPrimary href="/dashboard/courses/create" icon={BookOpen}>{t('manageCourses.create_course')}</BtnPrimary>
                    </>
                }
            />

            {error && <div className="p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-xl">{error}</div>}

            {loading ? (
                <div className="h-40 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('admin.loading_courses')}</div>
            ) : (
                <div className="admin-table-wrap animate-fade-in-up">
                    <table className="admin-table text-left">
                        <thead>
                            <tr>
                                <th>{t('manageCourses.col_title')}</th>
                                <th>{t('admin.col_category')}</th>
                                <th>{t('admin.col_level')}</th>
                                <th>{t('admin.col_openings_short')}</th>
                                <th>{t('manageCourses.col_price')}</th>
                                <th>{t('manageCourses.col_status')}</th>
                                <th>{t('admin.col_enrollments')}</th>
                                <th className="text-right">{t('manageCourses.col_actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                            {filtered.map((c) => {
                                const pub = publishedOpenings(c);
                                const endedCount = (c.openings || []).filter(o => o.status === 'ENDED').length;
                                const status = statusTone(pub.length, (c.openings || []).length, endedCount);
                                const isExpanded = expandedId === c.id;
                                return (
                                    <Fragment key={c.id}>
                                    <tr className="animate-fade-in hover:bg-gray-100 dark:hover:bg-white/5">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3 min-w-[240px]">
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                                                    aria-expanded={isExpanded}
                                                    aria-label={t('admin.panel_toggle')}
                                                    className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-brand-gold hover:bg-gray-100 dark:hover:bg-white/10 transition cursor-pointer"
                                                >
                                                    <ChevronDown size={18} className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                                </button>
                                                {c.coverImageUrl ? (
                                                    <Image src={`${API_BASE_URL}${c.coverImageUrl}`} alt="" width={48} height={36} unoptimized className="w-12 h-9 object-cover rounded-lg border border-gray-300 dark:border-white/10 shadow-sm" />
                                                ) : (
                                                    <div className="w-12 h-9 rounded-lg bg-gradient-to-br from-brand-navy to-brand-navy-dark flex items-center justify-center text-brand-gold-light font-black text-xs">L</div>
                                                )}
                                                <div>
                                                    <div className="font-bold text-brand-navy dark:text-gray-200">{pick(c, 'title')}</div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{c.hoursOfContent ? `${c.hoursOfContent}h` : '—'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-sm text-gray-500 dark:text-gray-400">{pick(c, 'category') || '—'}</td>
                                        <td className="p-4 text-sm text-gray-500 dark:text-gray-400">{c.level ? t('course.level_' + String(c.level).toLowerCase()) : '—'}</td>
                                        <td className="p-4 text-sm">
                                            <span className="font-bold text-brand-navy dark:text-white">{(c.openings || []).length}</span>
                                            <span className="text-gray-500 dark:text-gray-400 text-xs ms-1">({pub.length} {t('admin.published_short')})</span>
                                        </td>
                                        <td className="p-4 font-black text-emerald-600 dark:text-emerald-400">{currentPrice(c) ? `$${currentPrice(c)}` : '—'}</td>
                                        <td className="p-4">
                                            <Badge tone={status.tone}>{t('admin.course_' + status.label)}</Badge>
                                        </td>
                                        <td className="p-4 text-sm text-gray-500 dark:text-gray-400">
                                            <span className="inline-flex items-center gap-1.5 font-bold"><Users size={14} className="text-gray-500 dark:text-gray-400" /> {totalEnrollments(c)}</span>
                                        </td>
                                        <td className="p-4 text-right whitespace-nowrap">
                                            <Link href={`/courses/${c.id}`}>
                                                <button className="admin-action-btn text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 tooltip" title={t('admin.view_course')}>
                                                    <ArrowUpRight size={18} />
                                                </button>
                                            </Link>
                                            <Link href={`/dashboard/courses/open/${c.id}`}>
                                                <button className="admin-action-btn text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 tooltip" title={t('manageCourses.open_course_tooltip')}>
                                                    <CalendarPlus size={18} />
                                                </button>
                                            </Link>
                                            <Link href={`/dashboard/courses/edit/${c.id}`}>
                                                <button className="admin-action-btn text-brand-navy dark:text-brand-navy-light hover:bg-brand-navy/10 dark:hover:bg-brand-navy-light/10 tooltip" title={t('manageCourses.edit_tooltip')}>
                                                    <Pencil size={18} />
                                                </button>
                                            </Link>
                                            <button
                                                onClick={() => handleDelete(c)}
                                                disabled={deletingId === c.id}
                                                className="admin-action-btn tooltip text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-40"
                                                title={t('manageCourses.delete_tooltip')}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={8} className="p-0">
                                                <div className="bg-gray-50 dark:bg-brand-navy-dark/40 border-y border-gray-200 dark:border-white/5 animate-fade-in-up">
                                                    <div className="p-5">
                                                        <CourseAdminPanel courseId={c.id} />
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    </Fragment>
                                );
                            })}
                            {filtered.length === 0 && (
                                <EmptyState icon={BookOpen} title={t('manageCourses.empty')} />
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Recent openings */}
            {filtered.length > 0 && (
                <div className="admin-card p-0 overflow-hidden animate-fade-in-up">
                    <div className="px-5 py-4 bg-gradient-to-r from-brand-navy to-brand-navy-dark flex items-center gap-3">
                        <div className="admin-tile w-8 h-8 bg-white/10 text-brand-gold-light">
                            <Package size={16} />
                        </div>
                        <span className="text-sm font-black text-white uppercase tracking-widest">{t('admin.recent_openings')}</span>
                    </div>
                    <div className="divide-y divide-gray-200 dark:divide-white/5">
                        {filtered.slice(0, 8).flatMap((c) => (c.openings || []).map((o) => (
                            <div key={o.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5 text-sm hover:bg-gray-100 dark:hover:bg-white/5 transition">
                                <span className="font-bold text-brand-navy dark:text-gray-200">{pick(o, 'name') || pick(c, 'title')}</span>
                                <Badge tone={o.isPublished ? 'green' : 'amber'} dot>
                                    {o.isPublished ? t('admin.published_short') : t('admin.draft_tag')}
                                </Badge>
                                <span className="text-gray-500 dark:text-gray-400 text-xs">{t('opening.start_date')}: {fmtDate(o.startDate)}</span>
                                <span className="text-gray-500 dark:text-gray-400 text-xs">{t('opening.end_date')}: {fmtDate(o.endDate)}</span>
                                <span className="font-black text-emerald-600 dark:text-emerald-400">${o.price}</span>
                                <span className="ms-auto text-gray-500 dark:text-gray-400 text-xs truncate">{o.instructor?.email || '—'}</span>
                            </div>
                        )))}
                    </div>
                </div>
            )}
        </div>
    );
}
