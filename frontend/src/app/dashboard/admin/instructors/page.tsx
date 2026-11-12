"use client";

import { useFetchData } from '@/lib/useFetchData';
import { api, getErrorMessage, downloadProtectedFile } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X, FileText, Link as LinkIcon, Search, Pause, Play, GraduationCap, Eye, EyeOff } from 'lucide-react';
import { PageHeader, Badge, EmptyState, EmptyPanel, SectionHeader, type Tone } from '../components';

interface Application {
    id: string;
    name: string;
    specialty: string;
    bio: string;
    status: string;
    cvFileUrl: string;
    videoIntroUrl?: string | null;
    user?: { email: string } | null;
}

interface User {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
}

function instructorProfileStatus(metadata: User['metadata']) {
    const meta = metadata ?? {};
    const profile = meta.publicProfile && typeof meta.publicProfile === 'object'
        ? meta.publicProfile as Record<string, unknown>
        : {};
    const name = profile.name && typeof profile.name === 'object'
        ? profile.name as Record<string, unknown>
        : {};
    const jobTitle = profile.jobTitle && typeof profile.jobTitle === 'object'
        ? profile.jobTitle as Record<string, unknown>
        : {};
    const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    const hasIdentity = [name.ar, name.en, meta.nameAr, meta.nameEn].some(hasText);
    const hasTitle = [jobTitle.ar, jobTitle.en, meta.jobTitleAr, meta.jobTitleEn].some(hasText);
    const bio = profile.bio && typeof profile.bio === 'object'
        ? profile.bio as Record<string, unknown>
        : {};
    const hasBio = [bio.ar, bio.en, meta.bio, meta.bioEn].some(hasText);
    const experiences = Array.isArray(profile.experiences) ? profile.experiences : [];
    const qualifications = Array.isArray(profile.qualifications) ? profile.qualifications : [];
    const hasExperience = experiences.length + qualifications.length > 0;

    return {
        complete: hasIdentity && hasTitle,
        steps: [hasIdentity, hasTitle, hasBio, hasExperience].filter(Boolean).length,
    };
}

const appTone: Record<string, Tone> = {
    APPROVED: 'green',
    REJECTED: 'red',
    PENDING: 'amber',
};

