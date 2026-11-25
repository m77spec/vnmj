"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { formatPrice } from '@/lib/format';
import { api, getErrorMessage, downloadProtectedFile } from '@/lib/api';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { Wallet, CheckCircle, Clock, XCircle, AlertTriangle, X, CalendarCheck, Eye } from 'lucide-react';
import Link from 'next/link';
import PaymentMethods, { type PaymentGateway } from '@/components/payment/PaymentMethods';
import ReceiptDropzone from '@/components/payment/ReceiptDropzone';
import EnrollSteps from '@/components/payment/EnrollSteps';

interface Opening {
    id: string;
    status?: string | null;
    price: string;
    currency?: string;
    nameAr?: string | null;
    nameEn?: string | null;
}

interface Course {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    openings?: Opening[];
}

interface Enrollment {
    id: string;
    status: string;
    createdAt: string;
    financeOfficerNotes?: string | null;
    receiptFileUrl?: string | null;
    course: {
        id: string;
        titleAr?: string | null;
        titleEn?: string | null;
    };
    opening?: {
        id: string;
        nameAr?: string | null;
        nameEn?: string | null;
        price: string;
        currency?: string;
    } | null;
}

interface PayableEnrollment {
    enrollment: Enrollment;
    defaultOpeningId: string;
}

