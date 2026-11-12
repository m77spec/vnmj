"use client";

import { useRouter } from 'next/navigation';
import { LogIn, UserPlus } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { persistPostAuthRedirect } from '@/lib/auth-redirect';

interface LoginPromptModalProps {
    open: boolean;
    onClose: () => void;
    /** Path to return to after login, e.g. `/courses/abc`. */
    redirectTo?: string;
}

/**
 * Shown when a visitor hits a course action (enroll / reserve) without an
 * account. The backend returns a bare 401 for these, so the guard has to live
 * here or the visitor only ever sees "Unauthorized".
 */
export default function LoginPromptModal({ open, onClose, redirectTo }: LoginPromptModalProps) {
    const router = useRouter();
    const { t } = useI18n();
    const { dark } = useTheme();
    if (!open) return null;

    const withRedirect = (path: string) => {
        if (!redirectTo) return path;
        persistPostAuthRedirect(redirectTo);
        return `${path}?redirect=${encodeURIComponent(redirectTo)}`;
    };

    return (
        <div className="fixed inset-0 bg-brand-charcoal/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className={`rounded-3xl w-full max-w-md p-8 shadow-2xl text-center animate-scale-in ${dark ? 'bg-brand-navy border border-white/10' : 'bg-white'}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="w-16 h-16 bg-gradient-to-br from-brand-gold/25 to-brand-gold/10 rounded-2xl flex items-center justify-center mx-auto mb-6 text-brand-gold">
                    <LogIn size={32} />
                </div>
                <h2 className={`text-2xl font-black mb-3 ${dark ? 'text-white' : 'text-brand-navy'}`}>
                    {t('explore.login_prompt_title')}
                </h2>
                <p className={`mb-8 ${dark ? 'text-gray-300' : 'text-gray-500'}`}>{t('explore.login_prompt_desc')}</p>
                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => router.push(withRedirect('/login'))}
                        className={`w-full font-bold py-4 rounded-2xl transition cursor-pointer ${dark ? 'bg-brand-gold hover:bg-brand-gold-light text-brand-navy-dark' : 'bg-brand-navy hover:bg-brand-charcoal text-white'}`}
                    >
                        {t('auth.login')}
                    </button>
                    <button
                        onClick={() => router.push(withRedirect('/register'))}
                        className={`w-full font-bold py-4 rounded-2xl transition flex items-center justify-center gap-2 cursor-pointer ${dark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-brand-mist text-brand-charcoal hover:bg-gray-200'}`}
                    >
                        <UserPlus size={18} /> {t('auth.register')}
                    </button>
                    <button
                        onClick={onClose}
                        className={`font-semibold text-sm mt-1 cursor-pointer transition ${dark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-800'}`}
                    >
                        {t('common.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
}
