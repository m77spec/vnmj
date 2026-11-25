"use client";

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { hasAnsweredConsent, readConsent, saveConsent, type ConsentPrefs } from '@/lib/consent';
import { applyConsent } from '@/lib/analytics';
import { api } from '@/lib/api';

const LINK_CLS = "w-4 h-4 accent-brand-gold cursor-pointer";

export default function CookieBanner() {
    const { locale } = useI18n();
    const { dark } = useTheme();
    const isAr = locale === 'ar';
    const [visible, setVisible] = useState(false);
    const [analytics, setAnalytics] = useState(false);
    const [marketing, setMarketing] = useState(false);

    useEffect(() => {
        const saved = readConsent();
        if (saved) applyConsent(saved);
        const timer = window.setTimeout(() => {
            if (!hasAnsweredConsent()) setVisible(true);
        }, 800);
        return () => window.clearTimeout(timer);
    }, []);

    const commit = (prefs: ConsentPrefs) => {
        saveConsent(prefs);
        applyConsent(prefs);
        setVisible(false);
        api.post('/consent', { analytics: prefs.analytics, marketing: prefs.marketing }).catch(() => {});
    };

    const acceptAll = () => commit({ necessary: true, analytics: true, marketing: true });
    const acceptNecessary = () => commit({ necessary: true, analytics: false, marketing: false });
    const savePrefs = () => commit({ necessary: true, analytics, marketing });

    if (!visible) return null;

    const containerCls = dark
        ? 'bg-brand-navy-dark border-white/10'
        : 'bg-white border-gray-200';
    const textCls = dark ? 'text-gray-300' : 'text-gray-600';
    const labelCls = dark ? 'text-gray-200' : 'text-gray-800';
    const ghostBtnCls = dark
        ? 'bg-white/10 hover:bg-white/20 text-white'
        : 'bg-brand-mist hover:bg-gray-200 text-brand-navy';
    const outlineBtnCls = dark
        ? 'border border-white/10 hover:bg-white/5 text-gray-300'
        : 'border border-gray-300 hover:bg-brand-mist text-gray-600';

    return (
        <div className={`fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-4 sm:right-auto z-[60] max-w-md ${containerCls} rounded-2xl shadow-2xl p-5`} dir={isAr ? 'rtl' : 'ltr'}>
            <p className={`text-sm ${textCls} leading-relaxed mb-4`}>
                {isAr
                    ? 'نستخدم ملفات الارتباط لتحسين تجربتك. يمكنك اختيار الفئات المسموح بها قبل الموافقة. لمزيد من التفاصيل، راجع سياسة ملفات الارتباط.'
                    : 'We use cookies to improve your experience. Please choose which categories you allow before consenting. See our Cookie Policy for details.'}
            </p>

            <div className={`space-y-2.5 text-sm ${labelCls} font-medium mb-4`}>
                <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className={LINK_CLS} checked disabled readOnly />
                    <span>{isAr ? 'أساسية (مطلوبة)' : 'Strictly necessary (required)'}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className={LINK_CLS} checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
                    <span>{isAr ? 'تحليلات (قياس الأداء)' : 'Analytics (performance measurement)'}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className={LINK_CLS} checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                    <span>{isAr ? 'تسويق' : 'Marketing'}</span>
                </label>
            </div>

            <div className="flex flex-col gap-2.5">
                <button onClick={acceptAll} className="w-full py-2.5 bg-brand-gold hover:bg-[#b08e50] text-brand-navy font-black rounded-xl transition text-sm">
                    {isAr ? 'قبول الكل' : 'Accept all'}
                </button>
                <div className="flex items-center gap-2.5">
                    <button onClick={savePrefs} className={`flex-1 py-2.5 ${ghostBtnCls} font-bold rounded-xl transition text-sm`}>
                        {isAr ? 'حفظ التفضيلات' : 'Save preferences'}
                    </button>
                    <button onClick={acceptNecessary} className={`flex-1 py-2.5 ${outlineBtnCls} font-bold rounded-xl transition text-sm`}>
                        {isAr ? 'الأساسية فقط' : 'Necessary only'}
                    </button>
                </div>
                <a href="/cookies" className="text-center text-sm text-brand-gold font-bold hover:underline">
                    {isAr ? 'معرفة المزيد' : 'Learn more'}
                </a>
            </div>
        </div>
    );
}