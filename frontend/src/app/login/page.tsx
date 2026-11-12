"use client";

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, Role } from '@/lib/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getErrorMessage, isEmailNotVerified } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { Home } from 'lucide-react';

// Each application surface accepts only its own account roles.
const APP_MODE = (process.env.NEXT_PUBLIC_APP_MODE || 'learner') === 'admin' ? 'admin' : 'learner';
const PRIVILEGED_ROLES = ['ADMIN', 'FINANCE', 'COURSE_MANAGER'];

function getTokenPayload(token: string): { sub?: string; email?: string; role?: string } | null {
    try {
        const base64Url = token.split('.')[1];
        if (!base64Url) return null;
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(window.atob(base64));
    } catch {
        return null;
    }
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-gray-50 dark:bg-brand-navy-dark dark:text-gray-300 text-gray-600 font-bold">Loading...</div>}>
            <LoginForm />
        </Suspense>
    );
}

function LoginForm() {
    const searchParams = useSearchParams();
    const [email, setEmail] = useState(searchParams?.get('email') || '');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [needsVerification, setNeedsVerification] = useState(searchParams?.get('verificationEmailFailed') === '1');
    const [resendingVerification, setResendingVerification] = useState(false);
    const [verificationResent, setVerificationResent] = useState(false);
    const { login, isAuthenticated } = useAuth();
    const router = useRouter();
    const { t } = useI18n();
    const { dark } = useTheme();
    const redirect = searchParams?.get('redirect') || '/dashboard';

    useEffect(() => {
        if (isAuthenticated) router.replace('/dashboard');
    }, [isAuthenticated, router]);

    const inputCls = `block w-full px-4 py-3.5 border rounded-xl focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition-all duration-200 ${dark ? 'bg-white/5 border-white/10 text-white hover:bg-white/10 [color-scheme:dark]' : 'bg-white border-gray-300 text-brand-charcoal hover:bg-gray-50'}`;
    const labelCls = `block text-sm font-black mb-1.5 ${dark ? 'text-gray-300' : 'text-gray-700'}`;

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setError('');
            const res = await api.post('/auth/login', { email, password });
            const body = res.data;
            const sessionToken = body.access_token || body.tempToken;
            if (!sessionToken) {
                setError(t('auth.login_failed'));
                return;
            }

            const payload = getTokenPayload(sessionToken);
            if (!payload?.role || !payload.sub || !payload.email) {
                setError(t('auth.login_failed'));
                return;
            }
            const privileged = PRIVILEGED_ROLES.includes(payload.role);
            if ((APP_MODE === 'learner' && privileged) || (APP_MODE === 'admin' && !privileged)) {
                setError(t('auth.login_failed'));
                return;
            }

            if (body.requiresTwoFactor && body.tempToken) {
                router.push(`/auth/two-factor?tempToken=${encodeURIComponent(body.tempToken)}&redirect=${encodeURIComponent(redirect)}`);
                return;
            }

            if (body.requiresTwoFactorSetup && body.tempToken) {
                router.push(`/auth/two-factor-setup?tempToken=${encodeURIComponent(body.tempToken)}&redirect=${encodeURIComponent(redirect)}`);
                return;
            }

            if (body.requiresPasswordChange && body.tempToken) {
                router.push(`/auth/change-password?tempToken=${encodeURIComponent(body.tempToken)}&redirect=${encodeURIComponent(redirect)}`);
                return;
            }

            const token = body.access_token as string;
            if (!token) {
                setError(t('auth.login_failed'));
                return;
            }
            const refreshToken = body.refresh_token;

            login(token, {
                userId: payload.sub,
                email: payload.email,
                role: payload.role as Role
            }, refreshToken);

            router.push(redirect);
        } catch (err) {
            const message = getErrorMessage(err);
            if (isEmailNotVerified(err)) {
                setNeedsVerification(true);
                setError('');
            } else {
                setError(message || t('auth.login_failed'));
            }
        }
    };

    const handleResendVerification = async () => {
        setResendingVerification(true);
        try {
            await api.post('/auth/resend-verification-email', { email });
            setVerificationResent(true);
        } catch (err) {
            setError(getErrorMessage(err) || t('auth.verification_resend_failed'));
        } finally {
            setResendingVerification(false);
        }
    };

    if (isAuthenticated) {
        return (
            <div className={`min-h-screen flex items-center justify-center font-bold ${dark ? 'bg-brand-navy-dark text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                {t('common.loading')}
            </div>
        );
    }

    return (
        <div className={`min-h-screen flex items-center justify-center relative overflow-hidden p-4 ${dark ? 'bg-brand-navy-dark' : 'bg-gray-50'}`}>
            {/* Background elements */}
            <div className="absolute top-0 right-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-32 -right-32 w-96 h-96 bg-brand-gold/10 rounded-full blur-[100px] animate-float opacity-70"></div>
                <div className="absolute bottom-0 left-0 w-[30rem] h-[30rem] bg-brand-gold/5 rounded-full blur-[120px] animate-float opacity-70" style={{ animationDelay: '2s', animationDuration: '8s' }}></div>
            </div>

            <div className={`absolute top-6 right-6 rtl:left-6 rtl:right-auto z-50 rounded-full shadow-sm border p-1 ${dark ? 'bg-white/5 backdrop-blur-md border-white/10' : 'bg-white border-gray-200'}`}>
                <LanguageSwitcher />
            </div>
            <Link
                href="/"
                className={`absolute top-6 left-6 rtl:right-6 rtl:left-auto z-50 inline-flex items-center gap-2 rounded-full shadow-sm border px-4 py-2.5 text-sm font-bold transition-colors ${dark ? 'bg-white/5 backdrop-blur-md border-white/10 text-gray-300 hover:text-brand-gold-light hover:border-white/20' : 'bg-white border-gray-200 text-brand-navy hover:text-brand-gold-dark hover:border-gray-300'}`}
            >
                <Home size={15} />
                {t('landing.home')}
            </Link>
            <div className={`w-full max-w-md backdrop-blur-2xl p-6 sm:p-10 rounded-[2rem] relative z-10 transition-all duration-500 ${dark ? 'bg-brand-navy-dark/90 shadow-[0_20px_60px_rgb(0,0,0,0.4)] border border-white/10 hover:border-white/20' : 'bg-white shadow-xl border border-gray-200 hover:shadow-2xl'}`}>
                <div className="text-center mb-8">
                    <img
                        src={dark ? '/logos/LaxaLab_Academy_Stacked_Reverse_4K.png' : '/logos/LaxaLab_Academy_Stacked_Primary_4K.png'}
                        alt="Laxalab Academy"
                        className="h-24 w-auto object-contain mx-auto mb-2 drop-shadow-sm"
                    />
                    <p className={`mt-2 font-bold ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{t('auth.welcome_back')}</p>
                </div>

                {error && <div className={`mb-4 p-3 rounded-md text-sm font-semibold animate-fade-in-up ${dark ? 'bg-red-500/10 border border-red-400/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>{error}</div>}
                {searchParams?.get('oauthError') === '1' && (
                    <div className={`mb-4 p-3 rounded-xl text-sm font-semibold ${dark ? 'bg-red-500/10 border border-red-400/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                        {t('auth.google_signin_failed')}
                    </div>
                )}
                {searchParams?.get('verifyEmail') === '1' && (
                    <div className={`mb-4 p-3 rounded-xl text-sm font-semibold ${dark ? 'bg-brand-gold/10 border border-brand-gold/20 text-brand-gold-light' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
                        {t('auth.check_verification_email')}
                    </div>
                )}
                {searchParams?.get('verificationEmailFailed') === '1' && (
                    <div className={`mb-4 p-3 rounded-xl text-sm font-semibold ${dark ? 'bg-brand-gold/10 border border-brand-gold/20 text-brand-gold-light' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
                        {t('auth.verification_delivery_failed')}
                    </div>
                )}
                {needsVerification && (
                    <div className={`mb-4 p-4 rounded-xl text-sm ${dark ? 'bg-brand-gold/10 border border-brand-gold/20 text-gray-200' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
                        <p className="font-semibold">{t('auth.verification_required')}</p>
                        {verificationResent ? (
                            <p className="mt-2">{t('auth.verification_resent')}</p>
                        ) : (
                            <button
                                type="button"
                                onClick={handleResendVerification}
                                disabled={resendingVerification || !email}
                                className="mt-3 font-black underline disabled:opacity-60"
                            >
                                {resendingVerification ? t('common.processing') : t('auth.resend_verification')}
                            </button>
                        )}
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-5">
                    <div>
                        <label className={labelCls}>{t('auth.email')}</label>
                        <input
                            type="email"
                            required
                            className={inputCls}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelCls}>{t('auth.password')}</label>
                        <input
                            type="password"
                            required
                            className={inputCls}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <button type="submit" className="w-full py-4 bg-brand-gold hover:bg-brand-gold-light text-brand-navy-dark focus:ring-4 focus:ring-brand-gold/30 font-black rounded-xl shadow-md transition-all duration-300 transform active:scale-[0.98] animate-fade-in-up">
                        {t('auth.sign_in')}
                    </button>

                    <div className="relative flex items-center justify-center my-6 text-sm">
                        <span className={`absolute px-3 font-bold z-10 ${dark ? 'bg-brand-navy-dark text-gray-400' : 'bg-white text-gray-500'}`}>{t('common.or')}</span>
                        <div className={`w-full h-px ${dark ? 'bg-white/10' : 'bg-gray-200'}`}></div>
                    </div>

                    <button
                        type="button"
                        onClick={() => router.push('/api/auth/google')}
                        className={`w-full flex items-center justify-center gap-3 py-4 border font-bold rounded-xl transition-all duration-200 ${dark ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-white' : 'bg-white border-gray-300 hover:bg-gray-50 text-brand-charcoal'}`}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        {t('auth.continue_with_google')}
                    </button>
                </form>

                <div className="mt-8 text-center space-y-3">
                    {APP_MODE !== 'admin' && (
                    <p className={`text-sm font-semibold ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {t('auth.dont_have_account')}{' '}
                        <a href="/register" className={`font-black transition-colors ${dark ? 'text-brand-gold-light hover:text-brand-gold' : 'text-brand-gold-dark hover:text-brand-gold'}`}>
                            {t('auth.register_now')}
                        </a>
                    </p>
                )}
                    <p className="text-sm">
                        <a href="/forgot-password" className={`flex items-center justify-center font-bold transition-colors ${dark ? 'text-brand-gold hover:text-brand-gold-light' : 'text-brand-gold-dark hover:text-brand-gold'}`}>
                            {t('recovery.forgotLink')}
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
}