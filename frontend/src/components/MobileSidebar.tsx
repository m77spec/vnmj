"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { api, getErrorMessage } from '@/lib/api';
import { buildAdminNavLinks, buildNavLinks, buildAuthenticatedPublicNavLinks, groupAdminNavLinks, groupInstructorNavLinks, groupStudentNavLinks, isNavLinkActive } from '@/lib/nav-links';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { createPortal } from 'react-dom';

export default function MobileSidebar() {
    const { user, logout } = useAuth();
    const { t } = useI18n();
    const { dark } = useTheme();
    const pathname = usePathname();
    const roleKey = (user?.role || '').toUpperCase();
    const isAdminRole = ['ADMIN', 'COURSE_MANAGER', 'FINANCE'].includes(roleKey);
    const [open, setOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [notificationsUnread, setNotificationsUnread] = useState(0);
    const [unreadError, setUnreadError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;

        const previousOverflow = document.body.style.overflow;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    useEffect(() => {
        if (!open || !user || isAdminRole) return;
        let active = true;
        const loadCounts = async () => {
            setUnreadError(null);
            try {
                const [messages, notifications] = await Promise.all([
                    api.get('/messages/unread-count'),
                    api.get('/notifications/unread-count'),
                ]);
                if (!active) return;
                setUnread(messages.data?.count ?? 0);
                setNotificationsUnread(notifications.data?.count ?? 0);
            } catch (error) {
                if (active) setUnreadError(getErrorMessage(error) || t('common.error'));
            }
        };
        void loadCounts();
        return () => { active = false; };
    }, [open, user, t, isAdminRole]);

    if (!user) return null;

    const allNav = isAdminRole ? buildAdminNavLinks(t) : buildNavLinks(t);
    const roleLinks = allNav.filter(link => link.roles.some(r => r.toUpperCase() === roleKey));
    const links = roleLinks.length > 0
        ? roleLinks
        : allNav.filter(link => ['/dashboard', '/dashboard/profile', '/dashboard/support'].includes(link.href));
    const publicLinks = buildAuthenticatedPublicNavLinks(t, roleKey);
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
    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="lg:hidden p-2 text-ink hover:bg-ink/[0.06] rounded-xl transition"
                aria-label="Open navigation menu"
                aria-expanded={open}
                aria-controls="mobile-navigation"
            >
                <Menu size={24} />
            </button>

            {open && createPortal(
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
                    <div id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Navigation menu" className={`fixed top-0 bottom-0 start-0 w-[min(85%,20rem)] overflow-y-auto overscroll-contain shadow-2xl ${dark ? 'bg-surface-sunken text-ink' : 'bg-surface-raised text-ink'}`}>
                        <div className="flex items-center justify-between border-b border-line p-5">
                            <div className="flex min-w-0 flex-col gap-2">
                                <img
                                    src={dark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                                    alt="Laxalab Academy"
                                    className="h-8 w-auto object-contain"
                                />
                                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-brand-gold/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-brand-gold-dark dark:text-brand-gold-light">
                                    <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" />
                                    {t('roles.' + user.role.toLowerCase())}
                                </span>
                            </div>
                            <button onClick={() => setOpen(false)} className="transition text-ink hover:text-ink" aria-label="Close">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-4 space-y-2">
                            {sections.map((section) => (
                                <div key={section.title || 'navigation-links'} className="space-y-1">
                                    {section.title && (
                                        <h2 className="px-3.5 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.12em] text-ink-muted/70">
                                            {section.title}
                                        </h2>
                                    )}
                                    {section.links.map((link) => {
                                        const isActive = isNavLinkActive(pathname, link, navigationLinks);
                                        const Icon = link.icon;
                                        return (
                                            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} aria-current={isActive ? 'page' : undefined}>
                                                <div className={`flex items-center gap-3 rounded-xl px-3.5 py-3 font-bold transition-colors ${isActive
                                                        ? dark ? 'bg-brand-gold/20 text-brand-gold-light' : 'bg-brand-navy text-white'
                                                        : 'text-ink-muted hover:bg-ink/[0.06] hover:text-ink'
                                                    }`}>
                                                    <Icon size={18} className="shrink-0" />
                                                    <span className="min-w-0 flex-1 truncate text-sm">{link.name}</span>
                                                    {link.href === '/dashboard/inbox' && unread > 0 && (
                                                        <span className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold px-1.5 text-[10px] font-black text-ink-on-gold">
                                                            {unread > 99 ? '99+' : unread}
                                                        </span>
                                                    )}
                                                    {link.href === '/dashboard/notifications' && notificationsUnread > 0 && (
                                                        <span className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold px-1.5 text-[10px] font-black text-ink-on-gold">
                                                            {notificationsUnread > 99 ? '99+' : notificationsUnread}
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
                        </div>

                        <div className={`p-4 border-t space-y-4 ${'border-line'}`}>
                            <LanguageSwitcher />
                            <ThemeToggle />
                            <button onClick={logout} className="flex items-center gap-3 w-full px-3.5 py-3 rounded-xl transition-colors font-bold text-danger hover:bg-danger-soft">
                                <LogOut size={19} className="rtl:rotate-180" />
                                <span>{t('sidebar.logout')}</span>
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}