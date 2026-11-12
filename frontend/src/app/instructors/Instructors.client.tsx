"use client";

import Link from 'next/link';
import { GraduationCap, BookOpen, Users, Clock, Briefcase } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import MarketingShell from '@/components/MarketingShell';
import { useFetchData } from '@/lib/useFetchData';
import { useAuth } from '@/lib/auth-context';
import { API_BASE_URL } from '@/lib/api';
import { formatNumber, formatDate } from '@/lib/format';
import type { PublicInstructorCard } from '@/lib/public-instructor';

/** Public instructor card, plus the aggregate counts the list renders. */
interface PublicInstructor extends PublicInstructorCard {
    joinedAt: string | null;
    courseCount: number;
    openingCount: number;
}

export default function InstructorsContent() {
    const { locale, t, pick } = useI18n();
    const { dark } = useTheme();
    const { user } = useAuth();
    const { data: instructors, loading, error } = useFetchData<PublicInstructor[]>('/public/instructors');

    const card = (dark_: boolean) =>
        dark_ ? 'bg-brand-navy-dark border-white/10' : 'bg-white border-gray-200';
    const title = (dark_: boolean) => (dark_ ? 'text-white' : 'text-brand-navy');
    const muted = (dark_: boolean) => (dark_ ? 'text-gray-400' : 'text-gray-500');

    return (
        <MarketingShell
            title={t('instructorProfile.instructors_title')}
            subtitle={t('instructorProfile.instructors_subtitle')}
        >
            {error && (
                <div className={`p-4 rounded-xl font-semibold ${dark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex justify-center p-12 text-brand-gold font-bold text-xl">
                    {t('explore.loading_catalog')}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                    {instructors?.map((instructor) => {
                        const name = pick(instructor, 'name');
                        const jobTitle = pick(instructor, 'jobTitle');
                        const specialty = pick(instructor, 'specialty');

                        return (
                            <Link
                                key={instructor.id}
                                href={`/instructors/${instructor.id}`}
                                className={`rounded-3xl border shadow-sm hover:shadow-xl transition-all p-8 flex flex-col items-center text-center group ${card(dark)}`}
                            >
                                {instructor.avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={`${API_BASE_URL}${instructor.avatarUrl}`}
                                        alt={name || ''}
                                        className="w-20 h-20 rounded-2xl object-cover mb-5 group-hover:scale-105 transition-transform border border-brand-gold/30"
                                    />
                                ) : (
                                    <div className="w-20 h-20 bg-brand-navy rounded-2xl flex items-center justify-center text-brand-gold text-3xl font-black mb-5 group-hover:scale-105 transition-transform">
                                        {(name || '?').trim().charAt(0).toUpperCase()}
                                    </div>
                                )}

                                <p className={`font-black text-lg mb-1 break-words ${title(dark)}`} dir="auto">
                                    {name || t('instructorProfile.not_filled')}
                                </p>
                                {jobTitle ? (
                                    <p className="text-sm font-bold text-brand-gold-dark dark:text-brand-gold-light mb-1" dir="auto">
                                        {jobTitle}
                                    </p>
                                ) : null}
                                {specialty ? (
                                    <p className={`text-xs font-semibold mb-4 ${muted(dark)}`} dir="auto">
                                        {specialty}
                                    </p>
                                ) : null}

                                {instructor.experienceYears ? (
                                    <p className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full mb-4 ${dark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                                        <Clock size={13} className="text-brand-gold" />
                                        {formatNumber(instructor.experienceYears, locale)} {t('instructorProfile.years_suffix')}
                                    </p>
                                ) : instructor.isProfileIncomplete ? (
                                    <p className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full mb-4 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
                                        <Briefcase size={13} /> {t('instructorProfile.profile_incomplete')}
                                    </p>
                                ) : null}

                                <p className={`text-sm font-semibold mb-6 ${muted(dark)}`}>
                                    {t('profile.member_since')} {formatDate(instructor.joinedAt, { locale })}
                                </p>

                                <div className="flex items-center gap-3 w-full">
                                    <div className={`flex-1 rounded-2xl py-3 text-center ${dark ? 'bg-white/5' : 'bg-brand-mist/60'}`}>
                                        <p className={`text-xl font-black ${title(dark)}`}>{formatNumber(instructor.courseCount, locale)}</p>
                                        <p className={`text-xs font-bold flex items-center justify-center gap-1 ${muted(dark)}`}>
                                            <BookOpen size={13} className="text-brand-gold" /> {t('instructorProfile.courses_suffix')}
                                        </p>
                                    </div>
                                    <div className={`flex-1 rounded-2xl py-3 text-center ${dark ? 'bg-white/5' : 'bg-brand-mist/60'}`}>
                                        <p className={`text-xl font-black ${title(dark)}`}>{formatNumber(instructor.openingCount, locale)}</p>
                                        <p className={`text-xs font-bold flex items-center justify-center gap-1 ${muted(dark)}`}>
                                            <Users size={13} className="text-brand-gold" /> {t('instructorProfile.cohorts_suffix')}
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}

                    {instructors?.length === 0 && (
                        <div className={`col-span-full py-16 text-center rounded-3xl border text-lg ${dark ? 'bg-brand-navy-dark border-white/10 text-gray-400' : 'bg-white border-gray-200 text-gray-600'}`}>
                            {t('instructorProfile.empty')}
                        </div>
                    )}
                </div>
            )}

            {user?.role !== 'INSTRUCTOR' && (
            <div className={`mt-12 rounded-3xl border p-8 text-center ${dark ? 'bg-white/5 border-white/10' : 'bg-brand-mist/40 border-gray-200'}`}>
                <h2 className={`text-xl font-black mb-2 ${title(dark)}`}>
                    {t('instructorProfile.cta_title')}
                </h2>
                <p className={`mb-6 ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {t('instructorProfile.cta_subtitle')}
                </p>
                <Link href="/join-as-instructor" className="inline-flex items-center gap-2 bg-brand-gold text-brand-navy-dark px-8 py-3.5 rounded-xl font-black hover:bg-brand-gold-light transition">
                    <GraduationCap size={18} /> {t('instructorProfile.cta_button')}
                </Link>
            </div>
            )}
        </MarketingShell>
    );
}
