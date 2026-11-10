"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import { api, getErrorMessage, API_BASE_URL } from '@/lib/api';
import toast from 'react-hot-toast';
import { useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    UserRound, Mail, ShieldCheck, Calendar, Phone, MapPin, FileText,
    Edit3, Check, X, BadgeCheck, KeyRound, GraduationCap, Download, ShieldAlert,
    Users, UserCog, Trophy, Flame, Globe2, BookOpen, Award, Clock,
    Play, Eye, Share2, Camera, Cake, Briefcase,
} from 'lucide-react';
import Link from 'next/link';
import SelectField from '@/components/SelectField';
import TwoFactorSettings from './TwoFactorSettings';
import type {
    BilingualText,
    ProfileCertificate,
    ProfileExperience,
    ProfileLanguage,
    ProfileLink,
    ProfileQualification,
} from '@/lib/public-instructor';

interface MyProfile {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    twoFactorEnabled: boolean;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
    stats?: {
        enrollments: number;
        certificates: number;
    };
}

/** GET /gamification/me — the level badge in the hero. */
/** GET /analytics/me — the only source of learning hours and completions. */
interface AnalyticsMe {
    totalHours: number;
    coursesInProgress: number;
    coursesCompleted: number;
}

interface MyEnrollment {
    id: string;
    status: string;
    progressPercent?: number | null;
    course: {
        id: string;
        titleAr: string | null;
        titleEn: string | null;
    } | null;
    opening?: { id: string; status: string; nameAr: string | null; nameEn: string | null } | null;
}

interface MyCertificate {
    id: string;
    verificationCode: string;
    issuingDate: string;
    verificationStatus: string;
    printedAt?: string | null;
    course: { id: string; titleAr: string | null; titleEn: string | null; certificateIssued: boolean } | null;
}

interface GamificationBadge {
    type: string;
    nameAr: string;
    nameEn: string;
    icon: string;
    earned: boolean;
}

interface GamificationMe {
    points: number;
    level: number;
    streak: number;
    xpInLevel: number;
    xpToNextLevel: number;
    allBadges?: GamificationBadge[];
}

const TABS = [
    { id: 'courses', icon: BookOpen },
    { id: 'certificates', icon: Award },
    { id: 'professional', icon: Briefcase },
    { id: 'personal', icon: UserRound },
    { id: 'security', icon: ShieldCheck },
] as const;

type TabId = (typeof TABS)[number]['id'];

type InfoRow = { icon: typeof Mail; label: string; value: string; dir?: 'auto' | 'ltr' };

const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asProfileText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const readBilingual = (value: unknown): BilingualText => {
    const pair = asObject(value);
    return { ar: asProfileText(pair.ar), en: asProfileText(pair.en) };
};

/** Every profile field the edit modal writes, empty. */
const EMPTY_FORM = {
    nameAr: '', nameEn: '', fullName: '', age: '', phone: '', country: '', city: '',
    bio: '', specialty: '', gender: '', birthDate: '', university: '',
    studyStatus: '', studyLevel: '',
    inboxDisplayName: '', inboxUseOfficialName: true,
    // Instructor CV. Public on the instructor profile, so they are bilingual.
    jobTitleAr: '', jobTitleEn: '', bioEn: '', experienceYears: '',
};

/** One titled card of the personal tab. Module level so it is one component. */
function SectionCard({
    icon: Icon,
    title,
    rows,
    children,
}: {
    icon: typeof Mail;
    title: string;
    rows: InfoRow[];
    children?: React.ReactNode;
}) {
    return (
        <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-3xl shadow-sm p-6 lg:p-7">
            <div className="flex items-center gap-2.5 mb-5 pb-5 border-b border-gray-200 dark:border-white/5">
                <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light">
                    <Icon size={20} />
                </div>
                <h3 className="text-xl font-black text-brand-navy dark:text-white">{title}</h3>
            </div>
            <div className="space-y-1">
                {rows.map((row) => (
                    <div key={row.label} className="flex items-center gap-4 py-2.5">
                        <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light shrink-0">
                            <row.icon size={18} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 tracking-wide">{row.label}</div>
                            <div className="font-bold text-brand-navy dark:text-white truncate" dir={row.dir || 'auto'}>{row.value}</div>
                        </div>
                    </div>
                ))}
            </div>
            {children}
        </div>
    );
}

function EmptyState({ icon: Icon, text }: { icon: typeof BookOpen; text: string }) {
    return (
        <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light">
                <Icon size={22} />
            </div>
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">{text}</p>
        </div>
    );
}

