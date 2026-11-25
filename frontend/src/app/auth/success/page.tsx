"use client";

import { useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, Role } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import BackHomeButton from '@/components/BackHomeButton';
import { trackEvent } from '@/lib/analytics';

function SuccessHandler() {
    const router = useRouter();
    const { login } = useAuth();
    const { t } = useI18n();
    const { dark } = useTheme();

    useEffect(() => {
        // Read tokens from hash fragment (#) — these are never sent to the server
        // or logged in browser/server/proxy logs.
        const hash = window.location.hash.slice(1);
        const params = new URLSearchParams(hash);

        const twoFactor = params.get('twoFactor');
        const tempToken = params.get('tempToken');
        const token = params.get('token');
        const refresh = params.get('refresh');
        const completeProfile = params.get('completeProfile') === '1';

        if (twoFactor === '1' && tempToken) {
            router.push(`/auth/two-factor?tempToken=${encodeURIComponent(tempToken)}`);
            return;
        }

        if (params.get('twoFactorSetup') === '1' && tempToken) {
            router.push(`/auth/two-factor-setup?tempToken=${encodeURIComponent(tempToken)}`);
            return;
        }

        if (token) {
            try {
                const base64Url = token.split('.')[1];
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                const payload = JSON.parse(window.atob(base64));

                if (completeProfile) trackEvent('sign_up', { method: 'google' });
                login(token, {
                    userId: payload.sub,
                    email: payload.email,
                    role: payload.role as Role
                }, refresh || undefined, 'google');

                router.push(completeProfile ? '/auth/complete-profile' : '/dashboard');
            } catch (err) {
                console.error('Failed to parse token', err);
                router.push('/login');
            }
        } else {
            router.push('/login');
        }
    }, [router, login]);

    return (
        <div className={`flex h-screen w-full items-center justify-center ${dark ? 'bg-brand-navy-dark' : 'bg-gray-50'}`}>
            <BackHomeButton />
            <div className="animate-pulse flex flex-col items-center">
                <div className="h-12 w-12 rounded-full border-4 border-brand-gold border-t-transparent animate-spin mb-4"></div>
                <p className={`font-bold ${dark ? 'text-brand-gold-light' : 'text-brand-gold-dark'}`}>{t('authSuccess.completing')}</p>
            </div>
        </div>
    );
}

export default function AuthSuccessPage() {
    const { t } = useI18n();

    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center">{t('authSuccess.loading')}</div>}>
            <SuccessHandler />
        </Suspense>
    );
}