export default function PaymentsPage() {
    const { t, pick, locale } = useI18n();
    const { data: enrollments, loading, error, refetch } = useFetchData<Enrollment[]>('/enrollments/my');
    const { data: courses } = useFetchData<Course[]>('/courses');
    const { data: gateways, loading: gatewaysLoading } = useFetchData<PaymentGateway[]>('/payment-gateways');

    const [payable, setPayable] = useState<PayableEnrollment | null>(null);
    const [openingId, setOpeningId] = useState('');
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [gatewayId, setGatewayId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [couponCode, setCouponCode] = useState('');
    const [coupon, setCoupon] = useState<{ name: string; amountOff: number; finalAmount: number } | null>(null);
    const [couponChecking, setCouponChecking] = useState(false);

    const statusLabel = (status: string) => t('statuses.' + (status || '').toLowerCase()) || status;

    const announcedCourses = (courses || []).filter(c => c.openings?.some(o => o.status === 'ANNOUNCEMENT'));
    const enrolledCourseIds = new Set((enrollments || []).map(e => e.course.id));

    const closeModal = () => { setPayable(null); setOpeningId(''); setReceiptFile(null); setGatewayId(null); setCouponCode(''); setCoupon(null); };

    const openPayModal = (enrollment: Enrollment) => {
        const defaultOpeningId = enrollment.opening?.id || enrollment.course && (courses || [])
            .find(c => c.id === enrollment.course.id)?.openings?.find(o => o.status === 'OPEN')?.id || '';
        setPayable({ enrollment, defaultOpeningId });
        setOpeningId(defaultOpeningId);
        setReceiptFile(null);
        setGatewayId(null);
        setCouponCode('');
        setCoupon(null);
    };

    const handleReserveClick = async (courseId: string) => {
        try {
            await api.post('/enrollments/reserve', { courseId });
            toast.success(t('payments.reserve_success'));
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('payments.reserve_failed'));
        }
    };

    const handleDownloadReceipt = async (enrollmentId: string) => {
        setDownloadingId(enrollmentId);
        try {
            await downloadProtectedFile(`/enrollments/${enrollmentId}/receipt`);
            toast.success(t('payments.receipt_downloaded'));
        } catch (err) {
            toast.error(getErrorMessage(err) || t('payments.receipt_download_failed'));
        } finally {
            setDownloadingId(null);
        }
    };

    const handleSubmit = async () => {
        if (!payable) return;
        if (!openingId) {
            toast.error(t('payments.select_opening_required'));
            return;
        }
        if (!gatewayId) {
            toast.error(t('payment.select_method_first'));
            return;
        }
        if (!receiptFile) {
            toast.error(t('payments.upload_receipt_required'));
            return;
        }
        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('openingId', openingId);
            formData.append('gatewayId', gatewayId);
            formData.append('receipt', receiptFile);
            if (couponCode.trim()) formData.append('couponCode', couponCode.trim());
            await api.post('/enrollments', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            toast.success(t('payments.receipt_uploaded'));
            closeModal();
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('payments.upload_failed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const availableOpenings = payable
        ? ((courses || []).find(c => c.id === payable.enrollment.course.id)?.openings || []).filter(o => o.status === 'OPEN' || o.status === 'ANNOUNCEMENT')
        : [];

    const selectedOpening = payable
        ? availableOpenings.find(o => o.id === openingId) || (payable.enrollment.opening?.id === openingId ? payable.enrollment.opening : null)
        : null;
    const basePrice = selectedOpening ? Number(selectedOpening.price) : null;

    const applyCoupon = async () => {
        if (!payable || !couponCode.trim()) return;
        setCouponChecking(true);
        try {
            const res = await api.post('/finance/coupons/validate', {
                code: couponCode.trim(),
                courseId: payable.enrollment.course.id,
                price: basePrice ?? undefined,
            });
            setCoupon({
                name: res.data.name,
                amountOff: Number(res.data.amountOff || 0),
                finalAmount: Number(res.data.finalAmount ?? basePrice ?? 0),
            });
            toast.success(t('payments.coupon_applied'));
        } catch (err) {
            setCoupon(null);
            toast.error(getErrorMessage(err) || t('payments.coupon_invalid'));
        } finally {
            setCouponChecking(false);
        }
    };

    const statusBadge = (status: string) => {
        const cls = status === 'APPROVED' ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : status === 'REJECTED' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : status === 'RESERVED' ? 'bg-brand-navy-light/10 text-brand-navy-light border-brand-navy-light/20'
                    : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
        const Icon = status === 'APPROVED' ? CheckCircle : status === 'REJECTED' ? XCircle : Clock;
        return (
            <span className={`px-3 py-1 text-xs font-bold rounded-full border flex items-center gap-1.5 w-fit ${cls}`}>
                <Icon size={12} /> {statusLabel(status)}
            </span>
        );
    };

    return (
        <ProtectedRoute allowedRoles={['STUDENT']}>
            <div className="min-w-0 bg-white dark:bg-brand-navy-dark p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 min-h-[80vh] space-y-8 sm:space-y-10">
                <div className="mb-2">
                    <h2 className="text-2xl sm:text-3xl font-black text-brand-navy dark:text-white flex items-center gap-2 sm:gap-3">
                        <Wallet size={26} className="shrink-0 text-brand-gold-dark dark:text-brand-gold-light sm:w-8 sm:h-8" /> {t('payments.heading')}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">{t('payments.subtitle')}</p>
                </div>

                {error && <div className="p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl">{error}</div>}

                {/* Reserve a seat in announced courses */}
                {!loading && announcedCourses.length > 0 && (
                    <section>
                        <h3 className="text-xl font-black text-brand-navy dark:text-white mb-4 flex items-center gap-2">
                            <CalendarCheck size={22} className="text-brand-gold-dark dark:text-brand-gold-light" /> {t('payments.reserve_section')}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {announcedCourses.filter(c => !enrolledCourseIds.has(c.id)).map(course => {
                                const opening = course.openings!.find(o => o.status === 'ANNOUNCEMENT')!;
                                return (
                                    <div key={course.id} className="border border-white/5 rounded-2xl p-5 bg-brand-navy flex flex-wrap items-center justify-between gap-4">
                                         <div className="min-w-0">
                                             <h4 className="font-bold text-white line-clamp-2">{pick(course, 'title')}</h4>
                                            <p className="text-sm text-gray-400 mt-1">
                                                {pick(opening, 'name')} · <strong className="text-green-400">{formatPrice(opening.price, { currency: opening.currency, locale })}</strong>
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleReserveClick(course.id)}
                                            className="bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black text-sm font-bold px-4 py-2.5 rounded-xl hover:from-brand-gold-light hover:to-brand-gold transition whitespace-nowrap"
                                        >
                                            {t('courseDetail.reserve_seat')}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Financial history */}
                <section>
                    <h3 className="text-xl font-black text-brand-navy dark:text-white mb-4">{t('payments.history_section')}</h3>
                    {loading ? (
                        <div className="h-40 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('payments.loading')}</div>
                    ) : (enrollments || []).length === 0 ? (
                        <div className="text-center py-16 text-gray-500 dark:text-gray-400 font-semibold text-lg border-2 border-dashed border-gray-300 dark:border-white/10 rounded-xl bg-gray-100/50 dark:bg-transparent">
                            {t('payments.empty_history')}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {(enrollments || []).map((enrollment) => (
                                <div key={enrollment.id} className="border border-white/5 rounded-2xl p-5 bg-brand-navy">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <h4 className="font-black text-white text-lg">
                                                <Link href={`/courses/${enrollment.course.id}`} className="hover:text-brand-gold-light transition-colors">
                                                    {pick(enrollment.course, 'title')}
                                                </Link>
                                            </h4>
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-400">
                                                {pick(enrollment.opening, 'name') && <span>{pick(enrollment.opening, 'name')}</span>}
                                                {enrollment.opening?.price != null && <span className="text-green-400 font-bold">{formatPrice(enrollment.opening.price, { currency: enrollment.opening.currency, locale })}</span>}
                                                <span>{t('myCourses.enrolled_on')} {new Date(enrollment.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        {statusBadge(enrollment.status)}
                                    </div>

                                    {enrollment.financeOfficerNotes && (
                                        <div className="mt-3 p-3 bg-red-500/10 rounded-xl text-xs text-red-400 border border-red-500/20">
                                            <strong>{t('myCourses.finance_note')}</strong> {enrollment.financeOfficerNotes}
                                        </div>
                                    )}

                                    <div className="mt-4 pt-4 border-t border-white/5 flex flex-wrap items-center gap-3">
                                        {enrollment.receiptFileUrl && (
                                            <button
                                                onClick={() => handleDownloadReceipt(enrollment.id)}
                                                disabled={downloadingId === enrollment.id}
                                                className="text-sm font-bold px-4 py-2.5 rounded-xl border border-white/10 text-white hover:border-brand-gold hover:text-brand-gold-light transition flex items-center gap-2 disabled:opacity-60"
                                            >
                                                <Eye size={16} /> {t('payments.view_receipt')}
                                            </button>
                                        )}
                                        {enrollment.status !== 'APPROVED' && (
                                            <button
                                                onClick={() => openPayModal(enrollment)}
                                                className="bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black text-sm font-bold px-4 py-2.5 rounded-xl hover:from-brand-gold-light hover:to-brand-gold transition"
                                            >
                                                {enrollment.status === 'RESERVED' || enrollment.status === 'REJECTED'
                                                    ? t('payments.pay_now')
                                                    : t('payments.upload_receipt')}
                                            </button>
                                        )}
                                        {enrollment.status === 'APPROVED' && (
                                            <span className="text-sm font-bold text-green-400">{t('payments.fully_paid')}</span>
                                        )}
                                        {enrollment.status === 'RESERVED' && (
                                            <span className="text-xs text-gray-400 font-semibold">{t('payments.reserved_hint')}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {/* Upload receipt modal */}
            {payable && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-brand-navy-dark rounded-2xl w-full max-w-lg p-4 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto border border-white/10">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-black text-white">{t('payments.upload_title')}</h2>
                            <button onClick={closeModal} className="text-gray-400 hover:text-white transition" aria-label="Close">
                                <X size={22} />
                            </button>
                        </div>
                        <p className="text-gray-400 mb-6">{pick(payable.enrollment.course, 'title')}</p>

                        <EnrollSteps step={gatewayId ? 2 : 1} dark />

                        {(payable.enrollment.opening?.id || availableOpenings.length > 0) ? (
                            <div className="mb-5">
                                <label className="block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">
                                    {t('payments.select_opening')}
                                </label>
                                <select
                                    value={openingId}
                                    onChange={(e) => { setOpeningId(e.target.value); setCoupon(null); }}
                                    className="w-full border border-white/10 rounded-xl px-4 py-3 bg-brand-navy-dark font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand-gold"
                                >
                                    {payable.enrollment.opening?.id && (
                                        <option value={payable.enrollment.opening.id}>
                                            {pick(payable.enrollment.opening, 'name') || payable.enrollment.opening.id}
                                        </option>
                                    )}
                                    {availableOpenings.filter(o => o.id !== payable.enrollment.opening?.id).map(o => (
                                        <option key={o.id} value={o.id}>{pick(o, 'name') || o.id}</option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="p-3 bg-yellow-500/10 rounded-xl text-sm text-yellow-400 border border-yellow-500/20 mb-5">
                                {t('payments.no_open_opening')}
                            </div>
                        )}

                        <div className="mb-5">
                            <label className="block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">
                                {t('payments.coupon_label')}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    value={couponCode}
                                    onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCoupon(null); }}
                                    placeholder={t('payments.coupon_placeholder')}
                                    className="flex-1 border border-white/10 rounded-xl px-4 py-3 bg-brand-navy-dark font-mono font-semibold text-white uppercase placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                                />
                                <button
                                    onClick={applyCoupon}
                                    disabled={couponChecking || !couponCode.trim()}
                                    className="bg-white/5 hover:bg-white/10 text-white font-bold px-4 py-3 rounded-xl border border-white/10 transition disabled:opacity-50 whitespace-nowrap"
                                >
                                    {couponChecking ? t('common.processing') : t('payments.coupon_apply')}
                                </button>
                            </div>
                            {coupon && (
                                <div className="mt-3 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-sm">
                                    <div className="flex items-center justify-between text-green-400 font-bold">
                                        <span>{coupon.name}</span>
                                        <button onClick={() => { setCoupon(null); setCouponCode(''); }} className="text-xs font-bold underline">
                                            {t('payments.coupon_remove')}
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between mt-1 text-gray-300">
                                        <span>{t('payments.coupon_discount')}</span>
                                        <span className="font-bold text-green-400">-${coupon.amountOff}</span>
                                    </div>
                                    {basePrice != null && (
                                        <div className="flex items-center justify-between mt-1 text-gray-300">
                                            <span>{t('payments.coupon_total')}</span>
                                            <span className="font-black text-white">${coupon.finalAmount}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="mb-5">
                            <label className="block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">
                                {t('payment.payment_method')}
                            </label>
                            <p className="text-xs text-gray-500 mb-3">{t('payment.choose_method_hint')}</p>
                            <PaymentMethods
                                gateways={gateways}
                                loading={gatewaysLoading}
                                selectedId={gatewayId}
                                onSelect={(id) => setGatewayId(prev => (prev === id ? null : id))}
                                dark
                                emptyLabel={t('explore.no_payment_methods')}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">
                                {t('payment.step_receipt')}
                            </label>
                            {!gatewayId ? (
                                <p className="text-sm p-3 rounded-xl border flex items-center gap-2 text-gray-400 bg-white/5 border-white/10">
                                    <AlertTriangle size={16} className="flex-shrink-0 text-brand-gold" />
                                    {t('payment.receipt_section_locked')}
                                </p>
                            ) : (
                                <ReceiptDropzone file={receiptFile} onChange={setReceiptFile} dark disabled={isSubmitting} />
                            )}
                        </div>

                        <div className="flex gap-4 mt-8">
                            <button
                                onClick={handleSubmit}
                                disabled={isSubmitting || !receiptFile || !openingId || !gatewayId}
                                className="flex-1 bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-light hover:to-brand-gold text-black py-3 font-bold rounded-xl shadow-sm transition disabled:opacity-50"
                            >
                                {isSubmitting ? t('common.submitting') : t('payments.submit_receipt')}
                            </button>
                            <button
                                onClick={closeModal}
                                disabled={isSubmitting}
                                className="flex-1 bg-white/5 text-white hover:bg-white/10 py-3 font-bold rounded-xl transition border border-white/10"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ProtectedRoute>
    );
}
