import {
    LayoutDashboard,
    BookOpen,
    Users,
    CreditCard,
    ShieldAlert,
    Settings,
    MessageSquare,
    LifeBuoy,
    GraduationCap,
    Wallet,
    RotateCcw,
    Award,
    UserRound,
    ClipboardList,
    ClipboardCheck,
    MessagesSquare,
    CalendarClock,
    CalendarDays,
    BadgeCheck,
    PenLine,
    Route,
    Flag,
    Megaphone,
    Star,
    PanelTop,
    BellRing,
    Info,
    Newspaper,
    CircleHelp,
    Mail,
    UserRoundPlus,
    type LucideIcon,
} from 'lucide-react';

export interface NavLink {
    name: string;
    href: string;
    icon: LucideIcon;
    roles: string[];
}

export interface NavSection {
    title: string;
    links: NavLink[];
}

export function buildPublicNavLinks(t: (key: string) => string): NavLink[] {
    return [
        { name: t('sidebar.public_courses'), href: '/courses', icon: BookOpen, roles: [] },
        { name: t('sidebar.public_about'), href: '/about', icon: Info, roles: [] },
        { name: t('sidebar.public_instructors'), href: '/instructors', icon: GraduationCap, roles: [] },
        { name: t('sidebar.public_blog'), href: '/blog', icon: Newspaper, roles: [] },
        { name: t('sidebar.public_certificates'), href: '/verify-certificate', icon: BadgeCheck, roles: [] },
        { name: t('sidebar.public_faq'), href: '/faq', icon: CircleHelp, roles: [] },
        { name: t('sidebar.public_contact'), href: '/contact', icon: Mail, roles: [] },
        { name: t('sidebar.public_join_instructor'), href: '/join-as-instructor', icon: UserRoundPlus, roles: [] },
    ];
}

export function dedupeNavLinks(links: NavLink[]): NavLink[] {
    const seen = new Set<string>();
    return links.filter((link) => {
        if (seen.has(link.href)) return false;
        seen.add(link.href);
        return true;
    });
}

export function buildAuthenticatedPublicNavLinks(t: (key: string) => string, role: string): NavLink[] {
    return dedupeNavLinks(buildPublicNavLinks(t).filter((link) => (
        !(role === 'STUDENT' && link.href === '/courses')
        && !(role === 'INSTRUCTOR' && link.href === '/join-as-instructor')
    )));
}

export function isNavLinkActive(pathname: string, link: NavLink, links: NavLink[]) {
    if (pathname === link.href) return true;
    if (link.href === '/dashboard' || link.href === '/dashboard/admin' || !pathname.startsWith(`${link.href}/`)) {
        return false;
    }
    return !links.some((candidate) =>
        candidate.href !== link.href
        && candidate.href.startsWith(`${link.href}/`)
        && (pathname === candidate.href || pathname.startsWith(`${candidate.href}/`)),
    );
}

export function getActiveNavLink(pathname: string, links: NavLink[]) {
    return [...links]
        .sort((left, right) => right.href.length - left.href.length)
        .find((link) => isNavLinkActive(pathname, link, links));
}

export function groupStudentNavLinks(
    links: NavLink[],
    t: (key: string) => string,
): NavSection[] {
    const sections = [
        {
            title: t('sidebar.nav_overview'),
            hrefs: ['/dashboard'],
        },
        {
            title: t('sidebar.nav_learning'),
            hrefs: ['/dashboard/explore', '/dashboard/my-courses', '/dashboard/my-grades', '/dashboard/tasks', '/dashboard/calendar'],
        },
        {
            title: t('sidebar.nav_communication'),
            hrefs: ['/dashboard/inbox', '/dashboard/batch-chats', '/dashboard/notifications', '/dashboard/support'],
        },
        {
            title: t('sidebar.nav_account_payments'),
            hrefs: [
                '/dashboard/profile',
                '/dashboard/payments',
                '/dashboard/refunds',
                '/dashboard/profile?tab=certificates',
            ],
        },
    ];

    return sections.flatMap((section) => {
        const sectionLinks = section.hrefs
            .map((href) => links.find((link) => link.href === href))
            .filter((link): link is NavLink => !!link);
        return sectionLinks.length ? [{ title: section.title, links: sectionLinks }] : [];
    });
}

