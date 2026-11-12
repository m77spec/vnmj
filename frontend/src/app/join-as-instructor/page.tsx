"use client";

import React, { useEffect, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import { UploadCloud, CheckCircle, Video, User, Briefcase } from 'lucide-react';
import MarketingShell from '@/components/MarketingShell';
import { useAuth } from '@/lib/auth-context';

export default function JoinAsInstructorPage() {
    const router = useRouter();
    const { t, locale } = useI18n();
    const { dark } = useTheme();
    const { isAuthenticated, user } = useAuth();
    const isAr = locale === 'ar';
    const [formData, setFormData] = useState({ name: '', bio: '', specialty: '', videoIntroUrl: '' });
    const [cvFile, setCvFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileError, setProfileError] = useState('');
    const [accountEmail, setAccountEmail] = useState('');

    useEffect(() => {
        if (user?.role === 'INSTRUCTOR') {
            router.replace('/dashboard');
        }
    }, [router, user?.role]);

    useEffect(() => {
        if (!isAuthenticated || user?.role === 'INSTRUCTOR') return;

        let active = true;
        const loadProfile = async () => {
            setProfileLoading(true);
            setProfileError('');
            try {
                const response = await api.get('/users/me');
                if (!active) return;
                const metadata = response.data?.metadata;
                const profileName = [
                    metadata?.fullName,
                    metadata?.nameAr,
                    metadata?.nameEn,
                ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
                setFormData((current) => ({
                    ...current,
                    name: current.name.trim() ? current.name : profileName?.trim() || '',
                }));
                setAccountEmail(typeof response.data?.email === 'string' ? response.data.email : '');
            } catch (error) {
                if (active) setProfileError(getErrorMessage(error) || t('common.error'));
            } finally {
                if (active) setProfileLoading(false);
            }
        };

        void loadProfile();
        return () => { active = false; };
    }, [isAuthenticated, t, user?.role]);

    const inputCls = dark
        ? 'w-full border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl p-4 focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition-all text-white [color-scheme:dark]'
        : 'w-full border border-gray-300 bg-white rounded-xl p-4 focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition-all text-brand-charcoal';
    const labelCls = `block text-sm font-bold mb-2 flex items-center gap-2 ${dark ? 'text-gray-300' : 'text-gray-700'}`;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!cvFile) {
            toast.error(t('joinInstructor.cv_required'));
            return;
        }
        if (!formData.name || !formData.bio || !formData.specialty) {
            toast.error(t('joinInstructor.fill_required'));
            return;
        }

        setIsSubmitting(true);
        const data = new FormData();
        data.append('cv', cvFile);
        data.append('name', formData.name);
        data.append('bio', formData.bio);
        data.append('specialty', formData.specialty);
        if (formData.videoIntroUrl) data.append('videoIntroUrl', formData.videoIntroUrl);

        try {
            await api.post('/instructor-applications', data, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setSuccess(true);
            toast.success(t('joinInstructor.submitted'));
        } catch (error) {
            const is401 = error && typeof error === 'object' && 'response' in error
                && (error as { response?: { status?: number } }).response?.status === 401;
            if (is401) {
                toast.error(t('joinInstructor.must_login'));
                router.push('/login?redirect=/join-as-instructor');
            } else {
                toast.error(getErrorMessage(error) || t('joinInstructor.submit_fail'));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (success) {
        return (
            <MarketingShell>
                <div className="flex items-center justify-center p-4 py-20">
                    <div className={`p-12 rounded-3xl shadow-sm max-w-lg w-full text-center border ${dark ? 'bg-brand-navy-dark border-white/10' : 'bg-white border-gray-200'}`}>
                        <CheckCircle className="w-24 h-24 text-green-500 mx-auto mb-6" />
                        <h2 className={`text-3xl font-black mb-4 ${dark ? 'text-white' : 'text-brand-navy'}`}>{t('joinInstructor.success_title')}</h2>
                        <p className={`mb-8 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                            {t('joinInstructor.success_desc')}
                        </p>
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="bg-brand-gold hover:bg-[#b08e50] text-brand-navy font-bold py-4 px-8 rounded-xl shadow-lg transition w-full"
                        >
                            {t('joinInstructor.go_dashboard')}
                        </button>
                    </div>
                </div>
            </MarketingShell>
        );
    }

    if (user?.role === 'INSTRUCTOR') {
        return (
            <MarketingShell>
                <div className={`flex min-h-64 items-center justify-center font-bold ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {t('common.loading')}
                </div>
            </MarketingShell>
        );
    }

    if (isAuthenticated && profileLoading) {
        return (
            <MarketingShell>
                <div className={`flex min-h-64 items-center justify-center font-bold ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {t('common.loading')}
                </div>
            </MarketingShell>
        );
    }

    return (
        <MarketingShell
            title={t('joinInstructor.teach_title')}
            subtitle={t('joinInstructor.teach_desc')}
        >
            {/* Application Form */}
            <div className="max-w-3xl mx-auto mt-0 md:-mt-24 relative z-10 pb-20">
                <div className={`p-8 md:p-12 rounded-3xl shadow-sm border ${dark ? 'bg-brand-navy-dark border-white/10' : 'bg-white border-gray-200'}`}>
                    <h2 className={`text-2xl font-black mb-8 border-b pb-4 ${dark ? 'text-white border-white/10' : 'text-brand-navy border-gray-200'}`}>{t('joinInstructor.app_heading')}</h2>

                    {profileError && (
                        <p role="alert" className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-bold text-red-600 dark:text-red-300">
                            {isAr ? 'تعذّر تحميل بيانات حسابك. يمكنك إدخال اسمك يدويًا والمحاولة لاحقًا.' : `We could not load your account details. You can enter your name manually. ${profileError}`}
                        </p>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className={labelCls}>
                                    <User size={16} /> {t('joinInstructor.full_name_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    className={inputCls}
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                                {accountEmail && (
                                    <p className={`mt-2 text-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {isAr ? 'الحساب المستخدم:' : 'Account:'} <span dir="ltr">{accountEmail}</span>
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className={labelCls}>
                                    <Briefcase size={16} /> {t('joinInstructor.specialty_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder={t('joinInstructor.specialty_placeholder')}
                                    className={inputCls}
                                    value={formData.specialty}
                                    onChange={e => setFormData({ ...formData, specialty: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>
                                <Video size={16} /> {t('joinInstructor.video_label')}
                            </label>
                            <input
                                type="url"
                                placeholder={t('joinInstructor.video_placeholder')}
                                className={inputCls}
                                value={formData.videoIntroUrl}
                                onChange={e => setFormData({ ...formData, videoIntroUrl: e.target.value })}
                            />
                        </div>

                        <div>
                            <label className={labelCls}>{t('joinInstructor.bio_label')}</label>
                            <textarea
                                required
                                rows={4}
                                placeholder={t('joinInstructor.bio_placeholder')}
                                className={inputCls}
                                value={formData.bio}
                                onChange={e => setFormData({ ...formData, bio: e.target.value })}
                            />
                        </div>

                        <div>
                            <label className={labelCls}>{t('joinInstructor.cv_label')}</label>
                            <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-8 cursor-pointer transition ${cvFile ? 'border-brand-gold bg-brand-gold/10' : dark ? 'border-white/15 hover:bg-white/5 hover:border-white/25' : 'border-gray-300 hover:bg-gray-50 hover:border-gray-400'}`}>
                                <UploadCloud className={cvFile ? "text-brand-gold mb-2" : "text-gray-500 mb-2"} size={32} />
                                <span className={cvFile ? "font-bold text-brand-gold-light break-all" : dark ? "text-gray-400 font-medium break-all" : "text-gray-600 font-medium break-all"}>
                                    {cvFile ? cvFile.name : t('joinInstructor.cv_placeholder')}
                                </span>
                                <input
                                    type="file"
                                    accept=".pdf,.doc,.docx"
                                    className="hidden"
                                    onChange={e => setCvFile(e.target.files?.[0] || null)}
                                />
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="bg-brand-gold hover:bg-brand-gold-light hover:-translate-y-1 text-brand-navy-dark font-bold py-4 px-8 rounded-xl shadow-lg transition-all duration-300 w-full disabled:opacity-50 mt-8 disabled:hover:translate-y-0"
                        >
                            {isSubmitting ? t('joinInstructor.submitting') : t('joinInstructor.submit_application')}
                        </button>
                    </form>
                </div>
            </div>
        </MarketingShell>
    );
}