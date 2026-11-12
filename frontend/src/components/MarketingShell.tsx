"use client";

import Link from 'next/link';
import { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import PublicMobileMenu from '@/components/PublicMobileMenu';
import ThemeToggle from '@/components/ThemeToggle';

export default function MarketingShell({ children, title, subtitle }: { children: ReactNode; title?: ReactNode; subtitle?: ReactNode }) {
    const { locale } = useI18n();
    const { user } = useAuth();
    const { dark } = useTheme();
    const isAr = locale === 'ar';

    const linkCls = dark
        ? 'text-brand-mist/90 font-bold hover:text-brand-gold-light transition'
        : 'text-gray-600 font-bold hover:text-brand-gold-dark transition';
    const footerLinkCls = dark
        ? 'hover:text-brand-gold-light transition'
        : 'hover:text-brand-gold-dark transition';
    const footerHeadingCls = dark
        ? 'text-sm font-black text-white mb-3 tracking-wide'
        : 'text-sm font-black text-brand-navy mb-3 tracking-wide';
    const primaryBtnCls = dark
        ? 'bg-brand-gold text-brand-navy-dark hover:bg-brand-gold-light px-6 py-2.5 rounded-xl font-bold transition-all duration-300 shadow-md'
        : 'bg-brand-navy text-white hover:bg-brand-charcoal px-6 py-2.5 rounded-xl font-bold transition-all duration-300 shadow-md';
    const signInCls = dark
        ? 'text-brand-mist hover:text-brand-gold-light font-bold transition'
        : 'text-brand-navy hover:text-brand-charcoal font-bold transition';

    return (
        <div className={`${dark ? 'bg-brand-navy-dark' : 'bg-white'} min-h-screen flex flex-col`}>
            <header className={`px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap lg:flex-nowrap items-center justify-between gap-x-4 gap-y-3 sticky top-0 z-50 ${dark ? 'bg-brand-navy-dark/85 backdrop-blur-xl border-b border-white/5' : 'glass-panel'}`}>
                <Link href="/" className="flex items-center">
                    <img
                        src={dark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                        alt="Laxalab Academy Logo"
                        className="h-9 sm:h-10 lg:h-12 w-auto max-w-[50vw] object-contain transition-transform duration-300 hover:scale-[1.02]"
                    />
                </Link>
                <nav className="hidden lg:flex items-center gap-7">
                    <Link href="/courses" className={linkCls}>
                        {isAr ? 'الدورات' : 'Courses'}
                    </Link>
                    <Link href="/about" className={linkCls}>
                        {isAr ? 'من نحن' : 'About Us'}
                    </Link>
                    <Link href="/instructors" className={linkCls}>
                        {isAr ? 'المدرسون' : 'Instructors'}
                    </Link>
                    <Link href="/faq" className={linkCls}>
                        {isAr ? 'الأسئلة الشائعة' : 'FAQ'}
                    </Link>
                    <Link href="/contact" className={linkCls}>
                        {isAr ? 'تواصل معنا' : 'Contact'}
                    </Link>
                </nav>
                <div className="flex items-center gap-4">
                    <PublicMobileMenu />
                    <div className="hidden sm:flex items-center gap-4">
                        <ThemeToggle />
                        <LanguageSwitcher />
                        {user ? (
                            <Link href="/dashboard">
                                <button className={primaryBtnCls}>
                                    {isAr ? 'لوحة التحكم' : 'Dashboard'}
                                </button>
                            </Link>
                        ) : (
                            <>
                                <Link href="/login">
                                    <button className={signInCls}>
                                        {isAr ? 'تسجيل الدخول' : 'Sign in'}
                                    </button>
                                </Link>
                                <Link href="/register">
                                    <button className={primaryBtnCls}>
                                        {isAr ? 'إنشاء حساب' : 'Register'}
                                    </button>
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            </header>

            {title && (
                <div className={dark ? 'bg-brand-navy' : 'bg-brand-navy'}>
                    <div className="max-w-5xl mx-auto px-6 py-16 text-center">
                        <h1 className="text-4xl md:text-5xl font-black text-white mb-4 [overflow-wrap:anywhere]">{title}</h1>
                        {subtitle && <p className="text-brand-mist text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">{subtitle}</p>}
                    </div>
                </div>
            )}

            <main className={`flex-1 w-full max-w-5xl mx-auto ${dark ? 'px-6 py-12' : 'px-6 py-12'}`}>{children}</main>

            <footer className={`py-12 border-t ${dark ? 'bg-brand-navy border-white/10' : 'bg-white border-gray-200'}`}>
                <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-10">
                    <div>
                        <img
                            src={dark ? '/logos/LaxaLab_Academy_Stacked_Reverse_4K.png' : '/logos/LaxaLab_Academy_Stacked_Primary_4K.png'}
                            alt="Laxalab Logo"
                            className="h-20 w-auto object-contain mb-4"
                        />
                        <p className={`text-sm leading-relaxed ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {isAr
                                ? 'منصة تعليمية رقمية تجمع بين التميز العربي والعالمي لتقديم دورات عملية بشهادات معتمدة.'
                                : 'A digital learning platform blending Arabic and global excellence with practical courses and accredited certificates.'}
                        </p>
                    </div>
                    <div>
                        <h3 className={footerHeadingCls}>{isAr ? 'المنصة' : 'Platform'}</h3>
                        <nav className={`flex flex-col gap-2 text-sm font-semibold ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                            <Link href="/about" className={footerLinkCls}>{isAr ? 'من نحن' : 'About Us'}</Link>
                            <Link href="/faq" className={footerLinkCls}>{isAr ? 'الأسئلة الشائعة' : 'FAQ'}</Link>
                            <Link href="/contact" className={footerLinkCls}>{isAr ? 'تواصل معنا' : 'Contact Us'}</Link>
                            <Link href="/courses" className={footerLinkCls}>{isAr ? 'تصفح الدورات' : 'Browse Courses'}</Link>
                            <Link href="/join-as-instructor" className={footerLinkCls}>{isAr ? 'انضم كمدرّب' : 'Join as an Instructor'}</Link>
                        </nav>
                    </div>
                    <div>
                        <h3 className={footerHeadingCls}>{isAr ? 'سياسات' : 'Policies'}</h3>
                        <nav className={`flex flex-col gap-2 text-sm font-semibold ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                            <Link href="/terms" className={footerLinkCls}>{isAr ? 'الشروط والأحكام' : 'Terms of Service'}</Link>
                            <Link href="/privacy" className={footerLinkCls}>{isAr ? 'سياسة الخصوصية' : 'Privacy Policy'}</Link>
                            <Link href="/refund-policy" className={footerLinkCls}>{isAr ? 'سياسة الاسترداد' : 'Refund Policy'}</Link>
                            <Link href="/cookies" className={footerLinkCls}>{isAr ? 'سياسة ملفات الارتباط' : 'Cookie Policy'}</Link>
                        </nav>
                    </div>
                </div>
                <div className={`mt-10 border-t pt-6 text-center text-sm font-semibold ${dark ? 'border-white/10 text-gray-500' : 'border-gray-100 text-gray-500'}`}>
                    &copy; {new Date().getFullYear()} Laxalab. {isAr ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}
                </div>
            </footer>
        </div>
    );
}