export function groupInstructorNavLinks(
    links: NavLink[],
    t: (key: string) => string,
): NavSection[] {
    const sections = [
        {
            title: t('sidebar.nav_overview'),
            hrefs: ['/dashboard'],
        },
        {
            title: t('sidebar.nav_teaching'),
            hrefs: ['/dashboard/teaching', '/dashboard/instructor-profile', '/dashboard/instructor-profile?tab=signature', '/dashboard/submissions'],
        },
        {
            title: t('sidebar.nav_communication'),
            hrefs: ['/dashboard/inbox', '/dashboard/batch-chats', '/dashboard/notifications', '/dashboard/support'],
        },
        {
            title: t('sidebar.nav_account'),
            hrefs: ['/dashboard/profile'],
        },
    ];

    return sections.flatMap((section) => {
        const sectionLinks = section.hrefs
            .map((href) => links.find((link) => link.href === href))
            .filter((link): link is NavLink => !!link);
        return sectionLinks.length ? [{ title: section.title, links: sectionLinks }] : [];
    });
}

export function groupAdminNavLinks(
    links: NavLink[],
    t: (key: string) => string,
): NavSection[] {
    const sections = [
        {
            title: t('sidebar.nav_overview'),
            hrefs: ['/dashboard/admin', '/dashboard/admin/homepage'],
        },
        {
            title: t('sidebar.nav_learning'),
            hrefs: [
                '/dashboard/admin/courses',
                '/dashboard/admin/course-interests',
                '/dashboard/admin/learning-paths',
                '/dashboard/admin/openings',
                '/dashboard/admin/ended',
                '/dashboard/admin/evaluations',
                '/dashboard/admin/certificates',
            ],
        },
        {
            title: t('sidebar.nav_people'),
            hrefs: [
                '/dashboard/admin/users',
                '/dashboard/admin/users/students',
                '/dashboard/admin/users/instructors',
                '/dashboard/admin/users/staff',
                '/dashboard/admin/instructors',
            ],
        },
        {
            title: t('sidebar.nav_communication'),
            hrefs: [
                '/dashboard/admin/tickets',
                '/dashboard/admin/contact-requests',
                '/dashboard/admin/requests',
                '/dashboard/admin/chats',
                '/dashboard/admin/announcements',
            ],
        },
        {
            title: t('sidebar.nav_operations'),
            hrefs: ['/dashboard/admin/finance', '/dashboard/admin/gateways', '/dashboard/admin/audit'],
        },
        {
            title: t('sidebar.nav_configuration'),
            hrefs: ['/dashboard/admin/system'],
        },
        {
            title: t('sidebar.nav_content'),
            hrefs: ['/dashboard/admin/blog'],
        },
    ];

    return sections.flatMap((section) => {
        const sectionLinks = section.hrefs
            .map((href) => links.find((link) => link.href === href))
            .filter((link): link is NavLink => !!link);
        return sectionLinks.length ? [{ title: section.title, links: sectionLinks }] : [];
    });
}

