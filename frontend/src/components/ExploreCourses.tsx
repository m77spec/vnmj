"use client";

import { useFetchData } from '@/lib/useFetchData';
import { AlertTriangle, BookOpen, Sparkles, Bell, Route } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, getErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { formatNumber, formatPrice } from '@/lib/format';
import CourseCard, { type PublicCourse } from '@/components/CourseCard';
import PaymentMethods, { type PaymentGateway } from '@/components/payment/PaymentMethods';
import ReceiptDropzone from '@/components/payment/ReceiptDropzone';
import EnrollSteps from '@/components/payment/EnrollSteps';
import LoginPromptModal from '@/components/LoginPromptModal';

interface Opening {
    id: string;
    status?: string | null;
    price: string;
}

interface BrowseLearningPath {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    showCourses?: boolean;
    courses?: { orderIndex?: number; course?: { id: string } | null }[];
}

type Course = PublicCourse;
interface MyEnrollmentSummary {
    courseId: string;
    status: string;
}

export default function ExploreCourses({ hideHeader = false, dark }: { hideHeader?: boolean; dark?: boolean }) {
    const { t, pick, locale } = useI18n();
    const { dark: ctxDark } = useTheme();
    // `dark` is an explicit override; without it the surrounding theme wins.
    const isDark = dark ?? ctxDark;
    const { user } = useAuth();
    const router = useRouter();
    const { data: courses, loading, error } = useFetchData<Course[]>('/public/courses');
    const {
        data: myEnrollments,
        error: myEnrollmentsError,
        refetch: refetchMyEnrollments,
    } = useFetchData<MyEnrollmentSummary[]>(user?.role === 'STUDENT' ? '/enrollments/my' : null);
    const { data: learningPaths, loading: pathsLoading, error: learningPathsError } = useFetchData<BrowseLearningPath[]>('/learning-paths');
    const { data: gateways, loading: gatewaysLoading } = useFetchData<PaymentGateway[]>('/payment-gateways');
    const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    // Guests are turned away before `selectedCourse` is set, so the course they
    // were trying to enter is kept here to build the post-login return link.
    const [pendingCourse, setPendingCourse] = useState<Course | null>(null);
    const [pendingAction, setPendingAction] = useState<'enroll' | 'reserve'>('enroll');
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [gatewayId, setGatewayId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [couponCode, setCouponCode] = useState('');
    const [coupon, setCoupon] = useState<{ name: string; amountOff: number; finalAmount: number } | null>(null);
    const [couponChecking, setCouponChecking] = useState(false);
    const [interestCourse, setInterestCourse] = useState<Course | null>(null);
    const [interestMethod, setInterestMethod] = useState<'EMAIL' | 'PHONE'>('EMAIL');
    const [interestValue, setInterestValue] = useState('');
    const [interestSubmitting, setInterestSubmitting] = useState(false);
    const [enrollmentsLoadedFor, setEnrollmentsLoadedFor] = useState<string | null>(null);
    const [enrollmentOverrides, setEnrollmentOverrides] = useState<Record<string, Record<string, string>>>({});

    useEffect(() => {
        if (user?.role !== 'STUDENT' || !user.userId) return;
        let active = true;
        const refreshEnrollments = () => {
            if (document.visibilityState === 'visible') {
                void refetchMyEnrollments({ silent: true });
            }
        };
        void refetchMyEnrollments({ silent: true }).then(() => {
            if (active) setEnrollmentsLoadedFor(user.userId);
        });
        const interval = window.setInterval(refreshEnrollments, 30_000);
        window.addEventListener('focus', refreshEnrollments);
        return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener('focus', refreshEnrollments);
        };
    }, [refetchMyEnrollments, user?.role, user?.userId]);

    const openOpening = (course: Course): Opening | undefined => course.openings?.find(o => o.status === 'OPEN');
    const announcedOpening = (course: Course): Opening | undefined => course.openings?.find(o => o.status === 'ANNOUNCEMENT');
    const currentOpening = (course: Course): Opening | undefined => openOpening(course) ?? announcedOpening(course);

    const filterableLearningPaths = useMemo(
        () => (learningPaths ?? []).filter((path) => path.showCourses !== false),
        [learningPaths],
    );
    const [selectedPathId, setSelectedPathId] = useState('');
    const selectedLearningPath = filterableLearningPaths.find((path) => path.id === selectedPathId);
    const openCourses = useMemo(
        () => (courses ?? []).filter((course) => course.openings?.some((opening) => opening.status === 'OPEN')),
        [courses],
    );
    const selectedPathCourses = useMemo(() => {
        if (!selectedLearningPath || !courses) return [];
        return [...(selectedLearningPath.courses ?? [])]
            .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
            .flatMap((item) => {
                const course = courses.find((candidate) => candidate.id === item.course?.id);
                return course ? [course] : [];
            });
    }, [courses, selectedLearningPath]);
    const enrollmentStatuses = useMemo(() => {
        if (user?.role !== 'STUDENT' || !user.userId || enrollmentsLoadedFor !== user.userId) {
            return new Map<string, string>();
        }
        const statuses = new Map((myEnrollments ?? [])
            .map((enrollment) => [enrollment.courseId, enrollment.status]));
        for (const [courseId, status] of Object.entries(enrollmentOverrides[user.userId] ?? {})) {
            statuses.set(courseId, status);
        }
        return statuses;
    }, [enrollmentOverrides, enrollmentsLoadedFor, myEnrollments, user]);
    const enrollmentStatusFor = (courseId: string) => enrollmentStatuses.get(courseId)
        ?? (user?.role === 'STUDENT' && user.userId && enrollmentsLoadedFor !== user.userId && !myEnrollmentsError
            ? 'LOADING'
            : undefined);

    const handleEnrollClick = (course: Course) => {
        const opening = currentOpening(course);
        if (!opening) return;
        if (!user) {
            setPendingCourse(course);
            setPendingAction('enroll');
            setShowLoginPrompt(true);
            return;
        }
        setSelectedCourse(course);
        setReceiptFile(null);
        setGatewayId(null);
        setCouponCode('');
        setCoupon(null);
    };

    const handleReserveClick = async (course: Course) => {
        if (!user) {
            setPendingCourse(course);
            setPendingAction('reserve');
            setShowLoginPrompt(true);
            return;
        }
        try {
            await api.post('/enrollments/reserve', { courseId: course.id });
            toast.success(t('courseDetail.seat_reserved'));
            router.push('/dashboard/my-courses');
        } catch (err) {
            toast.error(getErrorMessage(err) || t('courseDetail.reserve_failed'));
        }
    };

    const handleInterestSubmit = async () => {
        if (!interestCourse || !interestValue.trim()) return;
        setInterestSubmitting(true);
        try {
            await api.post('/public/course-interests', {
                courseId: interestCourse.id,
                contactMethod: interestMethod,
                contactValue: interestValue.trim(),
            });
            toast.success(t('explore.notify_success'));
            setInterestCourse(null);
            setInterestValue('');
        } catch (err) {
            toast.error(getErrorMessage(err) || t('explore.notify_failed'));
        } finally {
            setInterestSubmitting(false);
        }
    };

    const handleEnrollmentSubmit = async () => {
        if (!selectedCourse) return;
        const opening = currentOpening(selectedCourse);
        if (!opening) return;
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
            formData.append('openingId', opening.id);
            formData.append('gatewayId', gatewayId);
            formData.append('receipt', receiptFile);
            if (couponCode.trim()) formData.append('couponCode', couponCode.trim());

            await api.post('/enrollments', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            toast.success(t('explore.review_success'));
            if (user?.role === 'STUDENT' && user.userId) {
                setEnrollmentOverrides((current) => ({
                    ...current,
                    [user.userId]: { ...current[user.userId], [selectedCourse.id]: 'PENDING' },
                }));
                setEnrollmentsLoadedFor(user.userId);
                void refetchMyEnrollments({ silent: true });
            }
            setSelectedCourse(null);
            setReceiptFile(null);
            setGatewayId(null);
            setCouponCode('');
            setCoupon(null);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('explore.submit_failed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const applyCoupon = async () => {
        if (!selectedCourse || !couponCode.trim()) return;
        const opening = currentOpening(selectedCourse);
        setCouponChecking(true);
        try {
            const res = await api.post('/finance/coupons/validate', {
                code: couponCode.trim(),
                courseId: selectedCourse.id,
                price: opening ? Number(opening.price) : undefined,
            });
            setCoupon({
                name: res.data.name,
                amountOff: Number(res.data.amountOff || 0),
                finalAmount: Number(res.data.finalAmount ?? opening?.price ?? 0),
            });
            toast.success(t('payments.coupon_applied'));
        } catch (err) {
            setCoupon(null);
            toast.error(getErrorMessage(err) || t('payments.coupon_invalid'));
        } finally {
            setCouponChecking(false);
        }
    };

    const selectCls = isDark
        ? "w-full px-4 py-3 bg-white/5 border border-white/10 [color-scheme:dark] rounded-xl font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand-gold/50 transition cursor-pointer [&>option]:bg-brand-navy"
        : "w-full px-4 py-3 bg-white border border-brand-mist rounded-xl font-semibold text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-gold transition cursor-pointer";

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            {/* Header */}
            {!hideHeader && (
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div>
                        <div className={`inline-flex items-center gap-2 font-black text-xs uppercase tracking-[0.2em] mb-2 ${isDark ? 'text-brand-gold-light' : 'text-brand-gold-dark'}`}>
                            <Sparkles size={14} /> {t('landing.explore_courses')}
                        </div>
                        <h1 className={`text-4xl md:text-5xl font-black tracking-tight ${isDark ? 'text-white' : 'text-brand-navy'}`}>{t('explore.heading')}</h1>
                        <p className={`mt-2 text-lg max-w-xl ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('explore.subtitle')}</p>
                    </div>
                    {!loading && courses && (
                        <div className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-black shadow-sm shrink-0 ${isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-white border border-brand-mist text-brand-navy'}`}>
                            <BookOpen size={15} className={isDark ? 'text-brand-gold-light' : 'text-brand-gold-dark'} />
                            {formatNumber(openCourses.length, locale)} {t('explore.count_label')}
                        </div>
                    )}
                </div>
            )}

            {user?.role === 'STUDENT' && myEnrollmentsError && (
                <div role="alert" className={`rounded-xl border p-4 text-sm font-semibold ${isDark ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {myEnrollmentsError}
                </div>
            )}

            <section aria-labelledby="open-courses-heading" className="space-y-6">
                <div>
                    <h2 id="open-courses-heading" className={`text-2xl md:text-3xl font-black ${isDark ? 'text-white' : 'text-brand-navy'}`}>
                        {t('explore.open_now_heading')}
                    </h2>
                    <p className={`mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('explore.open_now_description')}</p>
                </div>
                {loading ? (
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
                        {[0, 1, 2].map((item) => <div key={item} className={`h-80 animate-pulse rounded-3xl ${isDark ? 'bg-white/5' : 'bg-brand-mist/60'}`} />)}
                    </div>
                ) : error ? (
                    <div role="alert" className={`rounded-xl border p-4 text-sm font-semibold ${isDark ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700'}`}>{error}</div>
                ) : openCourses.length > 0 ? (
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
                        {openCourses.map((course) => (
                            <CourseCard
                                key={`open-${course.id}`}
                                course={{ ...course, enrollmentStatus: enrollmentStatusFor(course.id) }}
                                isDark={isDark}
                                onEnroll={handleEnrollClick}
                            />
                        ))}
                    </div>
                ) : (
                    <p className={`rounded-2xl border border-dashed p-6 text-center font-semibold ${isDark ? 'border-white/10 text-gray-400' : 'border-brand-mist text-gray-500'}`}>
                        {t('explore.no_open_courses')}
                    </p>
                )}
            </section>

            {filterableLearningPaths.length > 0 && (
                <section aria-labelledby="learning-paths-heading" className="space-y-5">
                    <div>
                        <h2 id="learning-paths-heading" className={`flex items-center gap-2 text-2xl md:text-3xl font-black ${isDark ? 'text-white' : 'text-brand-navy'}`}>
                            <Route size={23} className="text-brand-gold-dark dark:text-brand-gold-light" />
                            {locale === 'ar' ? 'تصفح الدورات حسب المسار' : 'Browse courses by learning path'}
                        </h2>
                        <p className={`mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {locale === 'ar' ? 'اختر مسارًا لعرض الدورات المرتبطة به.' : 'Choose a path to see its courses.'}
                        </p>
                    </div>
                    {pathsLoading ? (
                        <div className="flex gap-3 overflow-hidden" aria-label={locale === 'ar' ? 'جارٍ تحميل المسارات' : 'Loading learning paths'}>
                            {[0, 1, 2].map((item) => <div key={item} className={`h-12 w-44 shrink-0 animate-pulse rounded-full ${isDark ? 'bg-white/10' : 'bg-brand-mist/70'}`} />)}
                        </div>
                    ) : learningPathsError ? (
                        <div role="alert" className={`rounded-xl border p-4 text-sm font-semibold ${isDark ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700'}`}>
                            {learningPathsError}
                        </div>
                    ) : (
                        <div className="flex gap-3 overflow-x-auto pb-2" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                            {filterableLearningPaths.map((path) => {
                                const isSelected = selectedPathId === path.id;
                                return (
                                    <button
                                        key={path.id}
                                        type="button"
                                        aria-pressed={isSelected}
                                        onClick={() => setSelectedPathId(isSelected ? '' : path.id)}
                                        className={`shrink-0 rounded-full border px-5 py-3 text-sm font-bold transition ${
                                            isSelected
                                                ? 'border-brand-gold bg-brand-gold text-brand-navy-dark shadow-md'
                                                : isDark
                                                    ? 'border-white/10 bg-white/5 text-gray-200 hover:border-brand-gold/50 hover:text-brand-gold-light'
                                                    : 'border-brand-mist bg-white text-brand-navy hover:border-brand-gold hover:text-brand-gold-dark'
                                        }`}
                                    >
                                        {pick(path, 'title')}
                                        <span className="ms-2 opacity-70">{path.courses?.length ?? 0}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>
            )}

            {selectedLearningPath && (
                <section aria-labelledby="selected-path-heading" className="space-y-5">
                    <div className={`flex items-start gap-4 rounded-2xl border p-5 ${isDark ? 'border-brand-gold/20 bg-brand-gold/5' : 'border-brand-gold/30 bg-brand-gold/5'}`}>
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isDark ? 'bg-brand-gold/15 text-brand-gold-light' : 'bg-brand-gold/20 text-brand-gold-dark'}`}>
                            <Route size={21} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <h2 id="selected-path-heading" className={`font-black ${isDark ? 'text-white' : 'text-brand-navy'}`}>{pick(selectedLearningPath, 'title')}</h2>
                            {pick(selectedLearningPath, 'description') && (
                                <p className={`mt-1 text-sm leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{pick(selectedLearningPath, 'description')}</p>
                            )}
                            <p className={`mt-2 text-xs font-bold ${isDark ? 'text-brand-gold-light' : 'text-brand-gold-dark'}`}>
                                {formatNumber(selectedPathCourses.length, locale)} {locale === 'ar' ? 'دورة في هذا المسار' : 'courses in this path'}
                            </p>
                        </div>
                    </div>
                    {loading ? (
                        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
                            {[0, 1, 2].map((item) => <div key={item} className={`h-80 animate-pulse rounded-3xl ${isDark ? 'bg-white/5' : 'bg-brand-mist/60'}`} />)}
                        </div>
                    ) : error ? (
                        <div role="alert" className={`rounded-xl border p-4 text-sm font-semibold ${isDark ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-200 bg-red-50 text-red-700'}`}>{error}</div>
                    ) : selectedPathCourses.length > 0 ? (
                        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
                            {selectedPathCourses.map((course) => (
                                <CourseCard
                                    key={`path-${selectedLearningPath.id}-${course.id}`}
                                    course={{ ...course, enrollmentStatus: enrollmentStatusFor(course.id) }}
                                    isDark={isDark}
                                    onEnroll={handleEnrollClick}
                                    onReserve={handleReserveClick}
                                    onNotify={setInterestCourse}
                                    learningPathNames={[pick(selectedLearningPath, 'title')].filter((name): name is string => !!name)}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className={`rounded-2xl border border-dashed p-6 text-center font-semibold ${isDark ? 'border-white/10 text-gray-400' : 'border-brand-mist text-gray-500'}`}>
                            {locale === 'ar' ? 'لا توجد دورات منشورة في هذا المسار حاليًا.' : 'There are no published courses in this path yet.'}
                        </p>
                    )}
                </section>
            )}

            {/* Login Prompt Modal (guests only) */}
            <LoginPromptModal
                open={showLoginPrompt}
                onClose={() => setShowLoginPrompt(false)}
                redirectTo={pendingCourse
                    ? `/courses/${pendingCourse.id}?intent=${pendingAction}${currentOpening(pendingCourse) ? `&openingId=${encodeURIComponent(currentOpening(pendingCourse)!.id)}` : ''}`
                    : undefined}
            />

            {interestCourse && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-charcoal/60 p-4 backdrop-blur-sm">
                    <form
                        onSubmit={(event) => { event.preventDefault(); void handleInterestSubmit(); }}
                        className={`w-full max-w-md space-y-5 rounded-3xl p-6 shadow-2xl ${isDark ? 'border border-white/10 bg-brand-navy' : 'bg-white'}`}
                    >
                        <div className="flex items-start gap-3">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gold/15 text-brand-gold-dark dark:text-brand-gold-light"><Bell size={20} /></span>
                            <div>
                                <h2 className={`text-xl font-black ${isDark ? 'text-white' : 'text-brand-navy'}`}>{t('explore.notify_title')}</h2>
                                <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{pick(interestCourse, 'title')}</p>
                            </div>
                        </div>
                        <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{t('explore.notify_description')}</p>
                        <label className="block space-y-2">
                            <span className={`text-sm font-bold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{t('explore.notify_contact_method')}</span>
                            <select
                                value={interestMethod}
                                onChange={(event) => setInterestMethod(event.target.value as 'EMAIL' | 'PHONE')}
                                className={selectCls}
                            >
                                <option value="EMAIL">{t('explore.notify_email')}</option>
                                <option value="PHONE">{t('explore.notify_phone')}</option>
                            </select>
                        </label>
                        <label className="block space-y-2">
                            <span className={`text-sm font-bold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{interestMethod === 'EMAIL' ? t('explore.notify_email') : t('explore.notify_phone')}</span>
                            <input
                                required
                                type={interestMethod === 'EMAIL' ? 'email' : 'tel'}
                                autoComplete={interestMethod === 'EMAIL' ? 'email' : 'tel'}
                                value={interestValue}
                                onChange={(event) => setInterestValue(event.target.value)}
                                dir="ltr"
                                className={selectCls}
                                placeholder={interestMethod === 'EMAIL' ? 'name@example.com' : '+967...'}
                            />
                        </label>
                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => setInterestCourse(null)} className={`rounded-xl px-4 py-2.5 text-sm font-bold ${isDark ? 'bg-white/5 text-white' : 'bg-gray-100 text-brand-navy'}`}>
                                {t('common.cancel')}
                            </button>
                            <button type="submit" disabled={interestSubmitting || !interestValue.trim()} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-black text-brand-navy-dark disabled:opacity-50">
                                <Bell size={15} /> {interestSubmitting ? t('common.processing') : t('explore.notify_me')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Enrollment Modal with Receipt Upload */}
            {selectedCourse && (
                <div className="fixed inset-0 bg-brand-charcoal/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className={`rounded-3xl w-full max-w-lg p-8 shadow-2xl transform transition-all max-h-[90vh] overflow-y-auto animate-scale-in ${isDark ? 'bg-brand-navy border border-white/10' : 'bg-white'}`}>
                        <div className="w-12 h-12 bg-gradient-to-br from-brand-gold/25 to-brand-gold/10 rounded-2xl flex items-center justify-center mb-4 text-brand-gold">
                            <BookOpen size={24} />
                        </div>
                        <h2 className={`text-2xl font-black mb-2 ${isDark ? 'text-white' : 'text-brand-navy'}`}>{t('explore.enroll_in')} {pick(selectedCourse, 'title')}</h2>
                        <p className={`mb-4 ${isDark ? 'text-gray-300' : 'text-gray-500'}`}>{t('explore.transfer_part1')} <strong className={isDark ? 'text-brand-gold-light' : 'text-brand-navy'}>{formatPrice(currentOpening(selectedCourse)?.price, { locale })}</strong> {t('explore.transfer_part2')}</p>

                        <div className="mb-6">
                            <label className={`block text-sm font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-gray-300' : 'text-brand-charcoal'}`}>
                                {t('payments.coupon_label')}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    value={couponCode}
                                    onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCoupon(null); }}
                                    placeholder={t('payments.coupon_placeholder')}
                                    className={`flex-1 px-4 py-3 rounded-xl font-mono font-semibold uppercase focus:outline-none focus:ring-2 focus:ring-brand-gold/50 transition ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder:text-gray-600' : 'bg-white border border-brand-mist text-brand-charcoal placeholder:text-gray-500'}`}
                                />
                                <button
                                    onClick={applyCoupon}
                                    disabled={couponChecking || !couponCode.trim()}
                                    className={`px-4 py-3 rounded-xl font-bold transition disabled:opacity-50 whitespace-nowrap cursor-pointer ${isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-brand-mist text-brand-charcoal hover:bg-gray-200'}`}
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
                                    <div className={`flex items-center justify-between mt-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                        <span>{t('payments.coupon_discount')}</span>
                                        <span className="font-bold text-emerald-500">-{formatPrice(coupon.amountOff, { locale })}</span>
                                    </div>
                                    <div className={`flex items-center justify-between mt-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                        <span>{t('payments.coupon_total')}</span>
                                        <span className={`font-black ${isDark ? 'text-white' : 'text-brand-navy'}`}>{formatPrice(coupon.finalAmount, { locale })}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <EnrollSteps step={gatewayId ? 2 : 1} dark={isDark} />

                        <div className="mb-6 space-y-3">
                            <h3 className={`font-bold text-sm uppercase tracking-wider ${isDark ? 'text-gray-300' : 'text-brand-charcoal'}`}>{t('payment.payment_method')}:</h3>
                            <p className={`text-xs -mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('payment.choose_method_hint')}</p>
                            <PaymentMethods
                                gateways={gateways}
                                loading={gatewaysLoading}
                                selectedId={gatewayId}
                                onSelect={(id) => setGatewayId(prev => (prev === id ? null : id))}
                                dark={isDark}
                                emptyLabel={t('explore.no_payment_methods')}
                            />
                        </div>

                        <div className="space-y-3">
                            <h3 className={`font-bold text-sm uppercase tracking-wider ${isDark ? 'text-gray-300' : 'text-brand-charcoal'}`}>{t('payment.step_receipt')}:</h3>
                            {!gatewayId ? (
                                <p className={`text-sm p-3 rounded-xl border flex items-center gap-2 ${isDark ? 'text-gray-400 bg-white/5 border-white/10' : 'text-gray-600 bg-brand-mist/40 border-brand-mist'}`}>
                                    <AlertTriangle size={16} className="flex-shrink-0 text-brand-gold" />
                                    {t('payment.receipt_section_locked')}
                                </p>
                            ) : (
                                <ReceiptDropzone file={receiptFile} onChange={setReceiptFile} dark={isDark} disabled={isSubmitting} />
                            )}
                        </div>

                        <div className="flex gap-3 mt-8">
                            <button
                                onClick={handleEnrollmentSubmit}
                                disabled={isSubmitting || !receiptFile || !gatewayId}
                                className="flex-1 bg-brand-gold hover:bg-brand-gold/90 text-brand-navy py-3.5 font-bold rounded-2xl shadow-sm transition disabled:opacity-50 cursor-pointer"
                            >
                                {isSubmitting ? t('common.submitting') : t('explore.submit_proof')}
                            </button>
                            <button
                                onClick={() => setSelectedCourse(null)}
                                disabled={isSubmitting}
                                className={`flex-1 py-3.5 font-bold rounded-2xl transition cursor-pointer ${isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-brand-mist text-brand-charcoal hover:bg-gray-200'}`}
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