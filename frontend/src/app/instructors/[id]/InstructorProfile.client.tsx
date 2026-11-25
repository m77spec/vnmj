"use client";

import Link from 'next/link';
import { BookOpen, Users, Eye, ArrowLeft, Briefcase, GraduationCap, Clock, UserRound, Award, Languages, Link2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import MarketingShell from '@/components/MarketingShell';
import { useFetchData } from '@/lib/useFetchData';
import { API_BASE_URL } from '@/lib/api';
import { formatNumber, formatDate, formatPrice } from '@/lib/format';
import type { PublicInstructorCard } from '@/lib/public-instructor';

interface PublicOpening {
    id: string;
    price: string;
    currency?: string;
    priceOld?: string | null;
    status?: string | null;
}

interface PublicCourse {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    excerptAr?: string | null;
    excerptEn?: string | null;
    coverImageUrl?: string | null;
    categoryAr?: string | null;
    categoryEn?: string | null;
    level?: string | null;
    createdAt?: string;
    openings?: PublicOpening[];
    _count?: { enrollments?: number };
}

/**
 * The public instructor profile, mirroring the backend `PublicInstructor` shape
 * plus the courses it is nested with.
 *
 * This interface used to declare `email: string` as required while the endpoint
 * deliberately withheld it, so `profile.email.charAt(0)` threw and the page
 * rendered nothing.
 */
interface PublicInstructorProfile extends PublicInstructorCard {
    joinedAt: string | null;
    courseCount: number;
    courses: PublicCourse[];
}

export default function InstructorProfileContent({ id }: { id: string }) {
    const { locale, t, pick } = useI18n();
    const { dark } = useTheme();
    const { data: profile, loading, error } = useFetchData<PublicInstructorProfile>(
        `/public/instructors/${encodeURIComponent(id)}`,
    );

    const levelLabel = (lvl?: string | null) => t(`course.level_${String(lvl || 'BEGINNER').toLowerCase()}`);
    const currentOpening = (course: PublicCourse): PublicOpening | undefined =>
        course.openings?.find((o) => o.status === 'OPEN') ?? course.openings?.find((o) => o.status === 'ANNOUNCEMENT');

    const card = (dark_: boolean) =>
        dark_
            ? 'bg-brand-navy-dark border-white/10'
            : 'bg-white border-gray-200';
    const title = (dark_: boolean) => (dark_ ? 'text-white' : 'text-brand-navy');
    const muted = (dark_: boolean) => (dark_ ? 'text-gray-400' : 'text-gray-600');

    if (loading) {
        return (
            <MarketingShell title={t('instructorProfile.heading')}>
                <div className="flex justify-center p-12 text-brand-gold font-bold text-xl">
                    {t('instructorProfile.loading')}
                </div>
            </MarketingShell>
        );
    }

    if (error || !profile) {
        return (
            <MarketingShell title={t('instructorProfile.heading')}>
                <div className={`p-6 rounded-2xl font-semibold text-center ${dark ? 'bg-red-500/10 border border-red-400/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                    {error || t('instructorProfile.not_found')}
                </div>
                <div className="mt-6 text-center">
                    <Link href="/instructors" className={`inline-flex items-center gap-2 text-sm font-bold transition ${muted(dark)}`}>
                        <ArrowLeft size={16} className="rtl:rotate-180" /> {t('instructorProfile.back')}
                    </Link>
                </div>
            </MarketingShell>
        );
    }

    const name = pick(profile, 'name');
    const jobTitle = pick(profile, 'jobTitle');
    const bio = pick(profile, 'bio');
    const specialty = pick(profile, 'specialty');
    const initial = (name || '?').trim().charAt(0).toUpperCase();

    /**
     * The structured sections are bilingual as a whole, not per field: an
     * experience reads as `role`/`organisation` in whichever language it was
     * written in, so the list is filtered by what actually has content rather
     * than re-keyed on read.
     */
    const bilingualOf = (value: { ar?: string | null; en?: string | null } | null | undefined): string | undefined => {
        if (!value) return undefined;
        const text = (locale === 'en' ? value.en || value.ar : value.ar || value.en) || '';
        return text.trim() || undefined;
    };

    const subjectBadges = (profile.specialties ?? [])
        .map(bilingualOf)
        .filter((s): s is string => Boolean(s));

    const experiences = profile.experiences ?? [];
    const qualifications = profile.qualifications ?? [];
    const languages = profile.languages ?? [];
    const certificates = profile.certificates ?? [];
    // The backend already guarantees https and strips credentials, but the value
    // is rendered into an `href`, so the check is repeated here: this component
    // must never be the reason a `javascript:` URL reaches a student.
    const links = (profile.links ?? []).filter((l) => {
        try {
            return new URL(l.url).protocol === 'https:' && !/^https?:\/\/[^/@]*@/i.test(l.url);
        } catch {
            return false;
        }
    });

    const hasDetails =
        Boolean(bio || jobTitle || specialty) ||
        subjectBadges.length > 0 ||
        experiences.length > 0 ||
        qualifications.length > 0 ||
        languages.length > 0 ||
        certificates.length > 0 ||
        links.length > 0;

    return (
        <MarketingShell title={name || t('instructorProfile.heading')}>
            <div className="space-y-10">
                {/* Hero */}
                <div className={`rounded-3xl border shadow-sm p-8 ${card(dark)}`}>
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                        {profile.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={`${API_BASE_URL}${profile.avatarUrl}`}
                                alt={name}
                                className="w-24 h-24 rounded-3xl object-cover shrink-0 border border-brand-gold/30"
                            />
                        ) : (
                            <div className="w-24 h-24 bg-brand-navy rounded-3xl flex items-center justify-center text-brand-gold text-4xl font-black shrink-0">
                                {initial}
                            </div>
                        )}
                        <div className="flex-1 text-center sm:text-left min-w-0">
                            <h1 className={`font-black text-2xl sm:text-3xl break-words ${title(dark)}`} dir="auto">
                                {name || t('instructorProfile.heading')}
                            </h1>
                            {jobTitle ? (
                                <p className="text-base font-bold text-brand-gold-dark dark:text-brand-gold-light mt-1" dir="auto">
                                    {jobTitle}
                                </p>
                            ) : null}
                            <p className={`text-sm font-semibold mt-2 ${muted(dark)}`}>
                                {t('profile.member_since')} {formatDate(profile.joinedAt, { locale })}
                            </p>

                            {subjectBadges.length > 0 && (
                                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-4">
                                    {subjectBadges.map((subject, i) => (
                                        <span
                                            key={i}
                                            className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
                                                dark
                                                    ? 'text-brand-gold-light bg-brand-gold/10'
                                                    : 'text-brand-gold-dark bg-brand-gold/10'
                                            }`}
                                            dir="auto"
                                        >
                                            <GraduationCap size={13} /> {subject}
                                        </span>
                                    ))}
                                </div>
                            )}

                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-5">
                                <div className={`rounded-2xl py-3 px-6 text-center ${dark ? 'bg-white/5' : 'bg-brand-mist/60'}`}>
                                    <p className={`text-xl font-black ${title(dark)}`}>{formatNumber(profile.courseCount, locale)}</p>
                                    <p className={`text-xs font-bold flex items-center justify-center gap-1 ${muted(dark)}`}>
                                        <BookOpen size={13} className="text-brand-gold" /> {t('instructorProfile.courses_suffix')}
                                    </p>
                                </div>
                                {profile.experienceYears ? (
                                    <div className={`rounded-2xl py-3 px-6 text-center ${dark ? 'bg-white/5' : 'bg-brand-mist/60'}`}>
                                        <p className={`text-xl font-black ${title(dark)}`}>{formatNumber(profile.experienceYears, locale)}</p>
                                        <p className={`text-xs font-bold flex items-center justify-center gap-1 ${muted(dark)}`}>
                                            <Clock size={13} className="text-brand-gold" /> {t('instructorProfile.years_suffix')}
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>

                {/* CV */}
                {hasDetails ? (
                    <div className={`rounded-3xl border shadow-sm p-8 ${card(dark)}`}>
                        <h2 className={`text-xl font-black mb-4 flex items-center gap-2 ${title(dark)}`}>
                            <Briefcase size={20} className="text-brand-gold" />
                            {t('instructorProfile.cv_heading')}
                        </h2>
                        {subjectBadges.length === 0 && specialty ? (
                            <p className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-gold-dark dark:text-brand-gold-light bg-brand-gold/10 px-3 py-1.5 rounded-full mb-4" dir="auto">
                                <GraduationCap size={14} /> {specialty}
                            </p>
                        ) : null}
                        {bio ? (
                            <p className={`text-sm leading-relaxed whitespace-pre-line ${muted(dark)}`} dir="auto">
                                {bio}
                            </p>
                        ) : null}
                    </div>
                ) : profile.isProfileIncomplete ? (
                    <div className={`rounded-3xl border border-dashed p-6 text-center text-sm font-semibold ${dark ? 'border-white/10 text-gray-400' : 'border-gray-300 text-gray-500'}`}>
                        <UserRound size={22} className="mx-auto mb-2 opacity-50" />
                        {t('instructorProfile.not_filled')}
                    </div>
                ) : null}

                {/* Experience */}
                {experiences.length > 0 && (
                    <section className={`rounded-3xl border shadow-sm p-8 ${card(dark)}`}>
                        <h2 className={`text-xl font-black mb-6 flex items-center gap-2 ${title(dark)}`}>
                            <Briefcase size={20} className="text-brand-gold" />
                            {t('instructorProfile.sections_experience')}
                        </h2>
                        <ol className="relative space-y-6 ps-6 border-s-2 border-brand-gold/20">
                            {experiences.map((item, i) => (
                                <li key={i} className="relative">
                                    <span className="absolute -start-[1.65rem] top-1.5 w-3 h-3 rounded-full bg-brand-gold border-2 border-brand-navy dark:border-brand-navy-dark" />
                                    <div className="flex flex-wrap items-baseline gap-x-2">
                                        <h3 className={`font-bold ${title(dark)}`} dir="auto">{item.role}</h3>
                                        {item.organisation ? (
                                            <span className={`text-sm font-semibold ${muted(dark)}`} dir="auto">{item.organisation}</span>
                                        ) : null}
                                    </div>
                                    {(item.from || item.to) && (
                                        <p className={`text-xs font-bold mt-1 ${dark ? 'text-brand-gold-light' : 'text-brand-gold-dark'}`} dir="ltr">
                                            {[item.from, item.to].filter(Boolean).join(' – ')}
                                        </p>
                                    )}
                                    {item.description ? (
                                        <p className={`text-sm leading-relaxed mt-2 whitespace-pre-line ${muted(dark)}`} dir="auto">
                                            {item.description}
                                        </p>
                                    ) : null}
                                </li>
                            ))}
                        </ol>
                    </section>
                )}

                {/* Qualifications + certificates */}
                {qualifications.length > 0 && (
                    <section className={`rounded-3xl border shadow-sm p-8 ${card(dark)}`}>
                        <h2 className={`text-xl font-black mb-6 flex items-center gap-2 ${title(dark)}`}>
                            <GraduationCap size={20} className="text-brand-gold" />
                            {t('instructorProfile.sections_qualifications')}
                        </h2>
                        <ul className="grid sm:grid-cols-2 gap-4">
                            {qualifications.map((item, i) => (
                                <li key={i} className={`rounded-2xl p-5 ${dark ? 'bg-white/5' : 'bg-brand-mist/50'}`}>
                                    <p className={`font-bold ${title(dark)}`} dir="auto">{item.degree}</p>
                                    {item.field ? (
                                        <p className={`text-sm font-semibold mt-1 ${muted(dark)}`} dir="auto">{item.field}</p>
                                    ) : null}
                                    {(item.institution || item.year) && (
                                        <p className={`text-xs mt-2 ${dark ? 'text-gray-500' : 'text-gray-500'}`} dir="auto">
                                            {[item.institution, item.year].filter(Boolean).join(' · ')}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {certificates.length > 0 && (
                    <section className={`rounded-3xl border shadow-sm p-8 ${card(dark)}`}>
                        <h2 className={`text-xl font-black mb-6 flex items-center gap-2 ${title(dark)}`}>
                            <Award size={20} className="text-brand-gold" />
                            {t('instructorProfile.sections_certificates')}
                        </h2>
                        <ul className="space-y-3">
                            {certificates.map((item, i) => (
                                <li
                                    key={i}
                                    className={`flex flex-wrap items-baseline gap-x-2 rounded-2xl px-5 py-4 ${dark ? 'bg-white/5' : 'bg-brand-mist/50'}`}
                                >
                                    <span className={`font-bold ${title(dark)}`} dir="auto">{item.title}</span>
                                    {[item.issuer, item.year].filter(Boolean).length > 0 && (
                                        <span className={`text-xs ${muted(dark)}`} dir="auto">
                                            {[item.issuer, item.year].filter(Boolean).join(' · ')}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* Languages */}
                {languages.length > 0 && (
                    <section className={`rounded-3xl border shadow-sm p-8 ${card(dark)}`}>
                        <h2 className={`text-xl font-black mb-6 flex items-center gap-2 ${title(dark)}`}>
                            <Languages size={20} className="text-brand-gold" />
                            {t('instructorProfile.sections_languages')}
                        </h2>
                        <div className="flex flex-wrap gap-2.5">
                            {languages.map((item, i) => (
                                <span
                                    key={i}
                                    className={`text-sm font-bold px-3.5 py-2 rounded-full ${dark ? 'bg-white/5 text-gray-300' : 'bg-gray-100 text-brand-navy'}`}
                                    dir="auto"
                                >
                                    {item.name}
                                    {item.proficiency ? <span className={`ms-1.5 font-semibold ${muted(dark)}`}>· {item.proficiency}</span> : null}
                                </span>
                            ))}
                        </div>
                    </section>
                )}

                {/* Links */}
                {links.length > 0 && (
                    <section className={`rounded-3xl border shadow-sm p-8 ${card(dark)}`}>
                        <h2 className={`text-xl font-black mb-6 flex items-center gap-2 ${title(dark)}`}>
                            <Link2 size={20} className="text-brand-gold" />
                            {t('instructorProfile.sections_links')}
                        </h2>
                        <ul className="grid sm:grid-cols-2 gap-3">
                            {links.map((item, i) => (
                                <li key={i}>
                                    <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer nofollow"
                                        className={`flex items-center gap-2 rounded-2xl px-5 py-4 font-bold text-sm transition ${
                                            dark
                                                ? 'bg-white/5 text-gray-200 hover:bg-brand-gold hover:text-black'
                                                : 'bg-gray-50 text-brand-navy hover:bg-brand-gold hover:text-black'
                                        }`}
                                        dir="auto"
                                    >
                                        <Link2 size={15} className="shrink-0 opacity-70" />
                                        <span className="truncate">{item.label}</span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* Courses */}
                <div>
                    <h2 className={`text-2xl font-black mb-6 ${title(dark)}`}>
                        {t('instructorProfile.courses_heading')}
                    </h2>
                    {profile.courses.length === 0 ? (
                        <div className={`py-14 text-center rounded-3xl border text-lg ${dark ? 'bg-brand-navy-dark border-white/10 text-gray-400' : 'bg-white border-gray-200 text-gray-600'}`}>
                            {t('instructorProfile.no_courses')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                            {profile.courses.map((course) => (
                                <div key={course.id} className={`rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all flex flex-col group ${card(dark)}`}>
                                    <div className={`h-44 relative overflow-hidden border-b ${dark ? 'border-white/5' : 'border-gray-100'}`}>
                                        {course.coverImageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={`${API_BASE_URL}${course.coverImageUrl}`}
                                                alt={pick(course, 'title') || ''}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-brand-navy to-brand-navy-dark flex flex-col items-center justify-center">
                                                <BookOpen size={44} className="text-brand-gold mb-2 opacity-40" />
                                            </div>
                                        )}
                                        {currentOpening(course) && (
                                            <div className="absolute top-4 right-4 bg-brand-navy/90 backdrop-blur-sm px-4 py-1 rounded-full font-black text-brand-gold shadow-sm">
                                                {Number(currentOpening(course)!.price) === 0
                                                    ? t('course.free')
                                                    : formatPrice(currentOpening(course)!.price, { currency: currentOpening(course)!.currency, locale })}
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-6 flex-1 flex flex-col">
                                        {(pick(course, 'category') || course.level) && (
                                            <div className="flex flex-wrap gap-2 mb-2">
                                                {pick(course, 'category') && (
                                                    <span className={`text-xs font-black px-2.5 py-1 rounded-full ${dark ? 'text-brand-gold-light bg-brand-gold/15' : 'text-brand-gold-dark bg-brand-gold/10'}`}>{pick(course, 'category')}</span>
                                                )}
                                                {course.level && (
                                                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${dark ? 'text-gray-300 bg-white/10' : 'text-gray-600 bg-gray-100'}`}>{levelLabel(course.level)}</span>
                                                )}
                                            </div>
                                        )}
                                        <h3 className={`text-xl font-bold mb-2 line-clamp-2 ${title(dark)}`}>{pick(course, 'title')}</h3>
                                        <p className={`text-sm leading-relaxed mb-4 line-clamp-3 flex-1 ${muted(dark)}`}>
                                            {pick(course, 'excerpt')}
                                        </p>
                                        <div className={`flex items-center justify-between text-xs font-bold mb-5 ${muted(dark)}`}>
                                            <span className="flex items-center gap-1">
                                                <Users size={13} className="text-brand-gold" />
                                                {t('instructorProfile.course_students').replace('{n}', formatNumber(course._count?.enrollments ?? 0, locale))}
                                            </span>
                                        </div>
                                        <Link
                                            href={`/courses/${course.id}`}
                                            className={`py-3.5 border-2 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 ${dark ? 'border-white/10 text-white hover:border-brand-gold hover:text-brand-gold-light' : 'border-gray-200 text-brand-navy hover:border-brand-gold hover:text-brand-gold-dark'}`}
                                        >
                                            <Eye size={16} /> {t('explore.view_details')}
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <Link href="/instructors" className={`inline-flex items-center gap-2 text-sm font-bold transition ${muted(dark)}`}>
                    <ArrowLeft size={16} className="rtl:rotate-180" /> {t('instructorProfile.back')}
                </Link>
            </div>
        </MarketingShell>
    );
}
