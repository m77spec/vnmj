"use client";

import Link from 'next/link';
import { useState } from 'react';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { buildAdminNavLinks, buildNavLinks, buildPublicNavLinks, groupAdminNavLinks, groupInstructorNavLinks, groupStudentNavLinks, isNavLinkActive } from '@/lib/nav-links';

export default function PublicMobileMenu({ dark }: { dark?: boolean }) {
    const { t } = useI18n();
    const { user, logout } = useAuth();
    const { dark: ctxDark } = useTheme();
    const pathname = usePathname();
    const isDark = dark ?? ctxDark;
    const [open, setOpen] = useState(false);
    const roleKey = (user?.role || '').toUpperCase();
    const isAdminRole = ['ADMIN', 'COURSE_MANAGER', 'FINANCE'].includes(roleKey);

    const tone = isDark ? 'text-white hover:text-brand-gold' : 'text-brand-navy hover:text-brand-charcoal';
    const drawerCls = isDark
        ? 'fixed top-0 bottom-0 start-0 w-[85%] max-w-xs bg-brand-navy-dark overflow-y-auto shadow-2xl'
        : 'fixed top-0 bottom-0 start-0 w-[85%] max-w-xs bg-white overflow-y-auto shadow-2xl';
    const linkCls = isDark
        ? 'block px-3.5 py-3 rounded-xl font-bold text-white hover:bg-white/10 transition'
        : 'block px-3.5 py-3 rounded-xl font-bold text-brand-navy hover:bg-brand-mist transition';
    const dividerCls = isDark ? 'border-white/10' : 'border-brand-mist';
    const closeCls = isDark ? 'text-gray-400 hover:text-white transition' : 'text-gray-400 hover:text-gray-700 transition';
    const dashboardLinks = isAdminRole ? buildAdminNavLinks(t) : buildNavLinks(t);
    const roleLinks = dashboardLinks.filter((link) => link.roles.some((role) => role.toUpperCase() === roleKey));
    const links = roleLinks.length > 0
        ? roleLinks
        : dashboardLinks.filter((link) => ['/dashboard', '/dashboard/profile', '/dashboard/support'].includes(link.href));
    const sections = roleKey === 'STUDENT'
        ? groupStudentNavLinks(links, t)
        : roleKey === 'INSTRUCTOR'
            ? groupInstructorNavLinks(links, t)
            : groupAdminNavLinks(links, t);
    const publicLinks = buildPublicNavLinks(t);
    const navigationLinks = [...links, ...publicLinks];

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className={`lg:hidden p-2 ${tone} transition`}
                aria-label="Menu"
            >
                <Menu size={24} />
            </button>

{open && createPortal(
            <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
                    <div className={drawerCls}>
                        <div className={`p-5 border-b ${dividerCls} flex items-center justify-between`}>
                            <img
                                src={isDark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                                alt="Laxalab Academy"
                                className="h-8 w-auto object-contain"
                            />
                            <button onClick={() => setOpen(false)} className={closeCls} aria-label="Close">
                                <X size={24} />
                            </button>
                        </div>

                        <nav className="p-4 space-y-2">
                            {user ? (
                                <>
                                    <div className={`mb-3 rounded-xl px-3.5 py-3 ${isDark ? 'bg-white/5' : 'bg-brand-mist/60'}`}>
                                        <p className={`truncate text-xs font-bold ${isDark ? 'text-white' : 'text-brand-navy'}`} dir="ltr">{user.email}</p>
                                        <p className={`mt-1 text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {t(`roles.${user.role.toLowerCase()}`)}
                                        </p>
                                    </div>
                                    {sections.map((section) => (
                                        <div key={section.title || 'dashboard-links'} className="space-y-1">
                                            {section.title && (
                                                <h2 className={`px-3.5 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.12em] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                                    {section.title}
                                                </h2>
                                            )}
                                            {section.links.map((link) => {
                                                const active = isNavLinkActive(pathname, link, navigationLinks);
                                                const Icon = link.icon;
                                                return (
                                                    <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={`${linkCls} flex items-center gap-3 ${active ? isDark ? 'bg-white/10 text-brand-gold-light' : 'bg-brand-mist text-brand-navy' : ''}`}>
                                                        <Icon size={18} className="shrink-0" />
                                                        <span className="min-w-0 flex-1 truncate">{link.name}</span>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    ))}
                                    <h2 className={`px-3.5 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.12em] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {t('sidebar.nav_public')}
                                    </h2>
                                    {publicLinks.map((link) => {
                                        const active = isNavLinkActive(pathname, link, navigationLinks);
                                        const Icon = link.icon;
                                        return (
                                            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={`${linkCls} flex items-center gap-3 ${active ? isDark ? 'bg-white/10 text-brand-gold-light' : 'bg-brand-mist text-brand-navy' : ''}`}>
                                                <Icon size={18} className="shrink-0" />
                                                <span className="min-w-0 flex-1 truncate">{link.name}</span>
                                            </Link>
                                        );
                                    })}
                                    <button
                                        onClick={logout}
                                        className={`mt-3 flex w-full items-center gap-3 rounded-xl px-3.5 py-3 font-bold text-red-500 transition ${isDark ? 'hover:bg-white/10' : 'hover:bg-red-50'}`}
                                    >
                                        <LogOut size={18} className="shrink-0 rtl:rotate-180" />
                                        {t('sidebar.logout')}
                                    </button>
                                </>
                            ) : (
                                <>
                                    {publicLinks.map((link) => (
                                        <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={linkCls}>
                                            {link.name}
                                        </Link>
                                    ))}
                                    <Link href="/login" onClick={() => setOpen(false)} className={linkCls}>
                                        {t('auth.login')}
                                    </Link>
                                    <Link href="/register" onClick={() => setOpen(false)} className={`${isDark ? 'bg-brand-gold text-brand-navy-dark hover:bg-brand-gold-light' : 'bg-brand-navy text-white'} block px-3.5 py-3 rounded-xl font-bold text-center transition`}>
                                        {t('auth.register')}
                                    </Link>
                                </>
                            )}
                        </nav>

                        <div className={`p-4 border-t ${dividerCls} space-y-3`}>
                            <LanguageSwitcher dark={dark} />
                            <ThemeToggle />
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
