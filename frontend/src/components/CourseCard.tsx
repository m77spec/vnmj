"use client";

import { useState } from 'react';
import Link from 'next/link';
import {
    BookOpen,
    Bell,
    CheckCircle2,
    ChevronDown,
    Clock,
    Eye,
    Layers,
    Lock,
    PlayCircle,
    Radio,
    Sparkles,
    Star,
    Unlock,
    Users,
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';
import { formatNumber, formatPrice } from '@/lib/format';
import { useI18n } from '@/lib/i18n-context';

export interface PublicOpening {
    id: string;
    status?: string | null;
    price: string;
    currency?: string;
    /** Struck through on the card when the opening is discounted. */
    priceOld?: string | null;
}

export interface OutlineLesson {
    id: string;
    titleAr: string;
    titleEn: string;
    orderIndex: number;
    durationMinutes?: number | null;
    /** Public syllabus: the topics the lesson covers, for the visitor. */
    outcomes?: { descriptionAr?: string | null; descriptionEn?: string | null }[] | null;
}

export interface OutlineChapter {
    id: string | null;
    titleAr?: string | null;
    titleEn?: string | null;
    lessons: OutlineLesson[];
}

export interface PublicCourse {
    id: string;
    level?: string | null;
    contentType?: string | null;
    language?: string | null;
    coverImageUrl?: string | null;
    excerptAr?: string | null;
    excerptEn?: string | null;
    categoryAr?: string | null;
    categoryEn?: string | null;
    titleAr?: string | null;
    titleEn?: string | null;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    durationAr?: string | null;
    durationEn?: string | null;
    openings?: PublicOpening[];
    outline?: OutlineChapter[];
    _count?: { enrollments?: number; modules?: number };
    /** Mean of published CourseReview rows, 0 when nobody has reviewed yet. */
    averageRating?: number;
    reviewCount?: number;
    enrollmentStatus?: string;
}

interface CourseCardProps {
    course: PublicCourse;
    isDark?: boolean;
    /** Omit to render a single "view details" call to action. */
    onEnroll?: (course: PublicCourse) => void;
    onReserve?: (course: PublicCourse) => void;
    onNotify?: (course: PublicCourse) => void;
    /** The home page renders fewer, taller cards. */
    variant?: 'default' | 'featured';
    className?: string;
    learningPathNames?: string[];
}

const CHAPTERS_PREVIEW = 3;
const LESSONS_PREVIEW = 3;

export default function CourseCard({
    course,
    isDark = false,
    onEnroll,
    onReserve,
    onNotify,
    variant = 'default',
    className = '',
    learningPathNames = [],
}: CourseCardProps) {
    const { t, pick, locale } = useI18n();
    // The outline is depth, not hook: the card has to answer what/for/how-much
    // in a glance, so the syllabus stays one tap away.
    const [outlineOpen, setOutlineOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const openOpening = course.openings?.find(o => o.status === 'OPEN');
    const announcedOpening = course.openings?.find(o => o.status === 'ANNOUNCEMENT');
    const current = openOpening ?? announcedOpening;
    const isOpen = !!openOpening;
    const announced = !isOpen && !!announcedOpening;
    const closed = !isOpen && !announced && (course.openings?.length ?? 0) > 0;

    const levelLabel = t(`course.level_${String(course.level || 'BEGINNER').toLowerCase()}`);
    // A course created before the content type existed has none, so the badge is
    // skipped rather than guessed at -- the two are not interchangeable and a
    // wrong badge on the sales page is worse than no badge.
    const contentType = course.contentType;
    const isLive = contentType === undefined || contentType === null
        ? undefined
        : contentType === 'LIVE';
    const price = current
        ? (Number(current.price) === 0 ? t('course.free') : formatPrice(current.price, { currency: current.currency, locale }))
        : t('courseDetail.not_open_yet');
    const discounted = !!current && !!current.priceOld && Number(current.priceOld) > Number(current.price);
    const oldPrice = discounted ? formatPrice(current!.priceOld!, { currency: current!.currency, locale }) : null;

    const reviewCount = course.reviewCount ?? 0;
    const averageRating = course.averageRating ?? 0;
    const studentCount = course._count?.enrollments ?? 0;
    const enrollmentStatus = course.enrollmentStatus;
    const enrollmentMessage = enrollmentStatus === 'APPROVED'
        ? t('explore.enrollment_approved')
        : enrollmentStatus === 'PENDING'
            ? t('explore.enrollment_pending')
            : enrollmentStatus === 'LOADING'
                ? t('explore.enrollment_loading')
            : enrollmentStatus === 'RESERVED'
                ? t('explore.enrollment_reserved')
                : enrollmentStatus === 'REJECTED'
                    ? t('explore.enrollment_rejected')
                    : enrollmentStatus === 'REVOKED'
                        ? t('explore.enrollment_revoked')
                        : null;
    const hasEnrollment = !!enrollmentMessage;

    const outline = course.outline ?? [];
    const chapters = outline.filter(c => c.lessons.length > 0);
    const totalLessons = chapters.reduce((sum, c) => sum + c.lessons.length, 0);
    const visibleChapters = expanded ? chapters : chapters.slice(0, CHAPTERS_PREVIEW);
    const hiddenCount = chapters.length - visibleChapters.length;
    const hiddenLessons = hiddenCount > 0
        ? chapters.slice(CHAPTERS_PREVIEW).reduce((sum, c) => sum + c.lessons.length, 0)
        : 0;

    const count = (key: string, n: number) => t(key).replace('{n}', formatNumber(n, locale));
    const hasSecondCta = !hasEnrollment && (isOpen ? !!onEnroll : announced ? !!onReserve : closed && !!onNotify);

    return (
        <article
            className={`group flex h-full flex-col overflow-hidden rounded-3xl border transition-all duration-300 animate-fade-in-up hover:-translate-y-1 ${
                isDark
                    ? 'border-line bg-surface hover:border-brand-gold/30 hover:shadow-2xl hover:shadow-black/30'
                    : 'border-brand-mist/70 bg-surface-raised shadow-sm hover:border-brand-gold/40 hover:shadow-2xl hover:shadow-brand-navy/10'
            } ${className}`}
        >
            {/* Cover */}
            <Link href={`/courses/${course.id}`} className={`relative block overflow-hidden ${variant === 'featured' ? 'h-56' : 'h-52'}`}>
                {course.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={`${API_BASE_URL}${course.coverImageUrl}`}
                        alt={pick(course, 'title') || ''}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-brand-navy via-brand-navy/90 to-brand-mist">
                        <BookOpen size={variant === 'featured' ? 44 : 52} className="mb-2 text-accent opacity-60 transition-transform duration-500 group-hover:scale-110" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-brand-navy/55 via-transparent to-transparent opacity-70 transition-opacity group-hover:opacity-90" aria-hidden />
                <span className="absolute end-4 top-4 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-black text-accent shadow-lg backdrop-blur-sm flex items-center gap-1.5">
                    {oldPrice && (
                        <s className="text-[11px] font-bold text-ink-subtle">{oldPrice}</s>
                    )}
                    {price}
                </span>
                <div className="absolute bottom-3 start-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-black shadow-sm backdrop-blur-sm ${isDark ? 'border border-line bg-black/40 text-ink' : 'bg-surface-raised text-ink'}`}>
                        {levelLabel}
                    </span>
                    {isLive !== undefined && (
                        <span className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black shadow-sm backdrop-blur-sm ${isLive
                            ? 'bg-red-700 text-ink-inverse'
                            : 'bg-brand-navy text-ink-inverse'}`}>
                            {isLive ? <Radio size={12} /> : <PlayCircle size={12} />}
                            {isLive ? t('course.content_type_live') : t('course.content_type_recorded')}
                        </span>
                    )}
                    {isOpen && (
                        <span className="flex items-center gap-1 rounded-full bg-green-700 px-3 py-1 text-xs font-black text-ink-inverse shadow-sm">
                            <CheckCircle2 size={12} /> {t('statuses.open')}
                        </span>
                    )}
                    {announced && (
                        <span className="flex items-center gap-1 rounded-full bg-brand-gold px-3 py-1 text-xs font-black text-ink-on-gold shadow-sm">
                            <Sparkles size={12} /> {t('explore.announced_pill')}
                        </span>
                    )}
                    {closed && (
                        <span className="flex items-center gap-1 rounded-full bg-gray-600 px-3 py-1 text-xs font-black text-white shadow-sm">
                            <Lock size={12} /> {t('explore.closed_pill')}
                        </span>
                    )}
                </div>
            </Link>

            {/* Body */}
            <div className="flex flex-1 flex-col p-6">
                {(learningPathNames.length > 0 || course.language) && (
                    <div className="mb-2.5 flex flex-wrap gap-2">
                        {learningPathNames.map((name, index) => (
                            <span key={`${name}-${index}`} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isDark ? 'bg-brand-gold/15 text-gold-ink' : 'bg-brand-gold/10 text-gold-ink'}`}>
                                {name}
                            </span>
                        ))}
                        {course.language && (
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${isDark ? 'bg-ink/[0.04] text-ink-muted' : 'bg-surface-sunken text-ink-subtle'}`}>
                                {course.language}
                            </span>
                        )}
                    </div>
                )}

                <Link href={`/courses/${course.id}`}>
                    <h3 className={`mb-2 line-clamp-2 text-xl font-black leading-snug transition-colors ${isDark ? 'text-ink group-hover:text-accent' : 'text-ink group-hover:text-ink'}`}>
                        {pick(course, 'title')}
                    </h3>
                </Link>
                <p className={`mb-4 line-clamp-2 text-sm leading-relaxed 'text-ink-subtle'`}>
                    {pick(course, 'excerpt') || pick(course, 'description')}
                </p>

                {/* ★ rating · N reviews · N students */}
                <div className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-bold 'text-ink-subtle'`}>
                    {reviewCount > 0 && (
                        <span className="inline-flex items-center gap-1" title={t('explore.rating_title')}>
                            <span className="inline-flex items-center gap-0.5" aria-hidden>
                                {[1, 2, 3, 4, 5].map(star => (
                                    <Star
                                        key={star}
                                        size={13}
                                        className={star <= Math.round(averageRating)
                                            ? 'fill-brand-gold text-accent'
                                            : isDark ? 'text-ink-subtle' : 'text-ink-muted'}
                                    />
                                ))}
                            </span>
                            <span className={isDark ? 'text-ink-muted' : 'text-ink'}>{averageRating.toFixed(1)}</span>
                            <span>({formatNumber(reviewCount, locale)})</span>
                        </span>
                    )}
                    {totalLessons > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                            <BookOpen size={14} className={'text-accent'} />
                            {count('explore.outline_lessons_count', totalLessons)}
                        </span>
                    )}
                    {pick(course, 'duration') && (
                        <span className="inline-flex items-center gap-1.5">
                            <Clock size={14} className={'text-accent'} />
                            {pick(course, 'duration')}
                        </span>
                    )}
                    {studentCount > 0 && (
                        <span className="inline-flex items-center gap-1.5">
                            <Users size={14} className={'text-accent'} />
                            {formatNumber(studentCount, locale)} {t('explore.students')}
                        </span>
                    )}
                </div>

                {/* Course outline (محاور الدورة) — hidden until asked for */}
                {chapters.length > 0 && (
                    <div className={`mb-5 overflow-hidden rounded-2xl border ${isDark ? 'border-line bg-ink/[0.024]' : 'border-brand-mist/80 bg-brand-white'}`}>
                        <button
                            type="button"
                            onClick={() => setOutlineOpen(v => !v)}
                            aria-expanded={outlineOpen}
                            className={`flex w-full items-center gap-2 px-4 py-2.5 text-start transition-colors cursor-pointer 'hover:bg-ink/[0.04]'`}
                        >
                            <Layers size={15} className={'text-accent'} />
                            <span className={`text-xs font-black uppercase tracking-wide 'text-ink'`}>
                                {t('explore.outline_heading')}
                            </span>
                            <span className={`ms-auto rounded-full px-2 py-0.5 text-[10px] font-black ${isDark ? 'bg-ink/[0.04] text-ink-muted' : 'bg-ink/[0.07] text-ink-muted'}`}>
                                {count('explore.outline_chapters_count', chapters.length)}
                            </span>
                            <ChevronDown size={15} className={`shrink-0 transition-transform duration-300 ${outlineOpen ? 'rotate-180' : ''} 'text-ink-subtle'`} />
                        </button>

                        {outlineOpen && (
                            <>
                        <ul className="divide-y border-t px-4 py-1">
                            {visibleChapters.map((chapter, ci) => {
                                const lessons = expanded ? chapter.lessons : chapter.lessons.slice(0, LESSONS_PREVIEW);
                                const restCount = chapter.lessons.length - lessons.length;
                                const title = chapter.titleAr || chapter.titleEn;
                                return (
                                    <li key={chapter.id || `flat-${ci}`} className="py-2.5">
                                        {title && (
                                            <div className="flex items-center gap-2">
                                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-black ${isDark ? 'bg-brand-gold/20 text-gold-ink' : 'bg-brand-gold/15 text-gold-ink'}`}>
                                                    {formatNumber(ci + 1, locale)}
                                                </span>
                                                <span className={`text-[13px] font-bold leading-snug ${isDark ? 'text-ink-subtle' : 'text-ink'}`}>
                                                    {pick(chapter, 'title')}
                                                </span>
                                            </div>
                                        )}
                                        <ul className="mt-1.5 space-y-1 ps-7">
                                            {lessons.map((lesson) => (
                                                <li key={lesson.id} className={`flex items-start gap-2 text-[12px] leading-snug 'text-ink-subtle'`}>
                                                    <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${isDark ? 'bg-gray-600' : 'bg-surface-sunken'}`} aria-hidden />
                                                    <span className="flex-1">{pick(lesson, 'title')}</span>
                                                    {/* No preview/lock marks: the syllabus is the
                                                        sales pitch, and a padlock next to every
                                                        lesson taught visitors that the course was
                                                        mostly closed to them. */}
                                                    {(lesson.outcomes?.length ?? 0) > 0 && (
                                                        <span className="shrink-0 text-[10px] font-bold opacity-70">{count('explore.outline_topics', lesson.outcomes!.length)}</span>
                                                    )}
                                                </li>
                            ))}
                                            {restCount > 0 && (
                                                <li className={`text-[11px] font-bold 'text-ink-subtle'`}>
                                                    {count('explore.outline_more_lessons', restCount)}
                                                </li>
                                            )}
                                        </ul>
                                    </li>
                                );
                            })}
                        </ul>

                        {(hiddenCount > 0 || expanded) && (
                            <button
                                type="button"
                                onClick={() => setExpanded(v => !v)}
                                className={`flex w-full items-center justify-center gap-1.5 border-t py-2.5 text-[11px] font-black transition-colors cursor-pointer ${isDark ? 'border-line text-accent hover:bg-ink/[0.04]' : 'border-brand-mist/80 text-gold-ink hover:bg-brand-gold/5'}`}
                            >
                                {expanded
                                    ? t('explore.outline_hide')
                                    : `${t('explore.outline_show')} (+${formatNumber(hiddenLessons, locale)})`}
                                <ChevronDown size={14} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                        )}
                            </>
                        )}
                    </div>
                )}

                {/* Calls to action */}
                <div className={`mt-auto grid gap-3 ${hasSecondCta ? 'grid-cols-1 min-[420px]:grid-cols-2' : 'grid-cols-1'}`}>
                    <Link
                        href={`/courses/${course.id}`}
                        className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all ${
                            isDark
                                ? 'border border-line text-ink-muted hover:border-brand-gold/40 hover:bg-ink/[0.04] hover:text-ink'
                                : 'border-2 border-brand-mist text-ink hover:border-brand-navy hover:bg-surface hover:text-ink'
                        }`}
                    >
                        <Eye size={16} /> {t('explore.view_details')}
                    </Link>
                    {hasEnrollment && (
                        <div
                            role="status"
                            className={`flex items-center justify-center gap-2 rounded-xl border py-3.5 text-center text-sm font-black ${
                                enrollmentStatus === 'APPROVED' || enrollmentStatus === 'RESERVED'
                                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : enrollmentStatus === 'REJECTED' || enrollmentStatus === 'REVOKED'
                                        ? 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'
                                        : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            }`}
                        >
                            {enrollmentStatus === 'APPROVED' || enrollmentStatus === 'RESERVED'
                                ? <CheckCircle2 size={16} />
                                : <Clock size={16} />}
                            {enrollmentMessage}
                        </div>
                    )}
                    {!hasEnrollment && isOpen && onEnroll && (
                        <button
                            type="button"
                            onClick={() => onEnroll(course)}
                            className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold shadow-md transition-all cursor-pointer ${
                                isDark
                                    ? 'bg-brand-gold text-ink-on-gold shadow-brand-gold/25 hover:bg-brand-gold-light'
                                    : 'bg-surface text-ink-on-gold shadow-brand-navy/20 hover:bg-brand-charcoal'
                            }`}
                        >
                            <Sparkles size={16} /> {t('explore.enroll_now')}
                        </button>
                    )}
                    {!hasEnrollment && announced && onReserve && (
                        <button
                            type="button"
                            onClick={() => onReserve(course)}
                            className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all cursor-pointer ${
                                isDark
                                    ? 'border border-brand-gold/40 text-ink-on-gold hover:bg-brand-gold hover:text-ink-on-gold'
                                    : 'border-2 border-brand-gold/50 text-ink-on-gold hover:bg-brand-gold'
                            }`}
                        >
                            <Unlock size={16} /> {t('courseDetail.reserve_seat')}
                        </button>
                    )}
                    {!hasEnrollment && closed && onNotify && (
                        <button
                            type="button"
                            onClick={() => onNotify(course)}
                            className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all cursor-pointer ${
                                isDark
                                    ? 'border border-line text-ink hover:border-brand-gold/40 hover:bg-ink/[0.04]'
                                    : 'border-2 border-brand-mist text-ink hover:border-brand-navy hover:bg-surface'
                            }`}
                        >
                            <Bell size={16} /> {t('explore.notify_me')}
                        </button>
                    )}
                    {!hasEnrollment && !isOpen && !announced && !onNotify && (
                        <span className={`rounded-xl py-3.5 text-center text-sm font-bold ${isDark ? 'bg-ink/[0.04] text-ink-muted' : 'bg-surface-sunken text-ink-subtle'}`}>
                            {t('courseDetail.not_open_yet')}
                        </span>
                    )}
                </div>
            </div>
        </article>
    );
}
