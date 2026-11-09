"use client";

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import StudentTasksPanel from '@/components/StudentTasksPanel';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { ClipboardList, Loader } from 'lucide-react';

interface Enrollment {
    id: string;
    status: string;
    course: { id: string; titleAr?: string | null; titleEn?: string | null };
    opening?: {
        id: string;
        nameAr?: string | null;
        nameEn?: string | null;
    } | null;
}

export default function TasksPage() {
    const { t, pick } = useI18n();
    const searchParams = useSearchParams();
    const { data: enrollments, loading, error } = useFetchData<Enrollment[]>('/enrollments/my');
    const requestedOpeningId = searchParams.get('openingId') ?? '';
    const [selectedOpeningId, setSelectedOpeningId] = useState(requestedOpeningId);
    const openings = Array.from(new Map(
        (enrollments || [])
            .filter((enrollment) =>
                enrollment.opening?.id
                && ['APPROVED', 'PENDING', 'RESERVED'].includes(enrollment.status),
            )
            .map((enrollment) => [enrollment.opening!.id, enrollment] as const),
    ).values());
    const activeOpeningId = openings.some((enrollment) => enrollment.opening?.id === selectedOpeningId)
        ? selectedOpeningId
        : '';

    const inputCls = 'w-full px-4 py-3 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition placeholder:text-gray-400 dark:placeholder:text-gray-500 text-brand-navy dark:text-white';

    return (
        <ProtectedRoute allowedRoles={['STUDENT']}>
            <div className="animate-fade-in space-y-6">
                <div className="bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5">
                    <h2 className="flex min-w-0 items-center gap-2 sm:gap-3 text-2xl sm:text-3xl font-black text-brand-navy dark:text-white">
                        <ClipboardList size={24} className="shrink-0 text-brand-gold-dark dark:text-brand-gold-light" /> {t('tasks.teacher_heading')}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">{t('tasks.teacher_subtitle')}</p>
                </div>

                <div className="bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5">
                    <div className="max-w-xl mb-6">
                        <label htmlFor="task-opening" className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1.5">
                            {t('tasks.select_opening')} *
                        </label>
                        <select
                            id="task-opening"
                            value={activeOpeningId}
                            onChange={(event) => setSelectedOpeningId(event.target.value)}
                            className={inputCls}
                            disabled={loading}
                        >
                            <option value="">{t('tasks.select_opening_placeholder')}</option>
                            {openings.map((enrollment) => (
                                <option key={enrollment.opening!.id} value={enrollment.opening!.id}>
                                    {pick(enrollment.opening, 'name') || pick(enrollment.course, 'title')} — {pick(enrollment.course, 'title')}
                                </option>
                            ))}
                        </select>
                    </div>

                    {error && (
                        <div role="alert" className="mb-6 p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl">
                            {error}
                        </div>
                    )}

                    {loading && (
                        <div className="h-40 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">
                            <Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light me-2" size={20} /> {t('common.loading')}
                        </div>
                    )}

                    {!loading && !error && !activeOpeningId && (
                        <div className="py-12 text-center text-gray-500 dark:text-gray-400 font-bold">
                            {openings.length ? t('tasks.pick_hint') : t('tasks.no_tasks')}
                        </div>
                    )}

                    {activeOpeningId && <StudentTasksPanel key={activeOpeningId} openingId={activeOpeningId} />}
                </div>
            </div>
        </ProtectedRoute>
    );
}
