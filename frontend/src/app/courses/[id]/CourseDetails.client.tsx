"use client";

import { startTransition, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, API_BASE_URL, getErrorMessage, isUnauthorized } from '@/lib/api';
import toast from 'react-hot-toast';
import {
    BookOpen, Clock, User, CheckCircle, Loader, Award, Users,
    CalendarDays, Globe, ChevronDown, GraduationCap, PlayCircle, MessagesSquare, ListChecks, Target,
    AlertTriangle, ClipboardList, Settings2, Radio
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { useFetchData } from '@/lib/useFetchData';
import { formatPrice, formatDate } from '@/lib/format';
import PublicMobileMenu from '@/components/PublicMobileMenu';
import CourseChat from '@/components/CourseChat';
import StudentTasksPanel from '@/components/StudentTasksPanel';
import StudentGradesPanel from '@/components/StudentGradesPanel';
import RosterGrades from '@/components/RosterGrades';
import TasksPanel from '@/components/TasksPanel';
import LessonExplorer from '@/components/LessonExplorer';
import PaymentMethods, { type PaymentGateway } from '@/components/payment/PaymentMethods';
import ReceiptDropzone from '@/components/payment/ReceiptDropzone';
import EnrollSteps from '@/components/payment/EnrollSteps';
import LoginPromptModal from '@/components/LoginPromptModal';
import type { PublicInstructorCard } from '@/lib/public-instructor';

export interface Module {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    videoUrl?: string | null;
    durationMinutes?: number | null;
    outcomes?: { descriptionAr?: string | null; descriptionEn?: string | null }[];
    files?: { url: string; nameAr?: string | null; nameEn?: string | null }[] | null;
    links?: { url: string; labelAr?: string | null; labelEn?: string | null }[] | null;
}

export interface Chapter {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    modules?: Module[] | null;
}

export interface Opening {
    id: string;
    status?: string | null;
    nameAr?: string | null;
    nameEn?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    enrollmentDeadline?: string | null;
    price: string;
    priceOld?: string | null;
    maxStudents?: number | null;
    instructor?: PublicInstructorCard | null;
    _count?: { enrollments?: number };
}

export interface Course {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    syllabusAr?: string | null;
    syllabusEn?: string | null;
    durationAr?: string | null;
    durationEn?: string | null;
    createdAt?: string | null;
    level?: string | null;
    language?: string | null;
    categoryAr?: string | null;
    categoryEn?: string | null;
    excerptAr?: string | null;
    excerptEn?: string | null;
    coverImageUrl?: string | null;
    introVideoUrl?: string | null;
    videoFileUrl?: string | null;
    hoursOfContent?: number | null;
    /**
     * LIVE: the lessons are Meet sessions on a schedule. RECORDED: the lessons
     * are videos. Missing on a payload from before the field existed, which is
     * read as live -- that is what the column defaults to.
     */
    contentType?: 'LIVE' | 'RECORDED' | null;
    certificateIssued?: boolean | null;
    quizzesIncluded?: boolean | null;
    projectsIncluded?: boolean | null;
    assignmentsIncluded?: boolean | null;
    liveSessionsIncluded?: boolean | null;
    downloadableResources?: boolean | null;
    lifetimeAccess?: boolean | null;
    communityAccess?: boolean | null;
    objectives?: { objectiveAr?: string | null; objectiveEn?: string | null }[];
    prerequisites?: { prerequisiteAr?: string | null; prerequisiteEn?: string | null }[];
    audiences?: { audienceAr?: string | null; audienceEn?: string | null }[];
    faqs?: { questionAr?: string | null; questionEn?: string | null; answerAr?: string | null; answerEn?: string | null }[];
    gallery?: { url: string }[];
    instructor?: PublicInstructorCard | null;
    openings?: Opening[];
    /**
     * What the signed-in viewer may do with this course, from the API. Absent
     * on the anonymous server render, which is why the page re-fetches with a
     * token once it knows who is asking.
     */
    viewerAccess?: {
        enrolled: boolean;
        approved: boolean;
        teaches: boolean;
        chatEnabled: boolean;
        openingId?: string | null;
        enrollmentStatus?: string | null;
    };
    modules?: Module[];
    chapters?: Chapter[];
    _count?: { enrollments?: number; modules?: number };
}

const SectionTitle = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => {
    return (
        <div className="flex flex-col gap-2 mb-5">
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center shrink-0 'text-gold-ink'`}>
                    {icon}
                </div>
                <h2 className={`text-xl md:text-2xl font-black 'text-ink'`}>{children}</h2>
            </div>
            <div className="w-12 h-1 bg-brand-gold/30 rounded-full ms-[52px]" />
        </div>
    );
};

export default function CourseDetailsPage({ initialCourse }: { initialCourse?: Course | null }) {
    const { id } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const { t, locale, pick } = useI18n();
    const { dark } = useTheme();
    // The hero is a navy panel that does not change with the theme, so its
    // tiles cannot use the page's own ink tokens: --ink is #1b2434 in the light
    // theme, which lands at roughly 1.2:1 on #0a1c35. White tints and the
    // theme-independent on-navy inks instead.
    const statCard = 'bg-white/[0.06] border border-white/15 rounded-2xl px-4 py-3 flex items-center gap-3 backdrop-blur-md hover:border-brand-gold/40 transition';
    const statIcon = 'w-9 h-9 rounded-xl bg-brand-gold/20 flex items-center justify-center text-brand-gold-light';
    const statValue = 'text-sm font-black text-ink-on-navy';
    // Caption above each value. The Latin treatment is small, bold, capped and
    // tracked-out; none of that transfers to Arabic, where letter-spacing opens
    // gaps between joined glyphs and `uppercase` is a no-op on a script with no
    // case. Arabic also needs the larger size -- at sm and up the Latin size is
    // 10px, too small to read in either script.
    const statCaption = locale === 'ar'
        ? 'text-xs font-bold text-ink-on-navy-muted'
        : 'text-[11px] sm:text-[10px] font-bold text-brand-gold-light uppercase tracking-wider';
    // Same reasoning for the filled gold pill, which carries Arabic course
    // duration ("20 يوم") rather than a Latin code.
    const pillCaption = locale === 'ar' ? 'font-black text-xs' : 'font-black text-xs uppercase tracking-wider';
    const [course, setCourse] = useState<Course | null>(initialCourse ?? null);
    const [loading, setLoading] = useState(!initialCourse);
    const [openFaq, setOpenFaq] = useState<number | null>(null);
    const [selectedOpening, setSelectedOpening] = useState<Opening | null>(null);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [loginRedirectTo, setLoginRedirectTo] = useState<string>(`/courses/${id}`);
    const handledIntent = useRef<string | null>(null);
    const [couponCode, setCouponCode] = useState('');
    const [coupon, setCoupon] = useState<{ name: string; amountOff: number; finalAmount: number } | null>(null);
    const [couponChecking, setCouponChecking] = useState(false);

    // --- Mode detection ---
    // Entitlement comes from the API, not from `openings.length`. The old
    // inference ("a live opening exists, therefore the signed-in student
    // belongs here") put every logged-in student in student mode on every
    // course, and dropped a real student back to guest whenever the batch they
    // were sitting in was filtered out of the anonymous render — which took
    // the chat, tasks and grades tabs with it.
    const isStudent = user?.role === 'STUDENT';
    const isInstructor = user?.role === 'INSTRUCTOR';
    const access = course?.viewerAccess;
    let mode: 'guest' | 'student' | 'instructor' = 'guest';
    if (access?.teaches) {
        mode = 'instructor';
    } else if (access?.enrolled) {
        mode = 'student';
    } else if (isInstructor) {
        // Older payloads (and any course the flag has not been computed for
        // yet) fall back to the previous best-effort check.
        mode = course?.openings?.some((o) => o.instructor?.id === user?.userId) ? 'instructor' : 'guest';
    } else if (isStudent && !access) {
        mode = (course?.openings?.length ?? 0) > 0 ? 'student' : 'guest';
    }
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [gatewayId, setGatewayId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    // The hero doubles as the trailer player, so the 1-2 minute intro is above
    // the fold instead of a section the visitor may never scroll to.
    const [showTrailer, setShowTrailer] = useState(false);
    const { data: gateways, loading: gatewaysLoading } = useFetchData<PaymentGateway[]>('/payment-gateways');
    const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'grades' | 'chat' | 'roster'>('overview');

    // Prefer the server's verdict; fall back to `mode` for a payload that
    // predates the flag so a signed-in user is never left without the tab.
    const chatAvailable = access ? access.chatEnabled : mode !== 'guest';

    // The sales page has to answer "will I be watching a video or sitting in a
    // meeting?" before the visitor enrols, so the whole page is dressed for the
    // format: a live course never shows hours of content, a play button over its
    // cover, or a per-lesson running time -- those all read as "pre-recorded"
    // even when the badge in the corner says otherwise.
    const isLiveCourse = course?.contentType !== 'RECORDED';
    const deliveryLabel = isLiveCourse
        ? t('createCourse.content_type_live')
        : t('createCourse.content_type_recorded');
    const durationText = pick(course, 'duration')
        || (isLiveCourse ? deliveryLabel : t('courseDetail.self_paced'));

    // A tab can stop being available while it is open — a signed-in viewer
    // whose own copy arrives without cohort access, for instance. Deriving the
    // tab that actually renders keeps that from stranding an empty panel
    // without writing state back from an effect.
    const tab = activeTab === 'chat' && !chatAvailable ? 'overview' : activeTab;

    // The batch whose work the instructor manages. `Course.instructorId` and
    // `CourseOpening.instructorId` are separate fields, so an instructor who
    // owns the course may own no batch at all — matching only on the batch's
    // instructor left `instructorOpeningId` null for them, which hid the tasks
    // and roster tabs entirely and read as "the assignment tools are missing".
    const instructorOpeningId = (() => {
        const openings = course?.openings ?? [];
        return openings.find(o => o.instructor?.id === user?.userId)?.id
            ?? (course?.instructor?.id === user?.userId ? openings[0]?.id : null)
            ?? null;
    })();

    // --- Tabs render ---
    const renderTabs = () => {
        const item = (key: typeof activeTab, icon: React.ReactNode, label: string) => (
            <button
                onClick={() => setActiveTab(key)}
                className={`relative inline-flex shrink-0 items-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer ${
                    tab === key
                        ? 'bg-brand-gold/15 text-gold-ink border border-brand-gold/25'
                        : dark ? 'text-gold-ink hover:text-ink hover:bg-ink/[0.04] border border-transparent' : 'text-gold-ink hover:text-ink hover:bg-surface-sunken border border-transparent'
                }`}
            >
                {icon}
                <span className="whitespace-nowrap">{label}</span>
                {tab === key && <span className={`absolute bottom-0 left-3 right-3 h-1 rounded-full ${dark ? 'bg-brand-gold-light' : 'bg-brand-gold-dark'}`} />}
            </button>
        );
        return (
            // The offset has to match the header exactly: it is now h-16 on a
            // phone and h-20 from `sm` up. A stale `top-20` slid the tab strip
            // under the header, clipping the top of the first tab.
            <div className="sticky top-16 sm:top-20 z-30 mb-6 sm:mb-8 -mx-4 sm:mx-0 px-4 sm:px-0">
                {/* One scrollable row instead of wrapping: with six tabs a phone
                    wrapped them onto three lines, which turned the sticky strip
                    into a wall that ate a third of the viewport. */}
                <div className={`inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border p-1.5 shadow-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${dark ? 'bg-surface-sunken backdrop-blur-md border-line shadow-black/20' : 'bg-surface-raised backdrop-blur-md border-line shadow-brand-navy/10'}`}>
                    {item('overview', <BookOpen size={18} />, t('courseDetail.tab_overview'))}
                    {mode === 'student' && item('tasks', <ClipboardList size={18} />, t('courseDetail.tab_tasks'))}
                    {mode === 'student' && item('grades', <GraduationCap size={18} />, t('courseDetail.tab_grades'))}
                    {/* Chat follows the API's own answer rather than `mode`:
                        a student who is approved but whose batch is closed still
                        has a cohort room to read, and a pending applicant has
                        none. `mode` alone hid the tab in the first case. */}
                    {chatAvailable && item('chat', <MessagesSquare size={18} />, t('courseDetail.tab_chat'))}
                    {mode === 'instructor' && item('tasks', <Settings2 size={18} />, t('courseDetail.tab_tasks'))}
                    {mode === 'instructor' && item('roster', <Settings2 size={18} />, t('courseDetail.tab_roster'))}
                </div>
            </div>
        );
    };

    useEffect(() => {
        if (!id) return;

        // The page is server-rendered from an anonymous fetch, so that payload
        // has no viewer: no `viewerAccess`, and no batches beyond the public
        // OPEN/ANNOUNCEMENT ones. A guest is fine with it, but a signed-in
        // student needs their own copy — the effect used to bail out whenever
        // `initialCourse` existed, pinning the anonymous snapshot for the life
        // of the page. That is why an approved student sitting in a closed
        // batch never saw the chat tab at all.
        const hasAnonymousCopy = !!initialCourse;
        if (!user && hasAnonymousCopy) {
            // `loading` already started as `!initialCourse`, so the guest path
            // needs no state write here. Leaving the server copy on screen also
            // avoids a spinner flash for a signed-in viewer whose own copy is
            // still in flight below.
            return;
        }
        // No viewer and no server copy (the render failed): fetch anonymously
        // so the page is not blank.

        let cancelled = false;
        const fetchCourse = async () => {
            try {
                const res = await api.get(`/courses/${id}`);
                if (!cancelled) setCourse(res.data as Course);
            } catch {
                if (!cancelled) toast.error(t('courseDetail.failed_load'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchCourse();
        return () => { cancelled = true; };
    }, [id, t, user, initialCourse]);

    useEffect(() => {
        const intent = searchParams.get('intent');
        if (!user || !course || (intent !== 'enroll' && intent !== 'reserve')) return;

        const openingId = searchParams.get('openingId');
        const intentKey = `${intent}:${openingId ?? ''}`;
        if (handledIntent.current === intentKey) return;
        handledIntent.current = intentKey;
        router.replace(`/courses/${id}`, { scroll: false });

        if (user.role !== 'STUDENT') {
            toast.error(t('courseDetail.enroll_failed'));
            return;
        }

        if (intent === 'reserve') {
            void api.post('/enrollments/reserve', { courseId: id })
                .then(() => {
                    toast.success(t('courseDetail.seat_reserved'));
                    router.push('/dashboard/my-courses');
                })
                .catch((error) => toast.error(getErrorMessage(error) || t('courseDetail.reserve_failed')));
            return;
        }

        const target = course.openings?.find((openingItem) => (
            openingItem.id === openingId && (openingItem.status === 'OPEN' || openingItem.status === 'ANNOUNCEMENT')
        )) ?? course.openings?.find((openingItem) => openingItem.status === 'OPEN')
            ?? course.openings?.find((openingItem) => openingItem.status === 'ANNOUNCEMENT');
        if (!target) {
            toast.error(t('courseDetail.enroll_failed'));
            return;
        }

        startTransition(() => setSelectedOpening(target));
    }, [course, id, router, searchParams, t, user]);

    const handleEnrollSubmit = async () => {
        if (!selectedOpening) return;
        if (!gatewayId) {
            toast.error(t('payment.select_method_first'));
            return;
        }
        if (!receiptFile) {
            toast.error(t('explore.upload_receipt_required'));
            return;
        }
        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('openingId', selectedOpening.id);
            formData.append('gatewayId', gatewayId);
            formData.append('receipt', receiptFile);
            if (couponCode.trim()) formData.append('couponCode', couponCode.trim());
            await api.post('/enrollments', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setCourse((current) => current ? {
                ...current,
                viewerAccess: {
                    enrolled: true,
                    approved: false,
                    teaches: current.viewerAccess?.teaches ?? false,
                    chatEnabled: current.viewerAccess?.chatEnabled ?? false,
                    openingId: selectedOpening.id,
                    enrollmentStatus: 'PENDING',
                },
            } : current);
            toast.success(t('explore.review_success'));
            setSelectedOpening(null);
            setReceiptFile(null);
            setGatewayId(null);
            setCouponCode('');
            setCoupon(null);
        } catch (e) {
            // A guest that slipped past the CTA still gets a prompt, not "Unauthorized".
            if (isUnauthorized(e)) {
                setSelectedOpening(null);
                setLoginRedirectTo(`/courses/${id}?intent=enroll&openingId=${encodeURIComponent(selectedOpening.id)}`);
                setShowLoginPrompt(true);
                return;
            }
            toast.error(getErrorMessage(e) || t('courseDetail.enroll_failed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const applyCoupon = async () => {
        if (!selectedOpening || !couponCode.trim()) return;
        setCouponChecking(true);
        try {
            const res = await api.post('/finance/coupons/validate', {
                code: couponCode.trim(),
                courseId: id,
                price: Number(selectedOpening.price),
            });
            setCoupon({
                name: res.data.name,
                amountOff: Number(res.data.amountOff || 0),
                finalAmount: Number(res.data.finalAmount ?? selectedOpening.price ?? 0),
            });
            toast.success(t('payments.coupon_applied'));
        } catch (err) {
            setCoupon(null);
            toast.error(getErrorMessage(err) || t('payments.coupon_invalid'));
        } finally {
            setCouponChecking(false);
        }
    };

    const handleEnrollClick = (target: Opening) => {
        if (!user) {
            setLoginRedirectTo(`/courses/${id}?intent=enroll&openingId=${encodeURIComponent(target.id)}`);
            setShowLoginPrompt(true);
            return;
        }
        setReceiptFile(null);
        setGatewayId(null);
        setCouponCode('');
        setCoupon(null);
        setSelectedOpening(target);
    };

    if (loading) return <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-surface-sunken' : 'bg-brand-white'}`}><Loader className="animate-spin text-accent" size={48} /></div>;
    if (!course) return <div className={`min-h-screen flex items-center justify-center ${dark ? 'bg-surface-sunken' : 'bg-brand-white'} text-red-700 dark:text-red-400 font-bold text-2xl`}>{t('courseDetail.not_found')}</div>;

    const levelLabel = (lvl?: string | null) => t(`course.level_${String(lvl || 'BEGINNER').toLowerCase()}`);
    const fmtDate = (d?: string | null) => formatDate(d, { locale });

    const opening = course.openings?.find(o => o.status === 'OPEN') || null;
    const announced = course.openings?.find(o => o.status === 'ANNOUNCEMENT') || null;
    const enrolledOpening = access?.openingId
        ? course.openings?.find((candidate) => candidate.id === access.openingId) ?? null
        : null;
    const startedOpening = course.openings?.find((candidate) => candidate.status === 'STARTED') ?? null;
    const metaOpening = enrolledOpening || opening || announced || startedOpening;
    const courseInstructor = metaOpening?.instructor || course.instructor;
    // The public instructor payload has no email on purpose, so the display
    // name falls back through the bilingual pair and then to a generic label.
    const instructorName = (courseInstructor && pick(courseInstructor, 'name')) || '';
    const instructorJobTitle = (courseInstructor && pick(courseInstructor, 'jobTitle')) || '';

    const getVideoUrl = (url?: string | null) => {
        if (!url) return null;
        const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
        const vm = url.match(/vimeo\.com\/(\d+)/);
        if (yt) return { type: 'embed', src: `https://www.youtube.com/embed/${yt[1]}` } as const;
        if (vm) return { type: 'embed', src: `https://player.vimeo.com/video/${vm[1]}` } as const;
        if (url.startsWith('/uploads') || /\.(mp4|webm|mov)$/i.test(url)) return { type: 'file', src: url } as const;
        return { type: 'embed', src: url } as const;
    };

    const handleReserveClick = async () => {
        if (!user) {
            toast.error(t('courseDetail.login_to_reserve'));
            setLoginRedirectTo(`/courses/${id}?intent=reserve`);
            setShowLoginPrompt(true);
            return;
        }
        try {
            await api.post('/enrollments/reserve', { courseId: id });
            toast.success(t('courseDetail.seat_reserved'));
            router.push('/dashboard/my-courses');
        } catch (e) {
            toast.error(getErrorMessage(e) || t('courseDetail.reserve_failed'));
        }
    };

    const features: { key: keyof Course; label: string }[] = [
        { key: 'certificateIssued', label: t('courseDetail.certificate_label') },
        { key: 'quizzesIncluded', label: t('createCourse.feat_quizzes') },
        { key: 'projectsIncluded', label: t('createCourse.feat_projects') },
        { key: 'assignmentsIncluded', label: t('createCourse.feat_assignments') },
        { key: 'liveSessionsIncluded', label: t('createCourse.feat_live_sessions') },
        { key: 'downloadableResources', label: t('createCourse.feat_downloadable') },
        { key: 'lifetimeAccess', label: t('createCourse.feat_lifetime') },
        { key: 'communityAccess', label: t('createCourse.feat_community') },
    ];
    const included = features.filter(f => !!course[f.key]);

    const introVideo = getVideoUrl(course.introVideoUrl) || getVideoUrl(course.videoFileUrl);

    return (
        <div className={`min-h-screen ${dark ? 'bg-surface-sunken' : 'bg-brand-white'} pb-20`}>
            <style>{`
                html { scroll-behavior: smooth; }
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(24px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in-up { animation: fadeInUp 0.6s ease-out both; }
                .fade-in-section { opacity: 0; transform: translateY(20px); transition: opacity 0.5s ease-out, transform 0.5s ease-out; }
                .fade-in-section.visible { opacity: 1; transform: translateY(0); }
            `}</style>

            {/* Header. In the light theme this bar is a dark translucent strip
                laid over the navy hero, so it needs the reverse mark and the
                on-navy inks -- the primary mark and --ink-subtle links were dark
                on dark. The dark theme's own surface already reads as navy. */}
            <header className={`px-4 sm:px-6 md:px-8 h-16 sm:h-20 flex items-center justify-between border-b sticky top-0 z-50 ${dark ? 'border-white/10 bg-surface-sunken' : 'border-white/10 bg-ink/[0.45] backdrop-blur-md'}`}>
                {/* Brand: this header used to draw a hand-rolled "L" tile plus
                    a typed `laxa|lab` wordmark, so the course page showed a
                    different identity from every other page. Use the real mark,
                    as MarketingShell does, and keep it clickable home. */}
                <button
                    onClick={() => router.push('/')}
                    aria-label="Laxalab Academy"
                    className="flex items-center cursor-pointer"
                >
                    <img
                        src="/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png"
                        alt="Laxalab Academy"
                        className="h-8 sm:h-10 md:h-12 w-auto max-w-[45vw] object-contain"
                    />
                </button>
                <nav className="hidden md:flex items-center gap-8">
                    <button onClick={() => router.push('/courses')} className="font-bold text-ink-on-navy-muted hover:text-ink-on-navy transition cursor-pointer">
                        {t('landing.explore_courses')}
                    </button>
                    {user?.role !== 'INSTRUCTOR' && (
                        <button onClick={() => router.push('/join-as-instructor')} className="font-bold text-ink-on-navy-muted hover:text-ink-on-navy transition cursor-pointer">
                            {t('landing.join_as_instructor')}
                        </button>
                    )}
                </nav>
                <div className="flex items-center gap-4">
                    {/* This header is dark in both themes, so the burger follows
                        the bar rather than the page theme -- otherwise the light
                        theme put a navy glyph on a navy strip. */}
                    <PublicMobileMenu dark />
                    <div className="hidden sm:flex items-center gap-4">
                        {user ? (
                            <button onClick={() => router.push('/dashboard')} className="bg-brand-gold text-ink-on-gold hover:bg-brand-gold-light px-6 py-2.5 rounded-xl font-bold transition-all duration-300 shadow-md">
                                {t('courseDetail.dashboard')}
                            </button>
                        ) : (
                            <>
                                <button onClick={() => router.push('/login')} className="hover:text-white font-bold text-ink-on-navy transition cursor-pointer">
                                    {t('auth.login')}
                                </button>
                                <button onClick={() => router.push('/register')} className="bg-brand-gold text-ink-on-gold hover:bg-brand-gold-light px-6 py-2.5 rounded-xl font-bold transition-all duration-300 shadow-md">
                                    {t('auth.register')}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            {/* Hero Section */}
            <div className="relative overflow-hidden bg-gradient-to-br from-brand-navy-dark via-brand-navy to-brand-navy-light min-h-[480px]">
                {course.coverImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${API_BASE_URL}${course.coverImageUrl}`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-15" aria-hidden />
                )}
                <div className="absolute inset-0 bg-gradient-to-br from-brand-navy-dark/70 via-brand-navy/85 to-brand-navy-dark/95" aria-hidden />
                <div className="absolute -top-24 -start-24 w-96 h-96 bg-brand-gold/10 rounded-full blur-3xl" aria-hidden />
                <div className="absolute top-1/2 end-0 w-72 h-72 bg-brand-gold/8 rounded-full blur-3xl" aria-hidden />
                <div className="absolute bottom-0 start-1/3 w-80 h-80 bg-surface-raised rounded-full blur-3xl" aria-hidden />
                <div className="absolute bottom-0 end-0 w-80 h-80 bg-brand-gold/5 rounded-full blur-3xl" aria-hidden />

                <div className="relative max-w-6xl mx-auto px-4 sm:px-6 md:px-10 pt-10 sm:pt-16 md:pt-20 pb-14 sm:pb-24 md:pb-28 grid lg:grid-cols-[1.2fr_1fr] gap-10 md:gap-12 items-center">
                    {/* Left */}
                    <div className="animate-fade-in-up">
                        {/* The hero panel is a fixed navy gradient: it is the same
                            colour in both themes, so its ink cannot be --ink the
                            way the rest of the page is. In light mode --ink is
                            #1b2434, which put the course title, the excerpt and
                            the stat values at roughly 1.2:1 on #0a1c35. Every
                            colour inside this block is therefore one of the
                            theme-independent on-navy inks or a white tint. */}
                        <nav className="flex items-center gap-2 text-xs font-bold text-brand-gold-light mb-6 flex-wrap">
                            <button onClick={() => router.push('/')} className="hover:text-white transition cursor-pointer">{t('landing.home')}</button>
                            <span className="text-white/40">/</span>
                            <button onClick={() => router.push('/courses')} className="hover:text-white transition cursor-pointer">{t('landing.explore_courses')}</button>
                            <span className="text-white/40">/</span>
                            <span className="text-ink-on-navy truncate max-w-[60vw] sm:max-w-[200px]">{pick(course, 'title')}</span>
                        </nav>

                        <div className="flex flex-wrap items-center gap-2 mb-5">
                            {pick(course, 'duration') && (
                                <span className={`bg-brand-gold text-ink-on-gold px-3 py-1.5 rounded-full shadow-sm ${pillCaption}`}>
                                    {pick(course, 'duration')}
                                </span>
                            )}
                            {pick(course, 'category') && (
                                <span className="bg-white/10 border border-white/20 text-ink-on-navy font-bold text-xs px-3 py-1.5 rounded-full">
                                    {pick(course, 'category')}
                                </span>
                            )}
                            <span className="bg-white/10 border border-white/20 text-ink-on-navy font-bold text-xs px-3 py-1.5 rounded-full">
                                {levelLabel(course.level)}
                            </span>
                            {course.language && (
                                <span className="bg-white/10 border border-white/20 text-ink-on-navy font-bold text-xs px-3 py-1.5 rounded-full">
                                    <Globe size={11} className="inline me-1" />{course.language}
                                </span>
                            )}
                        </div>

                        {/* The glow is unconditional: the panel behind this heading
                            is navy in the light theme too, so the title needs the
                            same lift it has in the dark one. */}
                        <h1
                            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-ink-on-navy mb-4 sm:mb-5 leading-[1.15] sm:leading-[1.08] tracking-tight break-words"
                            style={{ textShadow: '0 2px 24px rgba(0,0,0,0.5)' }}
                        >
                            {pick(course, 'title')}
                        </h1>
                        {/* Said once, in the largest type on the page: a visitor
                            who came for a live cohort should not have to infer it
                            from a small badge next to the cover. */}
                        <div className="mb-5 sm:mb-6">
                            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black shadow-sm ${isLiveCourse
                                ? 'bg-red-700 text-ink-inverse'
                                : 'bg-brand-navy text-ink-inverse'}`}>
                                {isLiveCourse ? <Radio size={15} /> : <PlayCircle size={15} />}
                                {deliveryLabel}
                            </span>
                        </div>
                        {(pick(course, 'excerpt') || pick(course, 'description')) && (
                            <p className="text-base sm:text-lg md:text-xl text-ink-on-navy-muted max-w-2xl mb-6 sm:mb-8 font-medium leading-relaxed break-words">
                                {pick(course, 'excerpt') || pick(course, 'description')}
                            </p>
                        )}

                        {/* Stats */}
                        <div className="flex flex-wrap gap-3 mb-8">
                            <div className={statCard}>
                                <div className={statIcon}>
                                    <Clock size={17} />
                                </div>
                                <div>
                                    <div className={statCaption}>{t('explore.duration')}</div>
                                    <div className={statValue}>{durationText}</div>
                                </div>
                            </div>
                            {/* "Hours of content" with a play icon is the strongest
                                video signal on the page, so a live course trades it
                                for the one thing it can actually promise. */}
                            {isLiveCourse ? (
                                <div className={statCard}>
                                    <div className={statIcon}>
                                        <Radio size={17} />
                                    </div>
                                    <div>
                                        <div className={statCaption}>{t('courseDetail.delivery_label')}</div>
                                        <div className={`${statValue} text-brand-gold-light`}>{deliveryLabel}</div>
                                    </div>
                                </div>
                            ) : course.hoursOfContent ? (
                                <div className={statCard}>
                                    <div className={statIcon}>
                                        <PlayCircle size={17} />
                                    </div>
                                    <div>
                                        <div className={statCaption}>{t('courseDetail.hours_label')}</div>
                                        <div className={`${statValue} text-brand-gold-light`}>{course.hoursOfContent}</div>
                                    </div>
                                </div>
                            ) : null}
                            <div className={statCard}>
                                <div className={statIcon}>
                                    <User size={17} />
                                </div>
                                <div>
                                    <div className={statCaption}>{t('courseDetail.expert_instructor')}</div>
                                    <div className={`${statValue} max-w-[55vw] sm:max-w-[160px] truncate`}>{instructorName || t('courseDetail.expert_instructor')}</div>
                                </div>
                            </div>
                        </div>

                        {/* Enrollment status replaces the CTA once the student has a record. */}
                        <div className="flex flex-wrap items-center gap-3">
                            {access?.enrollmentStatus ? (
                                <div
                                    role="status"
                                    className={`inline-flex items-center gap-2 rounded-2xl border px-6 py-3.5 font-black ${
                                        access.enrollmentStatus === 'APPROVED' || access.enrollmentStatus === 'RESERVED'
                                            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                                            : access.enrollmentStatus === 'REJECTED' || access.enrollmentStatus === 'REVOKED'
                                                ? 'border-red-400/30 bg-red-500/10 text-red-100'
                                                : 'border-amber-300/30 bg-amber-500/10 text-amber-100'
                                    }`}
                                >
                                    {access.enrollmentStatus === 'APPROVED' || access.enrollmentStatus === 'RESERVED'
                                        ? <CheckCircle size={18} />
                                        : <Clock size={18} />}
                                    {access.enrollmentStatus === 'APPROVED' ? t('explore.enrollment_approved')
                                        : access.enrollmentStatus === 'RESERVED' ? t('explore.enrollment_reserved')
                                            : access.enrollmentStatus === 'PENDING' ? t('explore.enrollment_pending')
                                                : access.enrollmentStatus === 'REJECTED' ? t('explore.enrollment_rejected')
                                                    : t('explore.enrollment_revoked')}
                                </div>
                            ) : opening ? (
                                <>
                                    <button onClick={() => handleEnrollClick(opening)} className="bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-light hover:to-brand-gold text-black flex items-center gap-3 font-black py-4 px-8 rounded-2xl shadow-xl shadow-brand-gold/25 hover:shadow-[0_0_30px_rgba(245,158,11,0.45)] transition-all transform hover:-translate-y-0.5 cursor-pointer animate-[pulse_2.5s_ease-in-out_infinite] hover:animate-none">
                                        <BookOpen size={20} />
                                        {Number(opening.price) === 0 ? t('course.free') : `${t('courseDetail.enroll_for')} ${formatPrice(opening.price, { locale })}`}
                                    </button>
                                    {opening.priceOld && Number(opening.priceOld) > Number(opening.price) && (
                                        <span className="text-ink-on-navy-muted text-sm font-semibold">
                                            {t('courseDetail.was_price')} <s className="text-ink-on-navy-muted">{formatPrice(opening.priceOld, { locale })}</s>
                                        </span>
                                    )}
                                    {announced && (
                                        <button onClick={handleReserveClick} className="bg-white/10 hover:bg-white/[0.16] border border-white/25 text-ink-on-navy flex items-center gap-2 font-bold py-4 px-8 rounded-2xl transition transform hover:-translate-y-0.5 cursor-pointer">
                                            {t('courseDetail.reserve_seat')}
                                        </button>
                                    )}
                                </>
                            ) : announced ? (
                                <button onClick={handleReserveClick} className="bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-light hover:to-brand-gold text-black flex items-center gap-3 font-black py-4 px-8 rounded-2xl shadow-xl shadow-brand-gold/25 hover:shadow-[0_0_30px_rgba(245,158,11,0.45)] transition-all transform hover:-translate-y-0.5 cursor-pointer animate-[pulse_2.5s_ease-in-out_infinite] hover:animate-none">
                                    <BookOpen size={20} />
                                    {t('courseDetail.reserve_seat')}
                                </button>
                            ) : (
                                <div className="bg-white/[0.06] border border-white/15 text-ink-on-navy-muted font-bold py-3 px-7 rounded-2xl">
                                    {t('courseDetail.not_open_yet')}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: cover card, doubling as the trailer player */}
                    <div className="hidden lg:block animate-fade-in-up">
                        <div className="relative">
                            <div className="absolute -inset-3 bg-gradient-to-tr from-brand-gold/30 to-transparent rounded-[2rem] blur-2xl opacity-50" aria-hidden />
                            <div className="relative rounded-[1.75rem] overflow-hidden border border-line shadow-2xl shadow-black/40 hover:scale-[1.02] transition-transform duration-500">
                                {showTrailer && introVideo ? (
                                    <div className="w-full aspect-[4/3] bg-black">
                                        {introVideo.type === 'embed' ? (
                                            <iframe
                                                src={`${introVideo.src}${introVideo.src.includes('?') ? '&' : '?'}autoplay=1`}
                                                title={t('courseDetail.intro_video')}
                                                className="w-full h-full"
                                                allow="autoplay; fullscreen; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                            />
                                        ) : (
                                            <video src={`${API_BASE_URL}${introVideo.src}`} controls autoPlay className="w-full h-full" />
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        {course.coverImageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={`${API_BASE_URL}${course.coverImageUrl}`} alt={pick(course, 'title') || ''} className="w-full aspect-[4/3] object-cover" />
                                        ) : (
                                            <div className="w-full aspect-[4/3] bg-gradient-to-br from-brand-navy-light to-brand-navy-dark flex items-center justify-center">
                                                <BookOpen size={72} className="text-brand-gold-light" />
                                            </div>
                                        )}
                                        {introVideo && (
                                            <button
                                                type="button"
                                                onClick={() => setShowTrailer(true)}
                                                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-sunken backdrop-blur-[2px] transition hover:bg-surface-sunken cursor-pointer group"
                                                aria-label={t('courseDetail.watch_intro')}
                                            >
                                                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-gold text-ink-on-gold shadow-2xl transition-transform duration-300 group-hover:scale-110">
                                                    <PlayCircle size={42} />
                                                </span>
                                                <span className="rounded-full bg-surface px-4 py-1.5 text-xs font-black text-ink backdrop-blur-sm">
                                                    {t('courseDetail.watch_intro')}
                                                </span>
                                            </button>
                                        )}
                                    </>
                                )}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-navy-dark/95 to-transparent p-6 pt-16 pointer-events-none">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <div className="text-[10px] font-bold text-brand-gold-light uppercase tracking-[0.2em] mb-1">
                                                {opening ? (Number(opening.price) === 0 ? t('course.free') : formatPrice(opening.price, { locale })) : t('courseDetail.not_open_yet')}
                                            </div>
                                            <div className="text-ink-on-navy font-black text-2xl">{pick(course, 'title')}</div>
                                        </div>
                                        {course._count?.modules ? (
                                            <div className="bg-white/10 backdrop-blur-sm rounded-2xl px-4 py-3 text-center shrink-0">
                                                <div className="text-xl font-black text-brand-gold-light">{course._count.modules}</div>
                                                <div className="text-[10px] font-bold text-ink-on-navy-muted">{t('course.modules')}</div>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 md:px-6 -mt-10 relative z-20">
                {mode !== 'guest' && renderTabs()}
                <div className={`rounded-3xl shadow-2xl p-4 sm:p-6 md:p-12 animate-fade-in-up ${dark ? 'bg-surface shadow-black/20 border border-line' : 'bg-surface-raised shadow-brand-navy/10 border border-line'}`}>

                    {mode !== 'guest' && tab !== 'overview' ? (
                        <>
                            {tab === 'tasks' && mode === 'instructor' && instructorOpeningId && <TasksPanel openingId={instructorOpeningId} />}
                            {tab === 'tasks' && mode === 'student' && <StudentTasksPanel courseId={course.id} />}
                            {tab === 'grades' && mode === 'student' && <StudentGradesPanel courseId={course.id} />}
                            {/* Guarded on the same flag as the tab: this body had
                                no `mode` check of its own, so it was reachable by
                                any non-guest even where the tab was hidden. */}
                            {tab === 'chat' && chatAvailable && <CourseChat courseId={course.id} />}
                            {tab === 'roster' && mode === 'instructor' && instructorOpeningId && <RosterGrades openingId={instructorOpeningId} />}
                        </>
                    ) : (
                        <>

                    {/* What you'll learn — before the syllabus, so the visitor
                        sees the payoff before committing to the syllabus. */}
                    {course.objectives && course.objectives.length > 0 && (
                        <div className="mb-8 sm:mb-12 bg-brand-gold/5 border border-brand-gold/10 rounded-3xl p-4 sm:p-6">
                            <SectionTitle icon={<GraduationCap size={18} />}>{t('courseDetail.learn_heading')}</SectionTitle>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {course.objectives.map((o, idx) => (
                                    <div key={idx} className={`flex items-start gap-3 rounded-xl p-3 sm:p-4 hover:border-brand-gold/20 transition ${'bg-surface-sunken border border-line'}`}>
                                        <CheckCircle size={18} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                                        <span className={`text-sm font-medium ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>{pick(o, 'objective')}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Lesson explorer */}
                    {course.modules && course.modules.length > 0 && (
                        <div className="mb-12">
                            <LessonExplorer courseId={course.id} modules={course.modules || []} chapters={course.chapters} openingId={instructorOpeningId} mode={mode} contentType={course.contentType} />
                        </div>
                    )}

                    <div className="grid md:grid-cols-3 gap-10 md:gap-12">
                        {/* Highlights */}
                        <div className="md:col-span-2 space-y-8 sm:space-y-10">

                            {/* About */}
                            {(pick(course, 'description') || pick(course, 'syllabus')) && (
                                <div>
                                    <SectionTitle icon={<BookOpen size={18} />}>{t('courseDetail.about_heading')}</SectionTitle>
                                    {pick(course, 'description') && (
                                        <p className={`whitespace-pre-wrap leading-relaxed mb-6 ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>{pick(course, 'description')}</p>
                                    )}
                                    {pick(course, 'syllabus') && (
                                        <div>
                                            <h3 className={`text-lg font-bold mb-2 'text-ink'`}>{t('courseDetail.syllabus_heading')}</h3>
                                            <p className={`whitespace-pre-wrap leading-relaxed rounded-2xl p-5 ${'text-ink-muted bg-surface-sunken border border-line'}`}>
                                                {pick(course, 'syllabus') || t('courseDetail.syllabus_fallback')}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Prerequisites */}
                            {course.prerequisites && course.prerequisites.length > 0 && (
                                <div>
                                    <SectionTitle icon={<Target size={18} />}>{t('courseDetail.prereq_heading')}</SectionTitle>
                                    <ul className="space-y-3">
                                        {course.prerequisites.map((p, idx) => (
                                            <li key={idx} className="flex items-start gap-3">
                                                <ListChecks size={18} className={`mt-0.5 flex-shrink-0 'text-accent'`} />
                                                <span className={`font-medium ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>{pick(p, 'prerequisite')}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Audience */}
                            {course.audiences && course.audiences.length > 0 && (
                                <div>
                                    <SectionTitle icon={<Users size={18} />}>{t('courseDetail.audience_heading')}</SectionTitle>
                                    <ul className="space-y-3">
                                        {course.audiences.map((a, idx) => (
                                            <li key={idx} className="flex items-start gap-3">
                                                <CheckCircle size={18} className={`mt-0.5 flex-shrink-0 'text-accent'`} />
                                                <span className={`font-medium ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>{pick(a, 'audience')}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* The instructor card links to the public profile.
                                The gate is the id, not an email: the public
                                payload deliberately carries no email. */}
                            {courseInstructor?.id && (
                                <div>
                                    <SectionTitle icon={<User size={18} />}>{t('courseDetail.instructor_heading')}</SectionTitle>
                                    <div className={`flex flex-wrap items-center gap-5 rounded-2xl p-5 ${'bg-surface-sunken border border-line'}`}>
                                        {courseInstructor.avatarUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={`${API_BASE_URL}${courseInstructor.avatarUrl}`}
                                                alt={instructorName}
                                                className="h-16 w-16 flex-shrink-0 rounded-full object-cover"
                                            />
                                        ) : (
                                            <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-gold to-brand-gold-dark text-2xl font-black text-ink">
                                                {(instructorName || '?').trim().charAt(0).toUpperCase()}
                                            </span>
                                        )}
                                        <div className="min-w-0 flex-1 basis-40">
                                            {/* Wraps instead of truncating: a clipped
                                                name is unreadable on a phone, and
                                                Arabic job titles are long. */}
                                            <div className={`font-black break-words 'text-ink'`} dir="auto">
                                                {instructorName || t('courseDetail.expert_instructor')}
                                            </div>
                                            <div className={`mt-0.5 text-sm break-words 'text-ink-subtle'`} dir="auto">
                                                {instructorJobTitle || t('courseDetail.instructor_role')}
                                            </div>
                                            <Link
                                                href={`/instructors/${courseInstructor.id}`}
                                                className={`mt-2 inline-flex items-center gap-1.5 text-sm font-bold hover:underline 'text-accent'`}
                                            >
                                                {t('courseDetail.instructor_view_profile')}
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* FAQ */}
                            {course.faqs && course.faqs.length > 0 && (
                                <div>
                                    <SectionTitle icon={<MessagesSquare size={18} />}>{t('courseDetail.faq_heading')}</SectionTitle>
                                    <div className="space-y-3">
                                        {course.faqs.map((f, idx) => (
                                            <div key={idx} className={`rounded-2xl overflow-hidden ${'border border-line bg-surface-sunken'}`}>
                                                <button
                                                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                                                    className={`w-full flex items-center justify-between gap-3 p-4 text-left font-bold transition ${dark ? 'text-ink hover:bg-ink/[0.04]' : 'text-ink hover:bg-surface-sunken'}`}
                                                >
                                                    <span>{pick(f, 'question')}</span>
                                                    <ChevronDown size={18} className={`flex-shrink-0 transition-transform ${openFaq === idx ? 'rotate-180' : ''} 'text-accent'`} />
                                                </button>
                                                {openFaq === idx && (
                                                    <p className={`px-4 pb-4 text-sm leading-relaxed ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>{pick(f, 'answer')}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Gallery */}
                            {course.gallery && course.gallery.length > 0 && (
                                <div>
                                    <SectionTitle icon={<Award size={18} />}>{t('courseDetail.course_gallery')}</SectionTitle>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {course.gallery.map((g, idx) => (
                                            <a key={idx} href={`${API_BASE_URL}${g.url}`} target="_blank" rel="noreferrer" className={`group overflow-hidden rounded-2xl transition ${dark ? 'border border-line hover:border-brand-gold/20' : 'border border-line hover:border-brand-gold/40'}`}>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={`${API_BASE_URL}${g.url}`} alt={`gallery-${idx}`} className="w-full h-32 object-cover group-hover:scale-105 transition-transform duration-500" />
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sidebar Info */}
                        <div className="space-y-6 lg:sticky lg:top-24 self-start">
                            <div className="rounded-3xl overflow-hidden border border-line shadow-2xl shadow-black/20 bg-surface-sunken border-t-2 border-t-brand-gold-light animate-fade-in-up">
                                <div className="bg-gradient-to-r from-brand-gold/10 to-transparent px-6 py-4 flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-brand-gold/20 flex items-center justify-center text-gold-ink">
                                        <BookOpen size={16} />
                                    </div>
                                    <h2 className="font-black text-accent uppercase tracking-wider text-sm">{t('courseDetail.course_details')}</h2>
                                </div>
                                <div className="p-4 sm:p-6 space-y-1">
                                    {[
                                        { icon: isLiveCourse ? <Radio size={16} /> : <Clock size={16} />, label: durationText },
                                        { icon: <User size={16} />, label: instructorName || t('courseDetail.expert_instructor') },
                                        course.categoryAr ? { icon: <ListChecks size={16} />, label: `${t('courseDetail.category_label')}: ${pick(course, 'category')}` } : null,
                                        { icon: <GraduationCap size={16} />, label: `${t('courseDetail.level_label')}: ${levelLabel(course.level)}` },
                                        course.language ? { icon: <Globe size={16} />, label: `${t('courseDetail.language_label')}: ${course.language}` } : null,
                                        isLiveCourse
                                            ? { icon: <Radio size={16} />, label: `${t('courseDetail.delivery_label')}: ${deliveryLabel}` }
                                            : course.hoursOfContent ? { icon: <PlayCircle size={16} />, label: `${t('courseDetail.hours_label')}: ${course.hoursOfContent}` } : null,
                                        metaOpening?.maxStudents ? { icon: <Users size={16} />, label: `${t('createCourse.max_students_label')}: ${metaOpening.maxStudents}` } : null,
                                        fmtDate(metaOpening?.startDate) ? { icon: <CalendarDays size={16} />, label: `${t('courseDetail.starts_label')}: ${fmtDate(metaOpening?.startDate)}` } : null,
                                        fmtDate(metaOpening?.endDate) ? { icon: <CalendarDays size={16} />, label: `${t('courseDetail.ends_label')}: ${fmtDate(metaOpening?.endDate)}` } : null,
                                        fmtDate(metaOpening?.enrollmentDeadline) ? { icon: <CalendarDays size={16} />, label: `${t('courseDetail.deadline_label')}: ${fmtDate(metaOpening?.enrollmentDeadline)}` } : null,
                                    ].filter(Boolean).map((row, idx) => row && (
                                        <div key={idx} className="flex items-center gap-3 py-2.5 text-ink-muted font-medium text-sm border-b border-line last:border-0">
                                            <div className="w-8 h-8 rounded-full bg-brand-gold/10 flex items-center justify-center text-gold-ink shrink-0">
                                                {row.icon}
                                            </div>
                                            <span className="break-words">{row.label}</span>
                                        </div>
                                    ))}
                                    {metaOpening && (
                                        <div className="flex items-center gap-3 py-3 mt-1">
                                            <div className="w-8 h-8 rounded-full bg-brand-gold/20 flex items-center justify-center text-gold-ink shrink-0">
                                                <BookOpen size={16} />
                                            </div>
                                            <span className="font-black text-accent text-3xl">
                                                {Number(metaOpening.price) === 0 ? t('course.free') : formatPrice(metaOpening.price, { locale })}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Included features */}
                            {included.length > 0 && (
                                <div className="rounded-3xl border border-line p-4 sm:p-6 shadow-sm bg-surface-sunken animate-fade-in-up">
                                    <h2 className="font-black text-ink mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
                                        <span className="w-1 h-5 bg-brand-gold-light rounded-full" /> {t('courseDetail.features_heading')}
                                    </h2>
                                    <ul className="space-y-2.5">
                                        {included.map((f, idx) => (
                                            <li key={idx} className="flex items-start gap-2.5">
                                                <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 flex items-center justify-center mt-0.5 flex-shrink-0">
                                                    <CheckCircle size={13} />
                                                </span>
                                                <span className="text-sm text-ink-muted font-medium">{f.label}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="rounded-3xl border border-line p-4 sm:p-6 shadow-sm bg-surface-sunken animate-fade-in-up">
                                <h2 className="font-black text-ink mb-4 flex items-center gap-2 text-sm uppercase tracking-wider">
                                    <span className="w-1 h-5 bg-brand-gold-light rounded-full" /> {t('courseDetail.achievements')}
                                </h2>
                                <ul className="space-y-2.5">
                                    <li className="flex items-start gap-2.5">
                                        <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 flex items-center justify-center mt-0.5 flex-shrink-0">
                                            <CheckCircle size={13} />
                                        </span>
                                        <span className="text-sm text-ink-muted font-medium">{t('courseDetail.achievement_1')}</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 flex items-center justify-center mt-0.5 flex-shrink-0">
                                            <CheckCircle size={13} />
                                        </span>
                                        <span className="text-sm text-ink-muted font-medium">{t('courseDetail.achievement_2')}</span>
                                    </li>
                                    <li className="flex items-start gap-2.5">
                                        <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 flex items-center justify-center mt-0.5 flex-shrink-0">
                                            <CheckCircle size={13} />
                                        </span>
                                        <span className="text-sm text-ink-muted font-medium">{t('courseDetail.achievement_3')}</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                        </>
                    )}

                </div>
            </div>

            {/* Login Prompt Modal (guests only) */}
            <LoginPromptModal
                open={showLoginPrompt}
                onClose={() => setShowLoginPrompt(false)}
                redirectTo={loginRedirectTo}
            />

            {/* Enrollment Modal with Receipt Upload */}
            {selectedOpening && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
                    <div className={`rounded-3xl w-full max-w-lg p-5 sm:p-8 shadow-2xl transform transition-all max-h-[90vh] overflow-y-auto ${dark ? 'bg-surface border border-line' : 'bg-surface-raised border border-line'}`}>
                        <h2 className={`text-xl sm:text-2xl font-black mb-2 break-words 'text-ink'`}>
                            {t('explore.enroll_in')} {pick(course, 'title')}
                        </h2>
                        <p className={`mb-4 ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>
                            {t('explore.transfer_part1')} <strong className={'text-accent'}>{formatPrice(selectedOpening.price, { locale })}</strong> {t('explore.transfer_part2')}
                        </p>

                        <div className="mb-6">
                            <label className={`block text-sm font-bold uppercase tracking-wider mb-2 ${dark ? 'text-ink-muted' : 'text-ink'}`}>
                                {t('payments.coupon_label')}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    value={couponCode}
                                    onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCoupon(null); }}
                                    placeholder={t('payments.coupon_placeholder')}
                                    className={`flex-1 px-4 py-3 rounded-xl font-mono font-semibold uppercase focus:outline-none focus:ring-2 focus:ring-accent/50 transition ${dark ? 'bg-ink/[0.04] border border-line text-ink placeholder:text-ink-muted' : 'bg-surface-raised border border-line text-ink placeholder:text-ink-subtle'}`}
                                />
                                <button
                                    onClick={applyCoupon}
                                    disabled={couponChecking || !couponCode.trim()}
                                    className={`px-4 py-3 rounded-xl font-bold transition disabled:opacity-50 whitespace-nowrap cursor-pointer ${dark ? 'bg-ink/[0.04] text-ink-muted hover:bg-ink/[0.08]' : 'bg-surface-sunken text-ink-muted hover:bg-ink/[0.08]'}`}
                                >
                                    {couponChecking ? t('common.processing') : t('payments.coupon_apply')}
                                </button>
                            </div>
                            {coupon && (
                                <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-sm">
                                    <div className="flex items-center justify-between text-emerald-500 font-bold">
                                        <span>{coupon.name}</span>
                                        <button onClick={() => { setCoupon(null); setCouponCode(''); }} className="text-xs font-bold underline">
                                            {t('payments.coupon_remove')}
                                        </button>
                                    </div>
                                    <div className={`flex items-center justify-between mt-1 ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>
                                        <span>{t('payments.coupon_discount')}</span>
                                        <span className="font-bold text-emerald-500">-{formatPrice(coupon.amountOff, { locale })}</span>
                                    </div>
                                    <div className={`flex items-center justify-between mt-1 ${dark ? 'text-ink-muted' : 'text-ink-subtle'}`}>
                                        <span>{t('payments.coupon_total')}</span>
                                        <span className="font-black text-ink">{formatPrice(coupon.finalAmount, { locale })}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <EnrollSteps step={gatewayId ? 2 : 1} dark={dark} />

                        <div className="mb-6 space-y-3">
                            <h3 className={`font-bold text-sm uppercase tracking-wider ${dark ? 'text-ink-muted' : 'text-ink'}`}>{t('payment.payment_method')}:</h3>
                            <p className={`text-xs -mt-1 'text-ink-subtle'`}>{t('payment.choose_method_hint')}</p>
                            <PaymentMethods
                                gateways={gateways}
                                loading={gatewaysLoading}
                                selectedId={gatewayId}
                                onSelect={(gid) => setGatewayId(prev => (prev === gid ? null : gid))}
                                dark={dark}
                                emptyLabel={t('explore.no_payment_methods')}
                            />
                        </div>

                        <div className="space-y-3">
                            <h3 className={`font-bold text-sm uppercase tracking-wider ${dark ? 'text-ink-muted' : 'text-ink'}`}>{t('payment.step_receipt')}:</h3>
                            {!gatewayId ? (
                                <p className={`text-sm p-3 rounded-xl border flex items-center gap-2 ${dark ? 'text-ink-muted bg-ink/[0.04] border-line' : 'text-ink-muted bg-ink/[0.04] border-brand-mist'}`}>
                                    <AlertTriangle size={16} className="flex-shrink-0 text-accent" />
                                    {t('payment.receipt_section_locked')}
                                </p>
                            ) : (
                                <ReceiptDropzone file={receiptFile} onChange={setReceiptFile} dark={dark} disabled={isSubmitting} />
                            )}
                        </div>

                        {/* Stacked on a phone: two Arabic labels side by side in a
                            320px viewport left each button ~100px and wrapped the
                            text onto three lines. */}
                        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4 mt-8">
                            <button
                                onClick={handleEnrollSubmit}
                                disabled={isSubmitting || !receiptFile || !gatewayId}
                                className="flex-1 bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-light hover:to-brand-gold text-black py-3 font-bold rounded-xl shadow-sm transition disabled:opacity-50"
                            >
                                {isSubmitting ? t('common.submitting') : t('explore.submit_proof')}
                            </button>
                            <button
                                onClick={() => setSelectedOpening(null)}
                                disabled={isSubmitting}
                                className={`flex-1 py-3 font-bold rounded-xl transition ${dark ? 'bg-ink/[0.04] text-ink-muted hover:bg-ink/[0.08]' : 'bg-surface-sunken text-ink-muted hover:bg-ink/[0.08]'}`}
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
