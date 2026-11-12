"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { API_BASE_URL, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { formatDate } from '@/lib/format';
import BackHomeButton from '@/components/BackHomeButton';
import BrandLogo from '@/components/BrandLogo';
import { Search, ShieldCheck, ShieldAlert, ExternalLink, Award } from 'lucide-react';

interface CertificateInfo {
    id: string;
    verificationCode: string;
    issuingDate: string;
    verificationStatus: string;
    student?: { id: string } | null;
    holderName?: string;
    course?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
}

interface VerifyResult {
    valid: boolean;
    certificate: CertificateInfo | null;
}

export default function VerifyCertificateForm() {
    const searchParams = useSearchParams();
    const initialCode = searchParams.get('code') || '';
    const [code, setCode] = useState(initialCode);
    const [result, setResult] = useState<VerifyResult | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { locale } = useI18n();
    const { dark } = useTheme();
    const { user } = useAuth();
    const isAr = locale === 'ar';
    const autoRan = useRef(false);

    const verify = useCallback(async (codeToVerify?: string) => {
        const targetCode = (codeToVerify || code).trim();
        if (!targetCode) return;
        setLoading(true);
        setError('');
        setResult(null);
        try {
            const res = await fetch(`${API_BASE_URL}/certificates/verify/${encodeURIComponent(targetCode)}`);
            if (!res.ok) throw new Error('Verification failed');
            const data = await res.json();
            setResult(data);
        } catch (err) {
            setError(getErrorMessage(err) || (isAr ? 'فشل التحقق' : 'Verification failed.'));
        } finally {
            setLoading(false);
        }
    }, [code, isAr]);

    // Auto-verify if code is in URL
    useEffect(() => {
        if (initialCode && !autoRan.current) {
            autoRan.current = true;
            verify(initialCode);
        }
    }, [initialCode, verify]);

    const cert = result?.certificate;

    return (
        <div className={`min-h-screen flex flex-col ${dark ? 'bg-brand-navy-dark' : 'bg-gray-50'}`}>
            <BackHomeButton />
            {/* Header */}
            <header className={`px-6 py-5 flex items-center justify-between border-b backdrop-blur-xl sticky top-0 z-50 ${dark ? 'border-white/5 bg-brand-navy-dark/80' : 'border-gray-200 bg-white/80'}`}>
                <Link href="/" className="flex items-center">
                    <BrandLogo className="h-8 w-auto" />
                </Link>
                <Link href={user ? '/dashboard' : '/login'} className={`text-sm font-bold transition ${dark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-brand-navy'}`}>
                    {user
                        ? (isAr ? 'لوحة القيادة' : 'Dashboard')
                        : (isAr ? 'تسجيل الدخول' : 'Sign in')}
                </Link>
            </header>

            <main className="flex-1 flex flex-col items-center px-4 py-12 sm:py-20">
                {/* Hero */}
                <div className="text-center mb-12 max-w-xl">
                    <div className={`w-18 h-18 w-[72px] h-[72px] mx-auto mb-6 rounded-3xl flex items-center justify-center border ${dark ? 'bg-brand-navy-dark border-white/5' : 'bg-white border-gray-200 shadow-sm'}`}>
                        <ShieldCheck size={36} className={dark ? 'text-brand-gold-light' : 'text-brand-gold-dark'} />
                    </div>
                    <h1 className={`text-4xl sm:text-5xl font-black mb-4 ${dark ? 'text-white' : 'text-brand-navy'}`}>
                        {isAr ? 'التحقق من الشهادة' : 'Verify Certificate'}
                    </h1>
                    <p className={`text-lg leading-relaxed ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {isAr
                            ? 'أدخل رمز التحقق الموجود على الشهادة للتحقق من صحتها رسمياً'
                            : 'Enter the verification code on the certificate to officially verify its authenticity'}
                    </p>
                </div>

                {/* Search form */}
                <div className="w-full max-w-lg">
                    <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="relative">
                        <div className={`relative rounded-2xl border p-2 flex items-center gap-2 shadow-2xl ${dark ? 'bg-brand-navy-dark border-white/5 shadow-black/20' : 'bg-white border-gray-200 shadow-gray-900/5'}`}>
                            <Search size={20} className={`absolute left-5 top-1/2 -translate-y-1/2 rtl:left-auto rtl:right-5 ${dark ? 'text-gray-500' : 'text-gray-400'}`} />
                            <input
                                type="text"
                                required
                                className={`flex-1 min-w-0 bg-transparent font-mono text-sm tracking-wider pl-12 pr-4 py-4 outline-none rtl:pl-4 rtl:pr-12 ${dark ? 'text-white placeholder-gray-500' : 'text-brand-charcoal placeholder-gray-400'}`}
                                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                value={code}
                                dir="ltr"
                                onChange={(e) => setCode(e.target.value.trim())}
                            />
                            <button
                                type="submit"
                                disabled={loading || !code.trim()}
                                className="bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black font-black text-sm px-6 py-3.5 rounded-xl hover:from-brand-gold-light hover:to-brand-gold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                            >
                                {loading
                                    ? (isAr ? 'جارٍ...' : 'Checking...')
                                    : (isAr ? 'تحقق' : 'Verify')}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Error */}
                {error && (
                    <div className={`w-full max-w-lg mt-6 p-5 border rounded-2xl flex items-start gap-3 ${dark ? 'bg-red-500/10 border-red-500/20' : 'bg-red-50 border-red-200'}`}>
                        <ShieldAlert size={20} className={`shrink-0 mt-0.5 ${dark ? 'text-red-400' : 'text-red-600'}`} />
                        <p className={`font-semibold text-sm ${dark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
                    </div>
                )}

                {/* Result */}
                {result && (
                    <div className="w-full max-w-lg mt-8">
                        <div className={`rounded-2xl border overflow-hidden ${
                            result.valid
                                ? dark ? 'bg-brand-navy-dark border-green-500/20' : 'bg-white border-green-200'
                                : dark ? 'bg-brand-navy-dark border-red-500/20' : 'bg-white border-red-200'
                        }`}>
                            {/* Status header */}
                            <div className={`px-6 py-4 flex items-center gap-3 ${
                                result.valid ? 'bg-green-500/10' : 'bg-red-500/10'
                            }`}>
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                    result.valid ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                                }`}>
                                    {result.valid ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
                                </div>
                                <div>
                                    <h2 className={`text-lg font-black ${result.valid ? 'text-green-500' : 'text-red-500'}`}>
                                        {result.valid
                                            ? (isAr ? 'شهادة صالحة' : 'Valid Certificate')
                                            : (isAr ? 'شهادة غير صالحة' : 'Invalid Certificate')}
                                    </h2>
                                    <p className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                                        {result.valid
                                            ? (isAr ? 'تم التحقق من صحة هذه الشهادة بنجاح' : 'This certificate has been successfully verified')
                                            : cert?.verificationStatus === 'REVOKED'
                                                ? (isAr ? 'تم إلغاء هذه الشهادة ولم تعد سارية' : 'This certificate has been revoked and is no longer valid')
                                                : cert?.verificationStatus === 'EXPIRED'
                                                    ? (isAr ? 'انتهت صلاحية هذه الشهادة' : 'This certificate has expired')
                                                    : (isAr ? 'لم يتم العثور على شهادة بهذا الرمز' : 'No certificate found with this code')}
                                    </p>
                                </div>
                            </div>

                            {/* Certificate details */}
                            {result.valid && cert && (
                                <div className="p-6 space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className={`rounded-xl p-4 border ${dark ? 'bg-brand-navy-dark border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                                {isAr ? 'الحاصل على الشهادة' : 'Recipient'}
                                            </p>
                                            <p className={`font-bold text-sm capitalize break-words ${dark ? 'text-white' : 'text-brand-navy'}`}>
                                                {cert.holderName || '—'}
                                            </p>
                                        </div>
                                        <div className={`rounded-xl p-4 border ${dark ? 'bg-brand-navy-dark border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                                {isAr ? 'الدورة' : 'Course'}
                                            </p>
                                            <p className={`font-bold text-sm line-clamp-2 ${dark ? 'text-white' : 'text-brand-navy'}`}>
                                                {isAr ? (cert.course?.titleAr || cert.course?.titleEn) : (cert.course?.titleEn || cert.course?.titleAr) || '—'}
                                            </p>
                                        </div>
                                        <div className={`rounded-xl p-4 border ${dark ? 'bg-brand-navy-dark border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                                {isAr ? 'تاريخ الإصدار' : 'Issue Date'}
                                            </p>
                                            <p className={`font-bold text-sm ${dark ? 'text-white' : 'text-brand-navy'}`}>
                                                {formatDate(cert.issuingDate, { locale })}
                                            </p>
                                        </div>
                                        <div className={`rounded-xl p-4 border ${dark ? 'bg-brand-navy-dark border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                                {isAr ? 'رمز التحقق' : 'Verification Code'}
                                            </p>
                                            <p className={`font-bold text-xs font-mono truncate ${dark ? 'text-white' : 'text-brand-navy'}`} dir="ltr">
                                                {cert.verificationCode.slice(0, 8)}...
                                            </p>
                                        </div>
                                    </div>

                                    {/* View certificate button */}
                                    <Link
                                        href={`/certificate/${cert.id}`}
                                        className={`w-full flex items-center justify-center gap-2 border font-bold py-3.5 rounded-xl transition-all duration-200 ${dark ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-white border-gray-300 text-brand-navy hover:bg-gray-50'}`}
                                    >
                                        <Award size={18} />
                                        {isAr ? 'عرض الشهادة' : 'View Certificate'}
                                        <ExternalLink size={14} />
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Info cards */}
                <div className="w-full max-w-2xl mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                        {
                            icon: ShieldCheck,
                            title: isAr ? 'آمن وموثوق' : 'Secure & Trusted',
                            desc: isAr ? 'جميع الشهادات موثقة رسمياً' : 'All certificates are officially documented',
                        },
                        {
                            icon: Search,
                            title: isAr ? 'بحث فوري' : 'Instant Lookup',
                            desc: isAr ? 'أدخل الرمز واحصل على نتيجة فورية' : 'Enter code for instant verification',
                        },
                        {
                            icon: Award,
                            title: isAr ? 'شهادات عالمية' : 'Global Certificates',
                            desc: isAr ? 'معترف بها عالمياً' : 'Internationally recognized',
                        },
                    ].map((item, i) => (
                        <div key={i} className={`border rounded-2xl p-5 text-center transition-all duration-300 ${dark ? 'bg-brand-navy-dark border-white/5 hover:border-white/10' : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm'}`}>
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3 ${dark ? 'bg-white/5 text-gray-400' : 'bg-brand-mist/60 text-gray-600'}`}>
                                <item.icon size={22} />
                            </div>
                            <h3 className={`font-bold text-sm mb-1 ${dark ? 'text-white' : 'text-brand-navy'}`}>{item.title}</h3>
                            <p className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-500'}`}>{item.desc}</p>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
}