export default function AdminInstructorsPage() {
    const { data: applications, loading: appsLoading, error: appsError, refetch: refetchApps } = useFetchData<Application[]>('/api/admin/instructor-applications');
    const { data: users, loading: usersLoading, error: usersError, refetch: refetchUsers } = useFetchData<User[]>('/users');
    const { t } = useI18n();
    const [isProcessing, setIsProcessing] = useState<string | null>(null);
    const [downloadingCv, setDownloadingCv] = useState<string | null>(null);
    const [query, setQuery] = useState('');

    const instructors = (users || []).filter(u => u.role === 'INSTRUCTOR');
    const pendingCount = (applications || []).filter(a => a.status === 'PENDING').length;

    const filteredInstructors = instructors.filter(u => !query.trim() || u.email.toLowerCase().includes(query.toLowerCase()));

    const handleAppStatus = async (id: string, status: 'APPROVED' | 'REJECTED') => {
        if (!window.confirm(status === 'APPROVED' ? t('instructorsHr.confirm_approve') : t('instructorsHr.confirm_reject'))) return;
        setIsProcessing(id);
        try {
            await api.patch(`/api/admin/instructor-applications/${id}/status`, { status });
            toast.success(status === 'APPROVED' ? t('instructorsHr.approved_msg') : t('instructorsHr.rejected_msg'));
            refetchApps();
            refetchUsers();
        } catch (e) {
            toast.error(getErrorMessage(e) || t('instructorsHr.update_failed'));
        } finally {
            setIsProcessing(null);
        }
    };

    const handleToggleActive = async (u: User) => {
        if (!window.confirm(u.isActive ? t('admin.suspend_confirm') : t('admin.activate_confirm'))) return;
        setIsProcessing(u.id);
        try {
            await api.patch(`/users/${u.id}`, { isActive: !u.isActive });
            toast.success(u.isActive ? t('admin.user_suspended') : t('admin.user_activated'));
            refetchUsers();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('admin.toggle_status_fail'));
        }
        setIsProcessing(null);
    };

    const handleTogglePublicVisibility = async (u: User) => {
        const visible = (u.metadata?.showOnInstructorsPage as boolean | undefined) !== false;
        setIsProcessing(u.id);
        try {
            await api.patch(`/users/${u.id}/public-instructors-page`, { visible: !visible });
            toast.success(!visible ? t('admin.instructor_public_enabled') : t('admin.instructor_public_disabled'));
            refetchUsers();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('admin.instructor_visibility_failed'));
        } finally {
            setIsProcessing(null);
        }
    };

    const handleDelete = async (u: User) => {
        if (!window.confirm(t('admin.delete_user_confirm'))) return;
        setIsProcessing(u.id);
        try {
            await api.delete(`/users/${u.id}`);
            toast.success(t('admin.user_deleted'));
            refetchUsers();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('admin.delete_user_fail'));
        }
        setIsProcessing(null);
    };

    const handleDownloadCv = async (appId: string) => {
        setDownloadingCv(appId);
        try {
            await downloadProtectedFile(`/api/admin/instructor-applications/${appId}/cv`);
            toast.success(t('instructorsHr.cv_downloaded'));
        } catch (err) {
            toast.error(getErrorMessage(err) || t('instructorsHr.cv_download_failed'));
        } finally {
            setDownloadingCv(null);
        }
    };

    return (
        <div className="space-y-8 animate-fade-in">
            <PageHeader
                title={t('admin.instructors_heading')}
                subtitle={t('admin.instructors_subtitle')}
                actions={
                    <>
                        <div className="inline-flex items-center gap-2 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-purple-200 dark:ring-purple-500/20 px-4 py-2.5 rounded-xl font-black text-sm">
                            <GraduationCap size={18} /> {instructors.length} {t('admin.instructors_count')}
                        </div>
                        <Badge tone={pendingCount > 0 ? 'amber' : 'green'} dot>
                            {pendingCount > 0 ? t('admin.applications_pending') : t('admin.applications_none')} · {pendingCount}
                        </Badge>
                    </>
                }
            />

            {/* Applications */}
            <section>
                <SectionHeader
                    icon={GraduationCap}
                    title={t('admin.applications_title')}
                    subtitle={t('admin.applications_subtitle')}
                    color="purple"
                />

                {appsError && <div className="p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-xl mb-4">{appsError}</div>}

                {appsLoading ? (
                    <div className="h-36 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('admin.loading_applications')}</div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-2 animate-fade-in-up">
                        {applications?.map(app => (
                            <div key={app.id} className="admin-card p-5 flex flex-col">
                                <div className="flex justify-between items-start gap-3 mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="admin-tile w-11 h-11 bg-gradient-to-br from-purple-500/15 to-purple-500/5 text-purple-600 dark:text-purple-400">
                                            <GraduationCap size={20} />
                                        </div>
                                        <div>
                                            <h4 className="font-black text-brand-navy dark:text-white leading-tight">{app.name}</h4>
                                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mt-0.5">{app.specialty}</p>
                                        </div>
                                    </div>
                                    <Badge tone={appTone[app.status] || 'gray'} dot>{t('statuses.' + (app.status || '').toLowerCase())}</Badge>
                                </div>
                                <p className="text-gray-500 dark:text-gray-400 text-sm whitespace-pre-wrap mb-4 flex-1 leading-relaxed">{app.bio}</p>
                                <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-gray-200 dark:border-white/5">
                                    <button onClick={() => handleDownloadCv(app.id)} disabled={downloadingCv === app.id} className="flex items-center gap-2 text-brand-navy dark:text-white font-bold hover:underline bg-gray-100 dark:bg-white/5 px-4 py-2 rounded-lg text-sm transition hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-60">
                                        <FileText size={16} /> {t('instructorsHr.view_cv')}
                                    </button>
                                    {app.videoIntroUrl && (
                                        <a href={app.videoIntroUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-brand-navy dark:text-white font-bold hover:underline bg-gray-100 dark:bg-white/5 px-4 py-2 rounded-lg text-sm transition hover:bg-gray-200 dark:hover:bg-white/10">
                                            <LinkIcon size={16} /> {t('instructorsHr.intro_video')}
                                        </a>
                                    )}
                                    {app.status === 'PENDING' && (
                                        <div className="flex gap-2 ms-auto">
                                            <button onClick={() => handleAppStatus(app.id, 'APPROVED')} disabled={isProcessing === app.id} className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20 font-bold px-4 py-2 rounded-lg text-sm transition disabled:opacity-50">
                                                <Check size={16} /> {t('instructorsHr.approve_application')}
                                            </button>
                                            <button onClick={() => handleAppStatus(app.id, 'REJECTED')} disabled={isProcessing === app.id} className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-500/20 font-bold px-4 py-2 rounded-lg text-sm transition disabled:opacity-50">
                                                <X size={16} /> {t('instructorsHr.reject')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {applications?.length === 0 && (
                            <div className="lg:col-span-2 admin-card p-4">
                                <EmptyPanel icon={GraduationCap} title={t('admin.no_applications')} color="purple" />
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* Instructors directory */}
            <section>
                <SectionHeader
                    icon={GraduationCap}
                    title={t('admin.instructors_directory')}
                    subtitle={t('admin.instructors_directory_subtitle')}
                    color="navy"
                />

                <div className="relative mb-4 max-w-sm">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={t('admin.search_instructors')}
                        className="ps-9 pe-3 py-2.5 border border-gray-300 dark:border-white/10 rounded-xl text-sm w-full bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-brand-gold outline-none transition"
                    />
                </div>

                {usersError && <div className="p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-xl mb-4">{usersError}</div>}

                {usersLoading ? (
                    <div className="h-36 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400">{t('admin.loading_instructors')}</div>
                ) : (
                    <div className="admin-table-wrap animate-fade-in-up">
                        <table className="admin-table text-left">
                            <thead>
                                <tr>
                                    <th>{t('admin.col_email')}</th>
                                    <th>{t('admin.instructor_profile_completion')}</th>
                                    <th>{t('admin.instructor_public_visibility')}</th>
                                    <th>{t('admin.col_status')}</th>
                                    <th>{t('admin.col_joined')}</th>
                                    <th className="text-right">{t('admin.col_admin_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                                {filteredInstructors.map(u => (
                                    <tr key={u.id} className={`animate-fade-in hover:bg-gray-100 dark:hover:bg-white/5 ${u.isActive === false ? 'opacity-60' : ''}`}>
                                        <td className="p-4 font-bold text-brand-navy dark:text-gray-200">{u.email}</td>
                                        <td className="p-4">
                                            {(() => {
                                                const status = instructorProfileStatus(u.metadata);
                                                return (
                                                    <div className="space-y-1">
                                                        <Badge tone={status.complete ? 'green' : 'amber'} dot>
                                                            {status.complete ? t('admin.instructor_profile_complete') : t('admin.instructor_profile_incomplete')}
                                                        </Badge>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            {status.steps}/4 {t('admin.instructor_profile_steps')}
                                                        </p>
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="p-4">
                                            {(() => {
                                                const visible = (u.metadata?.showOnInstructorsPage as boolean | undefined) !== false;
                                                return (
                                                    <div className="flex items-center gap-2">
                                                        <Badge tone={visible ? 'green' : 'gray'} dot>
                                                            {visible ? t('admin.instructor_public_visible') : t('admin.instructor_public_hidden')}
                                                        </Badge>
                                                        <button
                                                            onClick={() => handleTogglePublicVisibility(u)}
                                                            disabled={isProcessing === u.id}
                                                            aria-label={visible ? t('admin.instructor_public_hide_action') : t('admin.instructor_public_show_action')}
                                                            title={visible ? t('admin.instructor_public_hide_action') : t('admin.instructor_public_show_action')}
                                                            className={`admin-action-btn disabled:opacity-40 ${visible ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500 dark:hover:text-white'}`}
                                                        >
                                                            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                                                        </button>
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="p-4">
                                            <Badge tone={u.isActive === false ? 'red' : 'green'} dot>
                                                {u.isActive === false ? t('admin.status_suspended') : t('admin.status_active')}
                                            </Badge>
                                        </td>
                                        <td className="p-4 text-sm text-gray-500 dark:text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                                        <td className="p-4 text-right whitespace-nowrap">
                                            <button onClick={() => handleToggleActive(u)} disabled={isProcessing === u.id} className={`admin-action-btn ms-1 tooltip disabled:opacity-40 ${u.isActive === false ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white' : 'bg-brand-gold/10 text-brand-gold-dark dark:text-brand-gold-light hover:bg-brand-gold hover:text-white'}`} title={u.isActive === false ? t('admin.activate_title') : t('admin.suspend_title')}>
                                                {u.isActive === false ? <Play size={18} /> : <Pause size={18} />}
                                            </button>
                                            <button onClick={() => handleDelete(u)} disabled={isProcessing === u.id} className="admin-action-btn bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white tooltip ms-1 disabled:opacity-40" title={t('admin.delete_user_title')}>
                                                <X size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {filteredInstructors.length === 0 && (
                                    <EmptyState icon={GraduationCap} title={t('admin.no_instructors')} color="purple" />
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
