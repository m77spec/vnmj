"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, GraduationCap, LoaderCircle, Phone, School, UserRound, UserRoundCheck } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import SelectField from '@/components/SelectField';
import { api, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';

interface GoogleProfile {
    metadata?: Record<string, unknown> | null;
}

interface OnboardingForm {
    fullName: string;
    age: string;
    phone: string;
    university: string;
    specialty: string;
    studyStatus: string;
    studyLevel: string;
}

const EMPTY_FORM: OnboardingForm = {
    fullName: '',
    age: '',
    phone: '',
    university: '',
    specialty: '',
    studyStatus: '',
    studyLevel: '',
};

function CompleteGoogleProfile() {
    const router = useRouter();
    const { user } = useAuth();
    const { t } = useI18n();
    const { dark } = useTheme();
    const [form, setForm] = useState(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        api.get<GoogleProfile>('/users/me')
            .then(({ data }) => {
                if (!active) return;
                const metadata = data.metadata ?? {};
                if (metadata.googleOnboardingPending !== true) {
                    router.replace('/dashboard');
                    return;
                }
                setForm((current) => ({
                    ...current,
                    fullName: typeof metadata.fullName === 'string' ? metadata.fullName : '',
                    age: metadata.age != null ? String(metadata.age) : '',
                    phone: typeof metadata.phone === 'string' ? metadata.phone : '',
                    university: typeof metadata.university === 'string' ? metadata.university : '',
                    specialty: typeof metadata.specialty === 'string' ? metadata.specialty : '',
                    studyStatus: typeof metadata.studyStatus === 'string' ? metadata.studyStatus : '',
                    studyLevel: typeof metadata.studyLevel === 'string' ? metadata.studyLevel : '',
                }));
            })
            .catch((requestError: unknown) => {
                if (active) setError(getErrorMessage(requestError) || t('auth.complete_profile_load_failed'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [router, t]);

    const inputClass = `w-full rounded-xl border px-4 py-3.5 outline-none transition focus:border-brand-gold focus:ring-2 focus:ring-brand-gold/30 ${
        dark ? 'border-white/10 bg-white/5 text-white [color-scheme:dark]' : 'border-gray-200 bg-white text-brand-navy'
    }`;
    const labelClass = `mb-1.5 block text-sm font-bold ${dark ? 'text-gray-200' : 'text-gray-700'}`;

    const update = (key: keyof OnboardingForm, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await api.patch('/users/me', {
                metadata: {
                    fullName: form.fullName.trim(),
                    age: Number(form.age),
                    phone: form.phone.trim(),
                    university: form.university.trim(),
                    specialty: form.specialty.trim(),
                    studyStatus: form.studyStatus,
                    studyLevel: form.studyStatus === 'STUDENT' ? form.studyLevel.trim() : '',
                    googleOnboardingPending: false,
                },
            });
            router.replace('/dashboard');
        } catch (requestError) {
            setError(getErrorMessage(requestError) || t('auth.complete_profile_save_failed'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className={`flex min-h-screen items-center justify-center ${dark ? 'bg-brand-navy-dark text-white' : 'bg-gray-50 text-brand-navy'}`}>
                <LoaderCircle className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={30} />
            </div>
        );
    }

    return (
        <main className={`relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12 ${dark ? 'bg-brand-navy-dark' : 'bg-gray-50'}`}>
            <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-gold/10 blur-[100px]" />
            <section className={`relative w-full max-w-2xl overflow-hidden rounded-[2rem] border shadow-2xl ${dark ? 'border-white/10 bg-brand-navy' : 'border-gray-200 bg-white'}`}>
                <div className={`px-6 py-8 text-center sm:px-10 ${dark ? 'bg-gradient-to-br from-brand-navy via-[#0e2a52] to-[#0a1e3c]' : 'bg-gradient-to-br from-brand-mist to-white'}`}>
                    <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-gold/15 text-brand-gold-dark dark:text-brand-gold-light">
                        <UserRoundCheck size={27} />
                    </span>
                    <p className={`text-xs font-black uppercase tracking-[0.18em] ${dark ? 'text-brand-gold-light' : 'text-brand-gold-dark'}`}>
                        {t('auth.complete_profile_step')}
                    </p>
                    <h1 className={`mt-2 text-2xl font-black sm:text-3xl ${dark ? 'text-white' : 'text-brand-navy'}`}>
                        {t('auth.complete_profile_title')}
                    </h1>
                    <p className={`mx-auto mt-3 max-w-lg text-sm leading-6 ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {t('auth.complete_profile_description')}
                    </p>
                    {user?.email && (
                        <p className={`mt-3 text-sm font-bold ${dark ? 'text-brand-gold-light' : 'text-brand-navy'}`} dir="ltr">
                            {user.email}
                        </p>
                    )}
                </div>

                <form onSubmit={submit} className="space-y-5 p-6 sm:p-10">
                    <div className="grid gap-5 sm:grid-cols-2">
                        <label className="sm:col-span-2">
                            <span className={labelClass}>{t('auth.fullName')} *</span>
                            <span className="relative block">
                                <UserRound className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input required maxLength={120} autoComplete="name" className={`${inputClass} ps-11`} value={form.fullName} onChange={(event) => update('fullName', event.target.value)} />
                            </span>
                        </label>

                        <label>
                            <span className={labelClass}>{t('auth.age')} *</span>
                            <input required type="number" min={1} max={120} step={1} inputMode="numeric" className={inputClass} value={form.age} onChange={(event) => update('age', event.target.value)} />
                        </label>

                        <label>
                            <span className={labelClass}>{t('auth.phone')}</span>
                            <span className="relative block">
                                <Phone className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input type="tel" maxLength={32} autoComplete="tel" dir="ltr" className={`${inputClass} ps-11`} placeholder={t('auth.phone_ph')} value={form.phone} onChange={(event) => update('phone', event.target.value)} />
                            </span>
                        </label>

                        <label className="sm:col-span-2">
                            <span className={labelClass}>{t('auth.university')} *</span>
                            <span className="relative block">
                                <School className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input required maxLength={120} autoComplete="organization" className={`${inputClass} ps-11`} placeholder={t('auth.university_ph')} value={form.university} onChange={(event) => update('university', event.target.value)} />
                            </span>
                        </label>

                        <label className="sm:col-span-2">
                            <span className={labelClass}>{t('auth.specialty')}</span>
                            <span className="relative block">
                                <GraduationCap className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input maxLength={120} className={`${inputClass} ps-11`} placeholder={t('auth.specialty_ph')} value={form.specialty} onChange={(event) => update('specialty', event.target.value)} />
                            </span>
                        </label>

                        <label className="sm:col-span-2">
                            <span className={labelClass}>{t('auth.study_status')} *</span>
                            <SelectField
                                icon={GraduationCap}
                                inputCls={inputClass}
                                value={form.studyStatus}
                                onChange={(value) => update('studyStatus', value)}
                                placeholder={t('auth.study_status_select')}
                                ariaLabel={t('auth.study_status')}
                                options={[
                                    { value: 'STUDENT', label: t('auth.study_status_student') },
                                    { value: 'GRADUATE', label: t('auth.study_status_graduate') },
                                    { value: 'OTHER', label: t('auth.study_status_other') },
                                ]}
                            />
                        </label>

                        {form.studyStatus === 'STUDENT' && (
                            <label className="sm:col-span-2">
                                <span className={labelClass}>{t('auth.study_level')} *</span>
                                <input required maxLength={80} className={inputClass} placeholder={t('auth.study_level_ph')} value={form.studyLevel} onChange={(event) => update('studyLevel', event.target.value)} />
                            </label>
                        )}
                    </div>

                    {error && (
                        <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-300">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-gold to-brand-gold-dark px-5 py-3.5 font-black text-brand-navy transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {saving ? <LoaderCircle size={19} className="animate-spin" /> : <Check size={19} />}
                        {saving ? t('common.saving') : t('auth.complete_profile_continue')}
                        {!saving && <ArrowRight className="rtl:rotate-180" size={18} />}
                    </button>
                </form>
            </section>
        </main>
    );
}

export default function CompleteGoogleProfilePage() {
    return (
        <ProtectedRoute>
            <CompleteGoogleProfile />
        </ProtectedRoute>
    );
}
