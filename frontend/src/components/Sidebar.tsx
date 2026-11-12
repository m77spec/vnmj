"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { api, getErrorMessage } from '@/lib/api';
import { buildAdminNavLinks, buildNavLinks, buildPublicNavLinks, getActiveNavLink, groupAdminNavLinks, groupInstructorNavLinks, groupStudentNavLinks, isNavLinkActive } from '@/lib/nav-links';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { LogOut } from 'lucide-react';

export default function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { t } = useI18n();
    const { dark } = useTheme();
    const roleKey = (user?.role || '').toUpperCase();
    const isAdminRole = ['ADMIN', 'COURSE_MANAGER', 'FINANCE'].includes(roleKey);
    const [unread, setUnread] = useState(0);
    const [notificationsUnread, setNotificationsUnread] = useState(0);
    const [unreadError, setUnreadError] = useState<string | null>(null);

    useEffect(() => {
        if (!user || isAdminRole) return;
        let active = true;
        const load = async () => {
            setUnreadError(null);
            try {
                const [msgRes, notifRes] = await Promise.all([
                    api.get('/messages/unread-count'),
                    api.get('/notifications/unread-count'),
                ]);
                if (active) {
                    setUnread(msgRes.data?.count ?? 0);
                    setNotificationsUnread(notifRes.data?.count ?? 0);
                }
            } catch (error) {
                if (active) setUnreadError(getErrorMessage(error) || t('common.error'));
            }
        };
        load();
        const timer = setInterval(load, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [user, t, isAdminRole]);

    if (!user) return null;

    const allNav = isAdminRole ? buildAdminNavLinks(t) : buildNavLinks(t);
    const roleLinks = allNav.filter(link => link.roles.some(r => r.toUpperCase() === roleKey));
    const links = roleLinks.length > 0
        ? roleLinks
        : allNav.filter(link => ['/dashboard', '/dashboard/profile', '/dashboard/support'].includes(link.href));
    const publicLinks = buildPublicNavLinks(t);
    const navigationLinks = [...links, ...publicLinks];
    const roleSections = roleKey === 'STUDENT'
        ? groupStudentNavLinks(links, t)
        : roleKey === 'INSTRUCTOR'
            ? groupInstructorNavLinks(links, t)
            : groupAdminNavLinks(links, t);
    const sections = [
        ...roleSections,
        { title: t('sidebar.nav_public'), links: publicLinks },
    ];
    const activeLink = getActiveNavLink(pathname, navigationLinks);

    return (
        <aside className={`sticky top-0 hidden h-screen w-[17rem] shrink-0 flex-col justify-between border-e lg:flex ${dark ? 'border-white/10 bg-gradient-to-b from-brand-navy via-[#0e2a52] to-[#0a1e3c]' : 'border-line bg-surface-raised shadow-sm'}`}>
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-line px-5 pb-4 pt-6">
                    <div className="flex flex-col gap-3">
                        <img
                            src={dark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                            alt="Laxalab Academy"
                            className="mx-auto h-10 w-auto object-contain"
                        />
                        <span className={`mx-auto inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${dark ? 'bg-white/5 text-brand-mist' : 'bg-brand-navy/5 text-brand-navy'}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" />
                            {t('roles.' + user.role.toLowerCase())}
                        </span>
                    </div>
                </div>

                {activeLink && (
                    <div className={`mx-4 mt-4 rounded-2xl border p-3 ${dark ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-white'}`}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{t('sidebar.current_page')}</p>
                        <div className="mt-2 flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gold/15 text-brand-gold-dark dark:text-brand-gold-light">
                                <activeLink.icon size={16} />
                            </span>
                            <span className="truncate text-xs font-black text-ink">{activeLink.name}</span>
                        </div>
                    </div>
                )}

                <nav aria-label={t('sidebar.navigation')} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-3">
                    {sections.map((section) => (
                        <div key={section.title || 'navigation-links'} className="space-y-1">
                            {section.title && (
                                <h2 className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.12em] text-ink-muted/70">
                                    {section.title}
                                </h2>
                            )}
                            {section.links.map((link) => {
                                const isActive = isNavLinkActive(pathname, link, navigationLinks);
                                const Icon = link.icon;
                                return (
                                    <Link key={link.href} href={link.href} aria-current={isActive ? 'page' : undefined}>
                                        <div className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-all duration-200 ${isActive
                                            ? dark ? 'bg-brand-gold/15 text-brand-gold-light shadow-inner' : 'bg-brand-navy text-white shadow-md shadow-brand-navy/10'
                                            : 'text-ink-muted hover:bg-ink/[0.06] hover:text-ink'
                                            }`}>
                                            {isActive && <span className="absolute inset-y-2 start-0 w-1 rounded-e-full bg-brand-gold" />}
                                            <Icon size={17} className={`shrink-0 transition-colors ${isActive ? dark ? 'text-brand-gold-light' : 'text-brand-gold' : 'text-ink-muted group-hover:text-ink'}`} />
                                            <span className="min-w-0 flex-1 truncate">{link.name}</span>
                                            {link.href === '/dashboard/inbox' && unread > 0 && (
                                                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold px-1.5 text-[10px] font-black text-ink-on-gold">
                                                    {unread}
                                                </span>
                                            )}
                                            {link.href === '/dashboard/notifications' && notificationsUnread > 0 && (
                                                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold px-1.5 text-[10px] font-black text-ink-on-gold">
                                                    {notificationsUnread}
                                                </span>
                                            )}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    ))}
                    {unreadError && (
                        <p role="alert" className="px-3.5 py-2 text-xs font-semibold text-danger">
                            {unreadError}
                        </p>
                    )}
                </nav>
            </div>

            <div className="space-y-3 border-t border-line p-4">
                <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${dark ? 'bg-white/[0.04]' : 'bg-white'}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-navy text-xs font-black text-white dark:bg-brand-gold dark:text-brand-navy-dark">
                        {user.email.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-ink" dir="ltr">{user.email}</span>
                        <span className="mt-0.5 block text-[10px] text-ink-muted">{t('roles.' + user.role.toLowerCase())}</span>
                    </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-1">
                    <LanguageSwitcher />
                    <ThemeToggle />
                </div>
                <button
                    onClick={logout}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-danger transition-colors hover:bg-danger-soft"
                >
                    <LogOut size={19} className="rtl:rotate-180" />
                    <span>{t('sidebar.logout')}</span>
                </button>
            </div>
        </aside>
    );
}