function ProfileContent() {
    const { user } = useAuth();
    const { t, locale } = useI18n();
    // Falls back to the other language rather than showing a blank title when
    // one translation has not been filled in.
    const localized = (ar?: string | null, en?: string | null) =>
        (locale === 'ar' ? (ar || en) : (en || ar)) || '';
    const { data: profile, loading, error, refetch } = useFetchData<MyProfile>('/users/me');
    const isInstructor = profile?.role === 'INSTRUCTOR' || profile?.role === 'COURSE_MANAGER';
    // Reused rather than re-counted: the platform already tracks points/level
    // and study sessions, so the hero and the stats bar read those numbers
    // instead of growing a parallel profile-stats endpoint.
    const { data: gamification } = useFetchData<GamificationMe>(
        profile?.role === 'STUDENT' ? '/gamification/me' : null,
    );
    // Learning hours and completions are a student-only resource. Passing null
    // keeps a 403 off the wire for instructors and staff, and the stats bar
    // renders those two cards as unavailable instead of showing a fake zero.
    const { data: analytics } = useFetchData<AnalyticsMe>(
        profile?.role === 'STUDENT' ? '/analytics/me' : null,
    );
    // Both are student resources, gated the same way as /analytics/me.
    const { data: enrollments } = useFetchData<MyEnrollment[]>(
        profile?.role === 'STUDENT' ? '/enrollments/my' : null,
    );
    // Certificates are a student resource too, and the route is @Roles(STUDENT),
    // so this needs the same gate as its two siblings. Unconditionally it put a
    // guaranteed 403 in the console of every instructor and admin who opened
    // their own profile. Staff get undefined, and the tab falls through to the
    // empty state.
    const { data: certificates } = useFetchData<MyCertificate[]>(
        profile?.role === 'STUDENT' ? '/certificates/my' : null,
    );

    const searchParams = useSearchParams();
    const router = useRouter();
    // The tab lives in the URL so that the sidebar entry and the per-course
    // "view certificate" link in my-courses can deep-link into it.
    const tabParam = searchParams.get('tab');
    const visibleTabs = TABS.filter(({ id }) =>
        isInstructor
            ? id === 'professional' || id === 'personal' || id === 'security'
            : id !== 'professional',
    );
    const defaultTab: TabId = isInstructor ? 'professional' : 'courses';
    const activeTab: TabId = visibleTabs.some((tab) => tab.id === tabParam)
        ? (tabParam as TabId)
        : defaultTab;
    const setTab = (id: TabId) => router.replace(`/dashboard/profile?tab=${id}`, { scroll: false });

    const [editing, setEditing] = useState(false);
    // Everything /auth/register collects, plus the two names and the country
    // the platform added, so nothing the profile displays is read-only.
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' });
    const [savingEmail, setSavingEmail] = useState(false);

    const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [savingPw, setSavingPw] = useState(false);

    const [exportLoading, setExportLoading] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement | null>(null);

    const uploadAvatar = async (file: File) => {
        setUploadingAvatar(true);
        try {
            // Same multipart call shape the course media, chat and receipt
            // uploads already use.
            const body = new FormData();
            body.append('file', file);
            await api.post('/users/me/avatar', body, { headers: { 'Content-Type': 'multipart/form-data' } });
            toast.success(t('profile.avatar_updated'));
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('profile.avatar_failed'));
        } finally {
            setUploadingAvatar(false);
            if (avatarInputRef.current) avatarInputRef.current.value = '';
        }
    };

    const startEdit = () => {
        const m = profile?.metadata ?? {};
        setForm({
            nameAr: (m.nameAr as string) || '',
            nameEn: (m.nameEn as string) || '',
            fullName: (m.fullName as string) || '',
            age: m.age != null ? String(m.age) : '',
            phone: (m.phone as string) || '',
            country: (m.country as string) || '',
            city: (m.city as string) || '',
            bio: (m.bio as string) || '',
            specialty: (m.specialty as string) || '',
            gender: m.gender === 'MALE' || m.gender === 'FEMALE' ? m.gender : '',
            birthDate: (m.birthDate as string) || '',
            university: (m.university as string) || '',
            studyStatus: (m.studyStatus as string) || '',
            studyLevel: (m.studyLevel as string) || '',
            inboxDisplayName: (m.inboxDisplayName as string) || '',
            inboxUseOfficialName: m.inboxUseOfficialName !== false,
            jobTitleAr: (m.jobTitleAr as string) || '',
            jobTitleEn: (m.jobTitleEn as string) || '',
            bioEn: (m.bioEn as string) || '',
            // Stored as a clamped number server-side; a number here is truthy,
            // so normalise it to a string for the controlled input.
            experienceYears: m.experienceYears != null ? String(m.experienceYears) : '',
        });
        setEditing(true);
    };

    const saveProfile = async () => {
        setSaving(true);
        try {
            const { jobTitleAr, jobTitleEn, bioEn, experienceYears, specialty, inboxDisplayName, inboxUseOfficialName, ...personalForm } = form;
            const metadata: Record<string, unknown> = isInstructor
                ? personalForm
                : { ...personalForm, specialty, jobTitleAr, jobTitleEn, bioEn, experienceYears };
            if (profile?.role === 'STUDENT') {
                metadata.inboxDisplayName = inboxDisplayName;
                metadata.inboxUseOfficialName = inboxUseOfficialName;
            }
            await api.patch('/users/me', { metadata });
            toast.success(t('profile.saved'));
            setEditing(false);
            refetch();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('profile.save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const saveEmail = async () => {
        if (!emailForm.email || !emailForm.currentPassword) {
            toast.error(t('profile.email_fields_required'));
            return;
        }
        setSavingEmail(true);
        try {
            const res = await api.patch('/users/me', { email: emailForm.email, currentPassword: emailForm.currentPassword });
            toast.success(t('profile.email_updated'));
            setEmailForm({ email: '', currentPassword: '' });
            refetch();
            if (typeof window !== 'undefined') {
                try {
                    const raw = localStorage.getItem('laxalab_user');
                    if (raw) {
                        const u = JSON.parse(raw);
                        u.email = res.data?.email ?? emailForm.email;
                        localStorage.setItem('laxalab_user', JSON.stringify(u));
                    }
                } catch { /* ignore */ }
            }
            window.location.reload();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('profile.save_failed'));
        } finally {
            setSavingEmail(false);
        }
    };

    const savePassword = async () => {
        if (!pwForm.currentPassword || !pwForm.newPassword) {
            toast.error(t('profile.pw_fields_required'));
            return;
        }
        if (pwForm.newPassword.length < 6) {
            toast.error(t('profile.pw_too_short'));
            return;
        }
        if (pwForm.newPassword !== pwForm.confirmPassword) {
            toast.error(t('profile.pw_mismatch'));
            return;
        }
        setSavingPw(true);
        try {
            await api.patch('/users/me', { password: pwForm.newPassword, currentPassword: pwForm.currentPassword });
            toast.success(t('profile.pw_updated'));
            setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        } catch (err) {
            toast.error(getErrorMessage(err) || t('profile.pw_update_failed'));
        } finally {
            setSavingPw(false);
        }
    };

    const exportData = async () => {
        setExportLoading(true);
        try {
            const res = await api.post('/users/me/export');
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `laxalab-data-export-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(t('gdpr.export_success'));
        } catch (err) {
            toast.error(getErrorMessage(err) || t('gdpr.export_failed'));
        } finally {
            setExportLoading(false);
        }
    };

    const meta = (profile?.metadata ?? {}) as Record<string, string | undefined>;
    const publicProfile = asObject((profile?.metadata as Record<string, unknown> | undefined)?.publicProfile);
    const publicName = readBilingual(publicProfile.name);
    const publicJobTitle = readBilingual(publicProfile.jobTitle);
    const publicBio = readBilingual(publicProfile.bio);
    const publicSpecialties = Array.isArray(publicProfile.specialties)
        ? publicProfile.specialties.map(readBilingual).filter((item) => item.ar || item.en)
        : [];
    const publicExperiences = Array.isArray(publicProfile.experiences)
        ? publicProfile.experiences as ProfileExperience[]
        : [];
    const publicQualifications = Array.isArray(publicProfile.qualifications)
        ? publicProfile.qualifications as ProfileQualification[]
        : [];
    const publicLanguages = Array.isArray(publicProfile.languages)
        ? publicProfile.languages as ProfileLanguage[]
        : [];
    const publicCertificates = Array.isArray(publicProfile.certificates)
        ? publicProfile.certificates as ProfileCertificate[]
        : [];
    const publicLinks = Array.isArray(publicProfile.links)
        ? publicProfile.links as ProfileLink[]
        : [];
    const avatarUrl = asProfileText(meta.avatarUrl);
    const avatarSrc = avatarUrl
        ? (/^https?:\/\//i.test(avatarUrl) ? avatarUrl : `${API_BASE_URL}${avatarUrl}`)
        : null;
    const emailPrefix = user?.email?.split('@')[0] || profile?.email || '';
    // The one CV field that is not a string: the sanitiser stores years of
    // experience as a clamped number so it can be sorted and validated.
    const cvYearsValue = publicProfile.experienceYears ?? (profile?.metadata as Record<string, unknown> | undefined)?.experienceYears;
    const cvYears = typeof cvYearsValue === 'number' ? cvYearsValue : Number(cvYearsValue);
    const cvYearsLabel =
        typeof cvYears === 'number' && Number.isFinite(cvYears)
            ? `${cvYears} ${t('instructorProfile.years_suffix')}`
            : null;
    const hasInstructorDetails = publicExperiences.length > 0
        || publicQualifications.length > 0
        || publicLanguages.length > 0
        || publicCertificates.length > 0
        || publicLinks.length > 0
        || Boolean(cvYearsLabel);

    // The Arabic name leads; the English one sits under it because that is the
    // name the certificate prints, and having it visible here is how a student
    // notices it is set correctly.
    const nameAr = publicName.ar || meta.nameAr || meta.fullName || '';
    const nameEn = publicName.en || meta.nameEn || '';
    const fullName = nameAr || nameEn || emailPrefix;
    const instructorTitleAr = publicJobTitle.ar || asProfileText(meta.jobTitleAr);
    const instructorTitleEn = publicJobTitle.en || asProfileText(meta.jobTitleEn);
    const instructorBioAr = publicBio.ar || asProfileText(meta.bio);
    const instructorBioEn = publicBio.en || asProfileText(meta.bioEn);
    const instructorSpecialty = publicSpecialties[0]
        ? localized(publicSpecialties[0].ar, publicSpecialties[0].en)
        : asProfileText(meta.specialty);
    const initials = fullName.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const roleLabel = t('roles.' + (profile?.role || '').toLowerCase()) || profile?.role || '';

    // Only render the English line when it is genuinely a second language
    // version, otherwise the same string would appear twice.
    const showNameEn = !!nameEn && nameEn !== nameAr;

    const joinedLabel = profile ? new Date(profile.createdAt).toLocaleDateString() : '';

    // The personal tab is the single place the whole record is listed, so the
    // fields are grouped by what they are rather than by which form happened to
    // collect them. The old "بياناتي" page showed six of these and the profile
    // showed six others; every field now appears exactly once, here.
    const DASH = '—';
    const str = (k: string) => (meta[k] as string) || DASH;
    const genderValue = meta.gender as string | undefined;
    const genderLabel = genderValue === 'MALE'
        ? t('auth.gender_male')
        : genderValue === 'FEMALE'
            ? t('auth.gender_female')
            : DASH;

    const identityRows: InfoRow[] = [
        { icon: UserRound, label: t('profile.field_name_ar'), value: nameAr || str('fullName') },
        { icon: Globe2, label: t('profile.field_name_en'), value: str('nameEn'), dir: 'ltr' },
        { icon: Users, label: t('profile.field_gender'), value: genderLabel },
        { icon: Cake, label: t('profile.field_age'), value: str('age') },
        { icon: Cake, label: t('profile.field_birth_date'), value: str('birthDate'), dir: 'ltr' },
    ];

    const contactRows: InfoRow[] = [
        { icon: Mail, label: t('profile.email'), value: profile?.email || DASH, dir: 'ltr' },
        { icon: Phone, label: t('profile.field_phone'), value: str('phone'), dir: 'ltr' },
        { icon: MapPin, label: t('profile.field_country'), value: str('country') },
        { icon: MapPin, label: t('profile.field_city'), value: str('city') },
    ];

    const academicRows: InfoRow[] = [
        { icon: GraduationCap, label: t('profile.field_university'), value: str('university') },
        { icon: Award, label: t('profile.field_specialty'), value: str('specialty') },
        { icon: UserCog, label: t('profile.field_study_status'), value: meta.studyStatus ? t(`auth.study_status_${meta.studyStatus.toLowerCase()}`) || str('studyStatus') : DASH },
        { icon: BookOpen, label: t('profile.field_study_level'), value: str('studyLevel') },
    ];

    const accountRows: InfoRow[] = [
        { icon: ShieldCheck, label: t('profile.role'), value: roleLabel || DASH },
        { icon: BadgeCheck, label: t('profile.account_status'), value: profile?.isActive === false ? t('profile.suspended') : t('profile.active') },
        { icon: Calendar, label: t('profile.member_since'), value: joinedLabel || DASH },
    ];

    const inputCls = "w-full bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl px-4 py-3 font-semibold text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold transition";
    const labelCls = "block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1.5";

    return (
        <ProtectedRoute>
            <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5 sm:space-y-6 animate-fade-in">
                {error && <div role="alert" className="p-4 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 rounded-xl font-semibold">{error}</div>}

                {loading || !profile ? (
                    <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 p-8 sm:p-16 rounded-2xl sm:rounded-3xl flex flex-col items-center gap-3 font-bold text-gray-500 dark:text-gray-400">
                        <div className="w-12 h-12 rounded-full border-4 border-gray-200 dark:border-white/10 border-t-brand-gold animate-spin" />
                        {t('profile.loading')}
                    </div>
                ) : (
                    <>
                        {/* Hero header: identity, level badge, and the three
                            facts a learner checks first. */}
                        <div className="relative overflow-hidden bg-gradient-to-br from-brand-navy via-[#0e2a52] to-[#0a1e3c] rounded-3xl p-4 sm:p-6 lg:p-8 text-white shadow-lg shadow-brand-navy/20">
                            <div className="absolute -top-16 -right-16 w-64 h-64 bg-brand-gold/20 rounded-full blur-3xl" />
                            <div className="absolute -bottom-20 -left-10 w-72 h-72 bg-brand-gold/10 rounded-full blur-3xl" />
                            <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }} />
                            <div className="relative flex items-start gap-4 sm:gap-6 flex-wrap">
                                <div className="relative shrink-0">
                                    {avatarSrc ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={avatarSrc}
                                            alt={fullName}
                                            className="w-24 h-24 lg:w-28 lg:h-28 rounded-full object-cover ring-4 ring-white/15 shadow-lg"
                                        />
                                    ) : (
                                        <div className="w-24 h-24 lg:w-28 lg:h-28 rounded-full bg-gradient-to-br from-brand-gold to-brand-gold/50 flex items-center justify-center shadow-lg shadow-brand-gold/30 ring-4 ring-white/15">
                                            <span className="text-3xl lg:text-4xl font-black text-brand-navy">{initials || <UserRound size={40} />}</span>
                                        </div>
                                    )}
                                    <button
                                        onClick={() => avatarInputRef.current?.click()}
                                        disabled={uploadingAvatar}
                                        title={t('profile.change_photo')}
                                        aria-label={t('profile.change_photo')}
                                        className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-brand-gold text-brand-navy flex items-center justify-center shadow-lg ring-2 ring-brand-navy hover:bg-brand-gold/90 transition disabled:opacity-60"
                                    >
                                        {uploadingAvatar ? (
                                            <span className="w-3.5 h-3.5 rounded-full border-2 border-brand-navy border-t-transparent animate-spin" />
                                        ) : (
                                            <Camera size={15} />
                                        )}
                                    </button>
                                    <input
                                        ref={avatarInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,image/gif"
                                        className="hidden"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) uploadAvatar(f);
                                        }}
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h1 className="break-words text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight" dir="auto">{fullName}</h1>
                                        {profile.isActive !== false && (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-400/15 text-emerald-300 text-xs font-black">
                                                <BadgeCheck size={13} /> {t('profile.active')}
                                            </span>
                                        )}
                                    </div>
                                    {showNameEn && (
                                        <p className="text-brand-mist/80 mt-1 font-bold" dir="ltr">{nameEn}</p>
                                    )}
                                    <p className="text-brand-mist/90 mt-1.5 font-semibold truncate" dir="ltr">{profile.email}</p>

                                    <div className="flex flex-wrap gap-2 mt-4">
                                        {/* Level comes from the points the learner
                                            already earned; it is not a separate
                                            profile flag that could drift. */}
                                        {gamification && (
                                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-brand-gold text-brand-navy text-xs font-black shadow-sm shadow-brand-gold/30">
                                                <Trophy size={13} /> {t('profile.level')} {gamification.level}
                                            </span>
                                        )}
                                        {gamification && gamification.streak > 0 && (
                                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-orange-400/15 text-orange-200 text-xs font-black">
                                                <Flame size={13} /> {gamification.streak}
                                            </span>
                                        )}
                                        <span className="px-3.5 py-1.5 rounded-full bg-white/10 text-brand-mist/80 text-xs font-semibold backdrop-blur">
                                            {roleLabel}
                                        </span>
                                    </div>

                                    {/* Quick basics */}
                                    <dl className="flex flex-wrap gap-x-6 gap-y-2 mt-5 pt-5 border-t border-white/10">
                                        {(isInstructor
                                            ? [
                                                { icon: Briefcase, label: t('profile.field_specialty'), value: instructorSpecialty },
                                                { icon: Clock, label: t('instructorProfile.experience_years_label'), value: cvYearsLabel || '' },
                                                { icon: Calendar, label: t('profile.member_since'), value: joinedLabel },
                                            ]
                                            : [
                                                { icon: Globe2, label: t('profile.country'), value: meta.country },
                                                { icon: Calendar, label: t('profile.member_since'), value: joinedLabel },
                                                { icon: Phone, label: t('profile.phone'), value: meta.phone },
                                            ]
                                        ).filter((row) => row.value).map((row) => (
                                            <div key={row.label} className="flex items-center gap-2 min-w-0">
                                                <row.icon size={14} className="text-brand-gold-light shrink-0" />
                                                <dt className="text-brand-mist/60 text-xs font-bold">{row.label}</dt>
                                                <dd className="text-white text-xs font-bold truncate" dir="auto">{row.value || '—'}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                                <button
                                    onClick={() => isInstructor ? router.push('/dashboard/instructor-profile') : startEdit()}
                                    className="inline-flex items-center gap-2 text-sm font-bold text-brand-navy bg-brand-gold hover:bg-brand-gold/90 px-4 py-2.5 rounded-xl shadow-lg shadow-brand-gold/25 transition"
                                >
                                    <Edit3 size={16} /> {t('profile.edit_profile')}
                                </button>
                            </div>
                        </div>

                        {/* Stats bar. Enrolled and certificates come from
                            /users/me, hours and completions from /analytics/me.
                            The two student-only figures render as unavailable
                            rather than a misleading zero. */}
                        {!isInstructor && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {[
                                { icon: BookOpen, label: t('profile.stat_enrolled'), value: profile.stats?.enrollments },
                                { icon: Trophy, label: t('profile.stat_completed'), value: analytics?.coursesCompleted },
                                { icon: Award, label: t('profile.stat_certificates'), value: profile.stats?.certificates },
                                { icon: Clock, label: t('profile.stat_learning_hours'), value: analytics?.totalHours },
                            ].map((card) => (
                                <div
                                    key={card.label}
                                    className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm p-5 flex items-center gap-4"
                                >
                                    <div className="w-11 h-11 rounded-xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light shrink-0">
                                        <card.icon size={20} />
                                    </div>
                                    <div className="min-w-0">
                                        {/* undefined means "not tracked for this
                                            role", which is not the same as zero. */}
                                        <div className="text-2xl font-black text-brand-navy dark:text-white leading-none">
                                            {card.value === undefined ? '—' : card.value}
                                        </div>
                                        <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mt-1.5 truncate">
                                            {card.label}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>}

                        {/* Tab bar */}
                        <div className="flex gap-1 p-1.5 bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm overflow-x-auto">
                            {visibleTabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setTab(tab.id)}
                                    aria-current={activeTab === tab.id ? 'page' : undefined}
                                    className={`flex-1 min-w-max inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition ${
                                        activeTab === tab.id
                                            ? 'bg-gradient-to-r from-brand-gold to-brand-gold-dark text-brand-navy shadow-sm'
                                            : 'text-gray-500 dark:text-gray-400 hover:bg-brand-gold/10 hover:text-brand-gold-dark dark:hover:text-brand-gold-light'
                                    }`}
                                >
                                    <tab.icon size={16} /> {t(`profile.tab_${tab.id}`)}
                                </button>
                            ))}
                        </div>

                        {activeTab === 'courses' && (
                            <div className="space-y-4">
                                {!enrollments?.length ? (
                                    <EmptyState icon={BookOpen} text={t('profile.no_courses')} />
                                ) : (
                                    enrollments.map((e) => {
                                        // null when the course has no lessons yet:
                                        // unknown, not zero.
                                        const pct = e.progressPercent ?? null;
                                        const title = localized(e.course?.titleAr, e.course?.titleEn) || t('common.course');
                                        return (
                                            <div key={e.id} className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm p-5">
                                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                                    <div className="min-w-0 flex-1">
                                                        <h3 className="font-black text-brand-navy dark:text-white" dir="auto">{title}</h3>
                                                        {e.opening && (
                                                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mt-1" dir="auto">
                                                                {localized(e.opening.nameAr, e.opening.nameEn)}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <Link
                                                        href={`/courses/${e.course?.id}`}
                                                        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-black px-4 py-2.5 rounded-xl bg-brand-gold text-brand-navy hover:bg-brand-gold/90 transition"
                                                    >
                                                        {t('profile.continue')} <Play size={13} />
                                                    </Link>
                                                </div>
                                                {pct !== null ? (
                                                    <div className="mt-4">
                                                        <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                                                            <span>{t('profile.progress')}</span>
                                                            <span>{pct}%</span>
                                                        </div>
                                                        <div className="h-2 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                                                            <div
                                                                className="h-full rounded-full bg-gradient-to-r from-brand-gold to-brand-gold-dark transition-all"
                                                                style={{ width: `${pct}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p className="text-xs font-bold text-gray-400 dark:text-gray-500 mt-3">{t('profile.no_lessons')}</p>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}

                        {activeTab === 'certificates' && (
                            <div className="space-y-6">
                                {/* Badges */}
                                {gamification?.allBadges && (
                                    <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm p-6">
                                        <h3 className="font-black text-brand-navy dark:text-white mb-4">{t('profile.badges')}</h3>
                                        <div className="flex flex-wrap gap-2">
                                            {gamification.allBadges.map((b) => (
                                                <span
                                                    key={b.type}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-black ${
                                                        b.earned
                                                            ? 'bg-brand-gold/15 text-brand-gold-dark dark:text-brand-gold-light'
                                                            : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 line-through'
                                                    }`}
                                                >
                                                    {localized(b.nameAr, b.nameEn)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Certificates */}
                                {!certificates?.length ? (
                                    <EmptyState icon={Award} text={t('profile.no_certificates')} />
                                ) : (
                                    <div className="space-y-4">
                                        {certificates.map((cert) => {
                                            const title = localized(cert.course?.titleAr, cert.course?.titleEn) || t('common.certificate');
                                            const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/certificate/${cert.id}`;
                                            const linkedIn = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
                                            return (
                                                <div key={cert.id} className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm p-5">
                                                    <div className="flex items-start justify-between gap-4 flex-wrap">
                                                        <div className="min-w-0 flex-1">
                                                            <h3 className="font-black text-brand-navy dark:text-white" dir="auto">{title}</h3>
                                                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mt-1.5">
                                                                {t('profile.issued_on')} {new Date(cert.issuingDate).toLocaleDateString()}
                                                            </p>
                                                            {cert.printedAt && (
                                                                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                                                                    {t('profile.printed_on')} {new Date(cert.printedAt).toLocaleDateString()}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 shrink-0">
                                                            <Link
                                                                href={`/dashboard/certificates/${cert.id}`}
                                                                className="inline-flex items-center gap-1.5 text-xs font-black px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-brand-gold hover:text-brand-gold-dark dark:hover:text-brand-gold-light transition"
                                                            >
                                                                <Eye size={13} /> {t('profile.view_certificate')}
                                                            </Link>
                                                            <Link
                                                                href={`/certificate/${cert.id}`}
                                                                className="inline-flex items-center gap-1.5 text-xs font-black px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-brand-gold hover:text-brand-gold-dark dark:hover:text-brand-gold-light transition"
                                                            >
                                                                <Download size={13} /> {t('profile.download_pdf')}
                                                            </Link>
                                                            <a
                                                                href={linkedIn}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1.5 text-xs font-black px-3.5 py-2.5 rounded-xl bg-[#0A66C2] text-white hover:bg-[#084e94] transition"
                                                            >
                                                                <Share2 size={13} /> {t('profile.share_linkedin')}
                                                            </a>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'professional' && isInstructor && (
                            <section className="space-y-5">
                                <div className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark sm:flex-row sm:items-center sm:justify-between sm:p-7">
                                    <div className="flex items-start gap-4">
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-gold/10 text-brand-gold-dark dark:text-brand-gold-light">
                                            <Briefcase size={23} />
                                        </div>
                                        <div>
                                            <label className={labelCls} htmlFor="pf-age">{t('profile.field_age')}</label>
                                            <input
                                                id="pf-age"
                                                type="number"
                                                min={1}
                                                max={120}
                                                step={1}
                                                value={form.age}
                                                onChange={(e) => setForm({ ...form, age: e.target.value })}
                                                className={inputCls}
                                            />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-brand-navy dark:text-white">{t('instructorProfile.heading')}</h2>
                                            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">{t('instructorProfile.cv_hint')}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {profile && (
                                            <Link
                                                href={`/instructors/${profile.id}`}
                                                target="_blank"
                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:border-brand-gold dark:border-white/10 dark:text-white"
                                            >
                                                <Eye size={16} /> {t('profile.view_public_profile')}
                                            </Link>
                                        )}
                                        <button
                                            onClick={() => router.push('/dashboard/instructor-profile')}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-dark px-4 py-2.5 text-sm font-black text-brand-navy transition hover:opacity-90"
                                        >
                                            <Edit3 size={16} /> {t('profile.edit_profile')}
                                        </button>
                                    </div>
                                </div>

                                {!instructorTitleAr && !instructorTitleEn && !instructorBioAr && !instructorBioEn && !instructorSpecialty && !hasInstructorDetails ? (
                                    <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-8 text-center dark:border-amber-500/30 dark:bg-amber-500/5">
                                        <Briefcase className="mx-auto mb-3 text-amber-500" size={28} />
                                        <p className="font-bold text-amber-800 dark:text-amber-300">{t('instructorProfile.profile_incomplete')}</p>
                                        <Link href="/dashboard/instructor-profile" className="mt-4 inline-flex rounded-xl bg-brand-navy px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 dark:bg-white dark:text-brand-navy">
                                            {t('profile.edit_profile')}
                                        </Link>
                                    </div>
                                ) : (
                                    <div className="grid gap-5 lg:grid-cols-3">
                                        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark lg:col-span-2">
                                            <div className="flex items-center gap-3 border-b border-gray-100 pb-4 dark:border-white/5">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/10 text-brand-gold-dark dark:text-brand-gold-light">
                                                    <GraduationCap size={20} />
                                                </div>
                                                <div>
                                                    <h3 className="font-black text-brand-navy dark:text-white">{localized(instructorTitleAr, instructorTitleEn) || t('instructorProfile.not_filled')}</h3>
                                                    <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{instructorSpecialty || t('profile.field_specialty')}</p>
                                                </div>
                                            </div>
                                            <div className="mt-5 grid gap-5 sm:grid-cols-2">
                                                <div>
                                                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('instructorProfile.job_title_label')} · عربي</p>
                                                    <p className="font-semibold text-brand-navy dark:text-white" dir="rtl">{instructorTitleAr || '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400" dir="ltr">{t('instructorProfile.job_title_label')} · English</p>
                                                    <p className="font-semibold text-brand-navy dark:text-white" dir="ltr">{instructorTitleEn || '—'}</p>
                                                </div>
                                            </div>
                                            {instructorBioAr && (
                                                <div className="mt-6 border-t border-gray-100 pt-5 dark:border-white/5">
                                                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('profile.field_bio')} · عربي</p>
                                                    <p className="whitespace-pre-line text-sm leading-7 text-gray-700 dark:text-gray-300" dir="rtl">{instructorBioAr}</p>
                                                </div>
                                            )}
                                            {instructorBioEn && (
                                                <div className="mt-5 border-t border-gray-100 pt-5 dark:border-white/5">
                                                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400" dir="ltr">{t('instructorProfile.bio_en_label')}</p>
                                                    <p className="whitespace-pre-line text-sm leading-7 text-gray-700 dark:text-gray-300" dir="ltr">{instructorBioEn}</p>
                                                </div>
                                            )}
                                            {publicSpecialties.length > 0 && (
                                                <div className="mt-5 border-t border-gray-100 pt-5 dark:border-white/5">
                                                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('instructorProfile.sections_specialties')}</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {publicSpecialties.map((specialty, index) => (
                                                            <span key={`${specialty.ar}-${specialty.en}-${index}`} className="rounded-full bg-brand-gold/10 px-3 py-1.5 text-xs font-bold text-brand-gold-dark dark:text-brand-gold-light">
                                                                {localized(specialty.ar, specialty.en)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {(publicExperiences.length > 0 || publicQualifications.length > 0) && (
                                                <div className="mt-5 grid gap-5 border-t border-gray-100 pt-5 sm:grid-cols-2 dark:border-white/5">
                                                    {publicExperiences.length > 0 && (
                                                        <div>
                                                            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('instructorProfile.sections_experience')}</p>
                                                            <ul className="space-y-3">
                                                                {publicExperiences.map((item, index) => (
                                                                    <li key={`${item.role}-${item.organisation}-${index}`} className="border-s-2 border-brand-gold/50 ps-3">
                                                                        <p className="font-bold text-brand-navy dark:text-white">{item.role}</p>
                                                                        <p className="text-sm text-gray-500 dark:text-gray-400">{[item.organisation, item.from, item.to].filter(Boolean).join(' · ')}</p>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                    {publicQualifications.length > 0 && (
                                                        <div>
                                                            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('instructorProfile.sections_qualifications')}</p>
                                                            <ul className="space-y-3">
                                                                {publicQualifications.map((item, index) => (
                                                                    <li key={`${item.degree}-${item.institution}-${index}`}>
                                                                        <p className="font-bold text-brand-navy dark:text-white">{item.degree}{item.field ? ` · ${item.field}` : ''}</p>
                                                                        <p className="text-sm text-gray-500 dark:text-gray-400">{[item.institution, item.year].filter(Boolean).join(' · ')}</p>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gold/10 text-brand-gold-dark dark:text-brand-gold-light">
                                                <Clock size={20} />
                                            </div>
                                            <p className="mt-5 text-sm font-bold text-gray-500 dark:text-gray-400">{t('instructorProfile.experience_years_label')}</p>
                                            <p className="mt-1 text-3xl font-black text-brand-navy dark:text-white">{cvYearsLabel ?? '—'}</p>
                                            <p className="mt-5 border-t border-gray-100 pt-4 text-sm leading-6 text-gray-500 dark:border-white/5 dark:text-gray-400">
                                                {t('instructorProfile.cv_hint')}
                                            </p>
                                        </div>
                                        {(publicLanguages.length > 0 || publicCertificates.length > 0 || publicLinks.length > 0) && (
                                            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark lg:col-span-3">
                                                <div className="grid gap-6 md:grid-cols-3">
                                                    {publicLanguages.length > 0 && (
                                                        <div>
                                                            <h4 className="mb-3 font-black text-brand-navy dark:text-white">{t('instructorProfile.sections_languages')}</h4>
                                                            <div className="flex flex-wrap gap-2">
                                                                {publicLanguages.map((item, index) => <span key={`${item.name}-${index}`} className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 dark:bg-white/5 dark:text-gray-300">{item.name}{item.proficiency ? ` · ${item.proficiency}` : ''}</span>)}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {publicCertificates.length > 0 && (
                                                        <div>
                                                            <h4 className="mb-3 font-black text-brand-navy dark:text-white">{t('instructorProfile.sections_certificates')}</h4>
                                                            <ul className="space-y-2">
                                                                {publicCertificates.map((item, index) => <li key={`${item.title}-${index}`} className="text-sm"><span className="font-bold text-brand-navy dark:text-white">{item.title}</span><span className="text-gray-500 dark:text-gray-400">{[item.issuer, item.year].filter(Boolean).length ? ` · ${[item.issuer, item.year].filter(Boolean).join(' · ')}` : ''}</span></li>)}
                                                            </ul>
                                                        </div>
                                                    )}
                                                    {publicLinks.length > 0 && (
                                                        <div>
                                                            <h4 className="mb-3 font-black text-brand-navy dark:text-white">{t('instructorProfile.sections_links')}</h4>
                                                            <ul className="space-y-2">
                                                                {publicLinks.map((item, index) => <li key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-brand-gold-dark hover:underline dark:text-brand-gold-light">{item.label}</a></li>)}
                                                            </ul>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}

                        {activeTab === 'personal' && (
                            <div className="space-y-6">
                                <div className="flex justify-end">
                                    <button
                                        onClick={startEdit}
                                        className="inline-flex items-center gap-2 bg-white dark:bg-brand-navy-dark border border-brand-gold/40 hover:bg-brand-gold/10 text-brand-navy dark:text-white font-bold rounded-xl px-5 py-2.5 transition"
                                    >
                                        <Edit3 size={16} /> {t('profile.edit_profile')}
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <SectionCard icon={UserRound} title={t('profile.personal_info')} rows={identityRows}>
                                        {/* Why the English name is asked for at all. */}
                                        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                            {t('profile.certificate_name_hint')}
                                        </p>
                                        {nameEn ? (
                                            <p className="mt-2 text-xs font-black text-emerald-600 dark:text-emerald-400">
                                                {t('profile.name_en_set')}
                                            </p>
                                        ) : null}
                                        {!isInstructor && meta.bio ? (
                                            <div className="mt-5 pt-5 border-t border-gray-200 dark:border-white/5">
                                                <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                                                    <FileText size={14} /> {t('profile.bio')}
                                                </div>
                                                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line" dir="auto">
                                                    {meta.bio}
                                                </p>
                                            </div>
                                        ) : null}
                                    </SectionCard>

                                    <SectionCard icon={Phone} title={t('profile.section_contact')} rows={contactRows} />
                                    {!isInstructor && (
                                        <SectionCard icon={GraduationCap} title={t('profile.section_academic')} rows={academicRows} />
                                    )}
                                    <SectionCard icon={ShieldCheck} title={t('profile.section_account')} rows={accountRows} />
                                </div>
                            </div>
                        )}

                        {activeTab === 'security' && (
                            <div className="space-y-6">
                                {profile && (
                                    <TwoFactorSettings
                                        enabled={profile.twoFactorEnabled}
                                        sensitiveActionsRequireTwoFactor={profile.role === 'ADMIN' || profile.role === 'FINANCE'}
                                        onChanged={refetch}
                                    />
                                )}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Email change */}
                                    <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-gray-200 dark:border-white/5 rounded-3xl shadow-sm p-6 lg:p-7">
                                        <div className="flex items-center gap-2.5 mb-5">
                                            <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light">
                                                <Mail size={20} />
                                            </div>
                                            <h3 className="text-xl font-black text-brand-navy dark:text-white">{t('profile.change_email')}</h3>
                                        </div>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelCls}>{t('profile.field_new_email')}</label>
                                                <input
                                                    type="email"
                                                    value={emailForm.email}
                                                    onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
                                                    className={inputCls}
                                                    dir="ltr"
                                                    placeholder={t('profile.field_new_email_ph')}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('profile.field_current_password')}</label>
                                                <input
                                                    type="password"
                                                    value={emailForm.currentPassword}
                                                    onChange={(e) => setEmailForm({ ...emailForm, currentPassword: e.target.value })}
                                                    className={inputCls}
                                                />
                                            </div>
                                            <button
                                                onClick={saveEmail}
                                                disabled={savingEmail}
                                                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black py-3 font-bold rounded-xl hover:from-brand-gold-dark hover:to-brand-gold-dark transition disabled:opacity-50"
                                            >
                                                {savingEmail ? t('common.saving') : t('profile.save_email')}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Password change */}
                                    <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-gray-200 dark:border-white/5 rounded-3xl shadow-sm p-6 lg:p-7">
                                        <div className="flex items-center gap-2.5 mb-5">
                                            <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light">
                                                <KeyRound size={20} />
                                            </div>
                                            <h3 className="text-xl font-black text-brand-navy dark:text-white">{t('profile.change_password')}</h3>
                                        </div>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelCls}>{t('profile.field_current_password')}</label>
                                                <input
                                                    type="password"
                                                    value={pwForm.currentPassword}
                                                    onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                                                    className={inputCls}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('profile.field_new_password')}</label>
                                                <input
                                                    type="password"
                                                    value={pwForm.newPassword}
                                                    onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                                                    className={inputCls}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelCls}>{t('profile.field_confirm_password')}</label>
                                                <input
                                                    type="password"
                                                    value={pwForm.confirmPassword}
                                                    onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                                                    className={inputCls}
                                                />
                                            </div>
                                            <button
                                                onClick={savePassword}
                                                disabled={savingPw}
                                                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black py-3 font-bold rounded-xl hover:from-brand-gold-dark hover:to-brand-gold-dark transition disabled:opacity-50"
                                            >
                                                {savingPw ? t('common.saving') : t('profile.save_password')}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* GDPR privacy card */}
                                <div className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-gray-200 dark:border-white/5 rounded-3xl shadow-sm p-6 lg:p-7">
                                    <div className="flex items-center gap-2.5 mb-6 pb-5 border-b border-gray-200 dark:border-white/5">
                                        <div className="w-10 h-10 rounded-xl bg-brand-gold/10 flex items-center justify-center text-brand-gold-dark dark:text-brand-gold-light">
                                            <ShieldAlert size={20} />
                                        </div>
                                        <h3 className="text-xl font-black text-brand-navy dark:text-white">{t('gdpr.heading')}</h3>
                                    </div>
                                    <div className="bg-brand-gold/5 border border-brand-gold/10 rounded-2xl p-6">
                                        <h4 className="font-black text-brand-gold-dark dark:text-brand-gold-light mb-1.5">{t('gdpr.export_title')}</h4>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('gdpr.export_desc')}</p>
                                        <button
                                            onClick={exportData}
                                            disabled={exportLoading}
                                            className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black px-6 py-3 font-bold rounded-xl hover:from-brand-gold-dark hover:to-brand-gold-dark transition disabled:opacity-50"
                                        >
                                            <Download size={16} /> {exportLoading ? t('gdpr.exporting') : t('gdpr.export_btn')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Edit personal info modal */}
            {editing && profile && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 animate-fade-in">
                    <div role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" className="bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/10 rounded-3xl w-full max-w-2xl p-5 sm:p-8 shadow-2xl max-h-[92vh] overflow-y-auto animate-scale-in">
                        <div className="flex items-center justify-between mb-7">
                            <h2 id="profile-edit-title" className="text-xl sm:text-2xl font-black text-brand-navy dark:text-white">{t('profile.edit_title')}</h2>
                            <button onClick={() => setEditing(false)} className="w-9 h-9 rounded-lg text-gray-500 dark:text-gray-400 hover:text-brand-navy dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition flex items-center justify-center" aria-label="Close">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* The two names lead because the certificate prints
                                them, and the Arabic one is the platform default. */}
                            <div>
                                <label className={labelCls}>{t('profile.field_name_ar')}</label>
                                <input
                                    type="text"
                                    value={form.nameAr}
                                    onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                                    className={inputCls}
                                    dir="rtl"
                                />
                            </div>
                            <div>
                                <label className={labelCls}>{t('profile.field_name_en')}</label>
                                <input
                                    type="text"
                                    value={form.nameEn}
                                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                                    className={inputCls}
                                    dir="ltr"
                                    placeholder="Mohammed A"
                                />
                            </div>
                            <div>
                                <label className={labelCls}>{t('profile.field_full_name')}</label>
                                <input
                                    type="text"
                                    value={form.fullName}
                                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                                    className={inputCls}
                                    dir="auto"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelCls}>{t('profile.field_phone')}</label>
                                    <input
                                        type="text"
                                        value={form.phone}
                                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                        className={inputCls}
                                        dir="ltr"
                                        placeholder={t('auth.phone_ph')}
                                    />
                                </div>
                                <div>
                                    <label className={labelCls}>{t('profile.field_country')}</label>
                                    <input
                                        type="text"
                                        value={form.country}
                                        onChange={(e) => setForm({ ...form, country: e.target.value })}
                                        className={inputCls}
                                        dir="auto"
                                    />
                                </div>
                            </div>
                            <div className={`grid grid-cols-1 gap-4 ${isInstructor ? 'sm:grid-cols-1' : 'sm:grid-cols-2'}`}>
                                <div>
                                    <label className={labelCls}>{t('profile.field_city')}</label>
                                    <input
                                        type="text"
                                        value={form.city}
                                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                                        className={inputCls}
                                        dir="auto"
                                    />
                                </div>
                                {!isInstructor && <div>
                                    <label className={labelCls}>{t('profile.field_specialty')}</label>
                                    <input
                                        type="text"
                                        value={form.specialty}
                                        onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                                        className={inputCls}
                                        dir="auto"
                                    />
                                </div>}
                            </div>
                            <div className={`grid grid-cols-1 gap-4 ${isInstructor ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
                                <div>
                                    <label className={labelCls} htmlFor="pf-gender">{t('profile.field_gender')}</label>
                                    <SelectField
                                        id="pf-gender"
                                        icon={Users}
                                        inputCls={inputCls}
                                        value={form.gender}
                                        onChange={(v) => setForm({ ...form, gender: v })}
                                        placeholder={t('auth.gender_select')}
                                        ariaLabel={t('profile.field_gender')}
                                        options={[
                                            { value: 'MALE', label: t('auth.gender_male') },
                                            { value: 'FEMALE', label: t('auth.gender_female') },
                                        ]}
                                    />
                                </div>
                                <div>
                                    <label className={labelCls} htmlFor="pf-birthdate">{t('profile.field_birth_date')}</label>
                                    <input
                                        id="pf-birthdate"
                                        type="date"
                                        max={new Date().toISOString().slice(0, 10)}
                                        value={form.birthDate}
                                        onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                                        className={inputCls}
                                    />
                                </div>
                                {!isInstructor && <div>
                                    <label className={labelCls}>{t('profile.field_university')}</label>
                                    <input
                                        type="text"
                                        value={form.university}
                                        onChange={(e) => setForm({ ...form, university: e.target.value })}
                                        className={inputCls}
                                        dir="auto"
                                        placeholder={t('auth.university_ph')}
                                    />
                                </div>}
                            </div>
                            {!isInstructor && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelCls} htmlFor="pf-study-status">{t('profile.field_study_status')}</label>
                                    <SelectField
                                        id="pf-study-status"
                                        icon={UserCog}
                                        inputCls={inputCls}
                                        value={form.studyStatus}
                                        onChange={(v) => setForm({ ...form, studyStatus: v })}
                                        placeholder={t('auth.study_status_select')}
                                        ariaLabel={t('profile.field_study_status')}
                                        options={[
                                            { value: 'STUDENT', label: t('auth.study_status_student') },
                                            { value: 'GRADUATE', label: t('auth.study_status_graduate') },
                                            { value: 'OTHER', label: t('auth.study_status_other') },
                                        ]}
                                    />
                                </div>
                                <div>
                                    <label className={labelCls}>{t('profile.field_study_level')}</label>
                                    <input
                                        type="text"
                                        value={form.studyLevel}
                                        onChange={(e) => setForm({ ...form, studyLevel: e.target.value })}
                                        className={inputCls}
                                        dir="auto"
                                        placeholder={t('auth.study_level_ph')}
                                    />
                                </div>
                            </div>}
                            <div>
                                <label className={labelCls}>{t('profile.field_bio')}</label>
                                <textarea
                                    value={form.bio}
                                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                                    rows={4}
                                    className={inputCls}
                                    dir="auto"
                                />
                            </div>
                            {profile.role === 'STUDENT' && (
                                <div className="rounded-2xl border border-brand-gold/20 bg-brand-gold/5 p-4 space-y-3">
                                    <div>
                                        <h3 className="font-bold text-brand-navy dark:text-white">{t('profile.inbox_name_title')}</h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('profile.inbox_name_description')}</p>
                                    </div>
                                    <label className="flex items-center gap-3 text-sm font-bold text-brand-navy dark:text-white cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={form.inboxUseOfficialName}
                                            onChange={(e) => setForm({ ...form, inboxUseOfficialName: e.target.checked })}
                                            className="accent-amber-500"
                                        />
                                        {t('profile.inbox_use_official_name')}
                                    </label>
                                    {!form.inboxUseOfficialName && (
                                        <div>
                                            <label className={labelCls}>{t('profile.inbox_display_name')}</label>
                                            <input
                                                type="text"
                                                value={form.inboxDisplayName}
                                                onChange={(e) => setForm({ ...form, inboxDisplayName: e.target.value })}
                                                maxLength={80}
                                                className={inputCls}
                                                dir="auto"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>

                        <div className="flex gap-4 mt-8">
                            <button
                                onClick={saveProfile}
                                disabled={saving}
                                className="flex-1 bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-dark hover:to-brand-gold-dark text-black py-3 font-bold rounded-xl shadow-sm transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
                            >
                                <Check size={18} /> {saving ? t('common.saving') : t('profile.save')}
                            </button>
                            <button
                                onClick={() => setEditing(false)}
                                disabled={saving}
                                className="flex-1 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 py-3 font-bold rounded-xl transition"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ProtectedRoute>
    );
}

// useSearchParams drives the deep-linked tab, which requires a Suspense
// boundary for the static shell to build.
export default function ProfilePage() {
    return (
        <Suspense fallback={<div className="min-h-screen" />}>
            <ProfileContent />
        </Suspense>
    );
}
