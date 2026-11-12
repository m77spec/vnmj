"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, Role } from '@/lib/auth-context';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import BackHomeButton from '@/components/BackHomeButton';
import BrandLogo from '@/components/BrandLogo';
import { clearPostAuthRedirect } from '@/lib/auth-redirect';

export default function TwoFactorSetupPage() {
    return (
        <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-gray-50 dark:bg-brand-navy-dark dark:text-gray-300 text-gray-600 font-bold">Loading...</div>}>
            <SetupForm />
        </Suspense>
    );
}

function SetupForm() {
    const [loading, setLoading] = useState(true);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [secret, setSecret] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const { login } = useAuth();
    const router = useRouter();
    const { t } = useI18n();
    const { dark } = useTheme();
    const searchParams = useSearchParams();
    const tempToken = searchParams?.get('tempToken') || '';
    const redirect = searchParams?.get('redirect') || '/dashboard';
    const shownError = error || (!tempToken ? t('twoFactorSetup.fail') : '');

    useEffect(() => {
        if (!tempToken) return;
        let alive = true;
        api.post('/auth/2fa/setup', { tempToken })
            .then((res) => {
                if (!alive) return;
                setQrDataUrl(res.data.qrDataUrl || '');
                setSecret(res.data.secret || '');
            })
            .catch(() => {
                if (alive) setError(t('twoFactorSetup.fail'));
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [tempToken, t]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tempToken) {
            setError(t('twoFactorSetup.fail'));
            return;
        }
        setSubmitting(true);
        try {
            setError('');
            const res = await api.post('/auth/2fa/confirm', { tempToken, code: code.trim() });
            const token = res.data.access_token;
            const refreshToken = res.data.refresh_token;

            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(window.atob(base64));

            login(token, {
                userId: payload.sub,
                email: payload.email,
                role: payload.role as Role
            }, refreshToken);

            clearPostAuthRedirect();
            router.push(redirect);
        } catch (err) {
            setError(getErrorMessage(err) || t('twoFactorSetup.fail'));
        } finally {
            setSubmitting(false);
        }
    };

    const cardCls = `w-full max-w-md backdrop-blur-2xl p-6 sm:p-10 rounded-[2rem] relative z-10 transition-all duration-500 ${dark ? 'bg-brand-navy-dark/90 shadow-[0_20px_60px_rgb(0,0,0,0.4)] border border-white/10 hover:border-white/20' : 'bg-white shadow-xl border border-gray-200 hover:shadow-2xl'}`;
    const inputCls = `mt-1 block w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-gold text-center tracking-widest outline-none ${dark ? 'bg-white/5 border-white/10 text-white [color-scheme:dark]' : 'bg-white border-gray-300 text-brand-charcoal'}`;

    return (
        <div className={`min-h-screen flex items-center justify-center relative overflow-hidden p-4 ${dark ? 'bg-brand-navy-dark' : 'bg-gray-50'}`}>
            <div className="absolute top-0 right-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-32 -right-32 w-96 h-96 bg-brand-gold/10 rounded-full blur-[100px] animate-float opacity-70"></div>
                <div className="absolute bottom-0 left-0 w-[30rem] h-[30rem] bg-brand-gold/5 rounded-full blur-[120px] animate-float opacity-70" style={{ animationDelay: '2s', animationDuration: '8s' }}></div>
            </div>

            <div className={`absolute top-6 right-6 rtl:left-6 rtl:right-auto z-50 rounded-full shadow-sm border p-1 ${dark ? 'bg-white/5 backdrop-blur-md border-white/10' : 'bg-white border-gray-200'}`}>
                <LanguageSwitcher />
            </div>
            <BackHomeButton />

            <div className={cardCls}>
                <div className="text-center mb-6">
                    <BrandLogo className="mx-auto h-10 w-auto" />
                    <p className={`mt-2 font-bold ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{t('twoFactorSetup.title')}</p>
                </div>

                {loading ? (
                    <div className={`flex flex-col items-center py-8 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                        <div className="h-12 w-12 rounded-full border-4 border-brand-gold border-t-transparent animate-spin mb-4"></div>
                        <p className="font-bold">{t('twoFactorSetup.loading')}</p>
                    </div>
                ) : (
                    <>
                        <p className={`text-sm text-center mb-4 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{t('twoFactorSetup.sub')}</p>

                        {shownError && <div className={`mb-4 p-3 rounded-md text-sm font-semibold ${dark ? 'bg-red-500/10 border border-red-400/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>{shownError}</div>}

                        {qrDataUrl ? (
                            <div className="flex justify-center mb-4">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={qrDataUrl} alt="QR" className="w-48 h-48 rounded-xl bg-white p-2" />
                            </div>
                        ) : null}

                        {secret ? (
                            <p className={`text-sm text-center mb-4 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('twoFactorSetup.secretHint')}{' '}
                                <span dir="ltr" className="font-mono font-bold select-all text-brand-gold-light">{secret}</span>
                            </p>
                        ) : null}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className={`block text-sm font-bold ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{t('twoFactorSetup.code')}</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    required
                                    className={inputCls}
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                />
                            </div>
                            <button type="submit" disabled={submitting} className="w-full py-4 bg-brand-gold hover:bg-brand-gold-light text-brand-navy-dark font-black rounded-xl shadow-md transition disabled:opacity-60">
                                {submitting ? t('common.processing') : t('twoFactorSetup.verifyCode')}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}