export function buildNavLinks(t: (key: string) => string): NavLink[] {
    return [
        { name: t('sidebar.dashboard'), href: '/dashboard', icon: LayoutDashboard, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.profile'), href: '/dashboard/profile', icon: UserRound, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('landing.explore_courses'), href: '/dashboard/explore', icon: BookOpen, roles: ['STUDENT'] },
        { name: t('sidebar.my_courses'), href: '/dashboard/my-courses', icon: BookOpen, roles: ['STUDENT'] },
        { name: t('sidebar.my_grades'), href: '/dashboard/my-grades', icon: GraduationCap, roles: ['STUDENT'] },
        { name: t('sidebar.tasks'), href: '/dashboard/tasks', icon: ClipboardList, roles: ['STUDENT'] },
        { name: t('sidebar.calendar'), href: '/dashboard/calendar', icon: CalendarDays, roles: ['STUDENT'] },
        { name: t('sidebar.payments'), href: '/dashboard/payments', icon: Wallet, roles: ['STUDENT'] },
        { name: t('sidebar.refunds'), href: '/dashboard/refunds', icon: RotateCcw, roles: ['STUDENT'] },
        { name: t('sidebar.certificates'), href: '/dashboard/profile?tab=certificates', icon: Award, roles: ['STUDENT'] },
        { name: t('sidebar.inbox'), href: '/dashboard/inbox', icon: MessageSquare, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.batch_chats'), href: '/dashboard/batch-chats', icon: MessagesSquare, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'ADMIN'] },
        { name: t('sidebar.notifications'), href: '/dashboard/notifications', icon: ShieldAlert, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.support'), href: '/dashboard/support', icon: LifeBuoy, roles: ['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'FINANCE', 'ADMIN'] },
        { name: t('sidebar.manage_courses'), href: '/dashboard/admin/courses', icon: BookOpen, roles: ['COURSE_MANAGER', 'ADMIN'] },
        { name: t('sidebar.openings'), href: '/dashboard/admin/openings', icon: CalendarClock, roles: ['COURSE_MANAGER', 'ADMIN'] },
        { name: t('sidebar.course_evaluations'), href: '/dashboard/admin/evaluations', icon: Star, roles: ['COURSE_MANAGER', 'ADMIN'] },
        { name: t('sidebar.teach_hub'), href: '/dashboard/teaching', icon: GraduationCap, roles: ['INSTRUCTOR'] },
        // The public CV used to be reachable only through the generic profile
        // edit modal, so nobody found it and every instructor stayed
        // `isProfileIncomplete`. Its own entry is what makes it discoverable.
        { name: t('sidebar.instructor_profile'), href: '/dashboard/instructor-profile', icon: BadgeCheck, roles: ['INSTRUCTOR', 'COURSE_MANAGER'] },
        { name: t('sidebar.certificate_signature'), href: '/dashboard/instructor-profile?tab=signature', icon: PenLine, roles: ['INSTRUCTOR', 'COURSE_MANAGER'] },
        { name: t('sidebar.submissions'), href: '/dashboard/submissions', icon: ClipboardCheck, roles: ['INSTRUCTOR'] },
        { name: t('sidebar.instructors_hr'), href: '/dashboard/admin/instructors', icon: Users, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('sidebar.audit_logs'), href: '/dashboard/admin/audit', icon: ShieldAlert, roles: ['ADMIN'] },
        { name: t('sidebar.finance'), href: '/dashboard/admin/finance', icon: CreditCard, roles: ['FINANCE', 'ADMIN'] },
        { name: t('sidebar.admin'), href: '/dashboard/admin', icon: Settings, roles: ['ADMIN'] },
    ];
}

export function buildAdminNavLinks(t: (key: string) => string): NavLink[] {
    return [
        { name: t('admin.nav_overview'), href: '/dashboard/admin', icon: LayoutDashboard, roles: ['ADMIN'] },
        { name: t('admin.nav_homepage'), href: '/dashboard/admin/homepage', icon: PanelTop, roles: ['ADMIN'] },
        { name: t('admin.nav_courses'), href: '/dashboard/admin/courses', icon: BookOpen, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_course_interests'), href: '/dashboard/admin/course-interests', icon: BellRing, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_learning_paths'), href: '/dashboard/admin/learning-paths', icon: Route, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_openings'), href: '/dashboard/admin/openings', icon: CalendarClock, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_ended'), href: '/dashboard/admin/ended', icon: Flag, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_evaluations'), href: '/dashboard/admin/evaluations', icon: Star, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_certificates'), href: '/dashboard/admin/certificates', icon: Award, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_users'), href: '/dashboard/admin/users', icon: Users, roles: ['ADMIN'] },
        { name: t('admin.nav_students'), href: '/dashboard/admin/users/students', icon: Users, roles: ['ADMIN'] },
        { name: t('admin.nav_instructors_users'), href: '/dashboard/admin/users/instructors', icon: GraduationCap, roles: ['ADMIN'] },
        { name: t('admin.nav_staff_users'), href: '/dashboard/admin/users/staff', icon: ShieldAlert, roles: ['ADMIN'] },
        { name: t('admin.nav_finance'), href: '/dashboard/admin/finance', icon: Wallet, roles: ['FINANCE', 'ADMIN'] },
        { name: t('admin.nav_instructors'), href: '/dashboard/admin/instructors', icon: GraduationCap, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_blog'), href: '/dashboard/admin/blog', icon: BookOpen, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_gateways'), href: '/dashboard/admin/gateways', icon: CreditCard, roles: ['ADMIN'] },
        { name: t('admin.nav_system'), href: '/dashboard/admin/system', icon: Settings, roles: ['ADMIN'] },
        { name: t('admin.nav_tickets'), href: '/dashboard/admin/tickets', icon: LifeBuoy, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_contact_requests'), href: '/dashboard/admin/contact-requests', icon: MessageSquare, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_requests'), href: '/dashboard/admin/requests', icon: CalendarClock, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_chats'), href: '/dashboard/admin/chats', icon: MessagesSquare, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_announcements'), href: '/dashboard/admin/announcements', icon: Megaphone, roles: ['ADMIN', 'COURSE_MANAGER'] },
        { name: t('admin.nav_audit'), href: '/dashboard/admin/audit', icon: ShieldAlert, roles: ['ADMIN'] },
    ];
}
