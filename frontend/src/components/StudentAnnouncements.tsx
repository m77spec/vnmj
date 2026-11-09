"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useFetchData } from '@/lib/useFetchData';
import { Megaphone, Calendar, User, BookOpen, Loader, Bell } from 'lucide-react';
import { EmptyPanel } from '@/app/dashboard/admin/components';

interface Enrollment {
    id: string;
    status: string;
    course: { id: string; titleAr?: string | null; titleEn?: string | null };
    opening?: { id: string; nameAr?: string | null; nameEn?: string | null } | null;
}

interface Announcement {
    id: string;
    titleAr: string;
    titleEn: string;
    contentAr: string;
    contentEn: string;
    isPublished: boolean;
    createdAt: string;
    author?: { id: string; nameAr?: string | null; nameEn?: string | null } | null;
    openingName?: string | null;
}

export default function StudentAnnouncements() {
    const { t, pick, locale } = useI18n();
    const { token } = useAuth();
    const isAr = locale === 'ar';

    // `/enrollments/my` is protected, and this panel sits on the dashboard shell,
    // which renders before the session is known. Firing it unconditionally put a
    // guaranteed 401 in the console on every visit; `useFetchData` skips a null
    // url and refetches once the token appears.
    const { data: enrollments, loading: enrollmentsLoading, error: enrollmentsError } =
        useFetchData<Enrollment[]>(token ? '/enrollments/my' : null);
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            setLoadError(false);
            if (enrollmentsLoading) return;
            if (enrollmentsError) {
                setLoadError(true);
                setLoading(false);
                return;
            }
            try {
                const approved = (enrollments || []).filter(e => e.status === 'APPROVED' && e.opening?.id);
                if (approved.length === 0) {
                    if (active) setAnnouncements([]);
                    return;
                }
                let failed = false;
                const results = await Promise.all(
                    approved.map(async (e) => {
                        try {
                            const res = await api.get(`/announcements/opening/${e.opening!.id}`);
                            return (res.data || []).map((a: Announcement) => ({
                                ...a,
                                openingName: pick(e.opening, 'name') || pick(e.course, 'title'),
                            }));
                        } catch {
                            failed = true;
                            return [];
                        }
                    })
                );
                if (active) {
                    const flat = results.flat().sort(
                        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    );
                    setAnnouncements(flat);
                    setLoadError(failed);
                }
            } catch {
                if (active) {
                    setAnnouncements([]);
                    setLoadError(true);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [enrollments, enrollmentsError, enrollmentsLoading, pick]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader size={24} className="animate-spin text-accent" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center">
                    <Bell size={20} className="text-accent" />
                </div>
                <div>
                    <h3 className="text-xl font-black text-ink">{t('announcements.title')}</h3>
                    <p className="text-ink-subtle text-sm">{isAr ? 'آخر الإعلانات من دوراتك' : 'Latest announcements from your courses'}</p>
                </div>
            </div>

            {loadError && (
                <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-semibold text-red-700 dark:text-red-300">
                    {isAr ? 'تعذر تحميل بعض الإعلانات. حاول تحديث الصفحة.' : 'Some announcements could not be loaded. Please refresh the page.'}
                </div>
            )}

            {announcements.length === 0 ? (
                <div className="bg-surface-sunken border border-line rounded-2xl p-8">
                    <EmptyPanel
                        icon={Megaphone}
                        title={loadError
                            ? (isAr ? 'تعذر تحميل الإعلانات' : 'Could not load announcements')
                            : (isAr ? 'لا توجد إعلانات' : 'No announcements yet')}
                    />
                </div>
            ) : (
                <div className="space-y-3">
                    {announcements.map((a) => (
                        <div
                            key={a.id}
                            className="bg-surface-sunken border border-line rounded-2xl p-5 hover:border-brand-gold/20 transition-all duration-200"
                        >
                            <div className="flex items-start gap-3">
                                <div className="shrink-0 w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center mt-0.5">
                                    <Megaphone size={18} className="text-accent" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-ink font-bold text-base mb-1">{isAr ? a.titleAr : a.titleEn}</h4>
                                    {a.openingName && (
                                        <div className="flex items-center gap-1.5 text-xs text-ink-subtle mb-2">
                                            <BookOpen size={11} />
                                            <span>{a.openingName}</span>
                                        </div>
                                    )}
                                    <p className="text-ink-muted text-sm leading-relaxed line-clamp-3 mb-3">
                                        {isAr ? a.contentAr : a.contentEn}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-4 text-[10px] text-ink-subtle">
                                        <span className="flex items-center gap-1">
                                            <Calendar size={10} />
                                            {new Date(a.createdAt).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
                                                year: 'numeric', month: 'short', day: 'numeric'
                                            })}
                                        </span>
                                        {a.author && (pick(a.author, 'name')) && (
                                            <span className="flex min-w-0 items-center gap-1">
                                                <User size={10} />
                                                <span className="min-w-0 truncate">{pick(a.author, 'name')}</span>
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
