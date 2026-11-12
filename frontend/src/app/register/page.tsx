"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getErrorMessage, isRegistrationEmailFailure } from '@/lib/api';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { Mail, Lock, User, Phone, LogIn, GraduationCap, UserCog, Layers, Users, Cake, School, Home } from 'lucide-react';

import { useI18n } from '@/lib/i18n-context';
import { useTheme } from '@/lib/theme-context';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import SelectField from '@/components/SelectField';
import { useAuth } from '@/lib/auth-context';

export default function RegisterPage() {
    return (
        <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-gray-50 dark:bg-brand-navy-dark dark:text-gray-300 text-gray-600 font-bold">Loading...</div>}>
            <RegisterForm />
        </Suspense>
    );
}

function RegisterForm() {
    const router = useRouter();
    // Carried from the login prompt so a visitor who registers from a course
    // page still lands back on that course after they sign in.
    const redirect = useSearchParams()?.get('redirect') || '/dashboard';
    const { t } = useI18n();
    const { dark } = useTheme();
    const { isAuthenticated } = useAuth();

    useEffect(() => {
        if (isAuthenticated) router.replace('/dashboard');
    }, [isAuthenticated, router]);

    const [formData, setFormData] = useState({
        fullName: '',
        phone: '',
        email: '',
        password: '',
        confirmPassword: '',
        gender: '',
        birthDate: '',
        university: '',
        specialty: '',
        studyStatus: '',
        studyLevel: ''
    });
    const [isLoading, setIsLoading] = useState(false);

    const inputCls = `block w-full pl-11 pr-4 rtl:pr-11 rtl:pl-4 py-3.5 border rounded-xl focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition-all duration-200 ${dark ? 'bg-white/5 border-white/10 text-white hover:bg-white/10 [color-scheme:dark]' : 'bg-white border-gray-300 text-brand-charcoal hover:bg-gray-50'}`;
    const labelCls = `block text-sm font-black mb-1.5 ${dark ? 'text-gray-300' : 'text-gray-700'}`;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (formData.password !== formData.confirmPassword) {
            toast.error(t('auth.passwords_not_match'));
            return;
        }

        setIsLoading(true);
        try {
            await api.post('/auth/register', {
                email: formData.email,
                password: formData.password,
                ...(formData.fullName && { fullName: formData.fullName }),
                ...(formData.phone && { phone: formData.phone }),
                ...(formData.gender && { gender: formData.gender }),
                ...(formData.birthDate && { birthDate: formData.birthDate }),
                ...(formData.university && { university: formData.university }),
                ...(formData.specialty && { specialty: formData.specialty }),
                ...(formData.studyStatus && { studyStatus: formData.studyStatus }),
                ...(formData.studyLevel && { studyLevel: formData.studyLevel }),
            });
            toast.success(t('auth.registration_success'));
            router.push(`/login?verifyEmail=1&email=${encodeURIComponent(formData.email)}&redirect=${encodeURIComponent(redirect)}`);
        } catch (err) {
            if (isRegistrationEmailFailure(err)) {
                toast.error(t('auth.verification_delivery_failed'));
                router.push(`/login?verificationEmailFailed=1&email=${encodeURIComponent(formData.email)}&redirect=${encodeURIComponent(redirect)}`);
            } else {
                toast.error(getErrorMessage(err) || t('auth.register_failed'));
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (isAuthenticated) {
        return (
            <div className={`min-h-screen flex items-center justify-center font-bold ${dark ? 'bg-brand-navy-dark text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                {t('common.loading')}
            </div>
        );
    }

    return (
        <div className={`min-h-screen flex flex-col items-center justify-center relative overflow-hidden p-4 ${dark ? 'bg-brand-navy-dark' : 'bg-gray-50'}`}>
            {/* Background elements */}
            <div className="absolute top-0 right-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-32 -right-32 w-96 h-96 bg-brand-gold/10 rounded-full blur-[100px] animate-float opacity-70"></div>
                <div className="absolute bottom-0 left-0 w-[30rem] h-[30rem] bg-brand-gold/5 rounded-full blur-[120px] animate-float opacity-70" style={{ animationDelay: '2s', animationDuration: '8s' }}></div>
            </div>

            <div className={`absolute top-6 right-6 rtl:left-6 rtl:right-auto z-50 rounded-full shadow-sm border p-1 ${dark ? 'bg-white/5 backdrop-blur-md border-white/10' : 'bg-white border-gray-200'}`}>
                <LanguageSwitcher />
            </div>
            <Link
                href="/"
                className={`absolute top-6 left-6 rtl:right-6 rtl:left-auto z-50 inline-flex items-center gap-2 rounded-full shadow-sm border px-4 py-2.5 text-sm font-bold transition-colors ${dark ? 'bg-white/5 backdrop-blur-md border-white/10 text-gray-300 hover:text-brand-gold-light hover:border-white/20' : 'bg-white border-gray-200 text-brand-navy hover:text-brand-gold-dark hover:border-gray-300'}`}
            >
                <Home size={15} />
                {t('landing.home')}
            </Link>
            <div className={`w-full max-w-md backdrop-blur-2xl rounded-[2rem] shadow-xl overflow-hidden relative z-10 transition-all duration-500 my-8 ${dark ? 'bg-brand-navy-dark/90 shadow-[0_20px_60px_rgb(0,0,0,0.4)] border border-white/10 hover:border-white/20' : 'bg-white border border-gray-200'}`}>
                <div className={`p-8 text-center relative overflow-hidden ${dark ? 'bg-gradient-to-br from-brand-navy via-[#0e2a52] to-[#0a1e3c] border-b border-white/10' : 'bg-gradient-to-br from-brand-mist via-white to-white border-b border-gray-100 bg-opacity-70'}`}>
                    <div className={`absolute top-0 inset-x-0 h-px ${dark ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent' : 'bg-gradient-to-r from-transparent via-brand-gold/30 to-transparent'}`}></div>
                    <img
                        src={dark ? '/logos/LaxaLab_Academy_Horizontal_Reverse_4K.png' : '/logos/LaxaLab_Academy_Horizontal_Primary_4K.png'}
                        alt="Laxalab Academy"
                        className="h-10 w-auto object-contain mx-auto mb-4 drop-shadow-lg relative z-10"
                    />
                    <h2 className={`text-2xl font-black mb-2 relative z-10 ${dark ? 'text-white' : 'text-brand-navy'}`}>{t('auth.join_laxalab')}</h2>
                    <p className={`text-sm font-semibold relative z-10 ${dark ? 'text-brand-gold-light shadow-black/20' : 'text-brand-gold-dark'}`}>{t('auth.start_learning')}</p>
                </div>

                <div className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className={labelCls}>{t('auth.fullName')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <User size={18} className="text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    required
                                    className={inputCls}
                                    placeholder="Jane Doe"
                                    value={formData.fullName}
                                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>{t('auth.phone')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <Phone size={18} className="text-gray-400" />
                                </div>
                                <input
                                    type="tel"
                                    required
                                    className={`${inputCls} text-left`}
                                    placeholder={t('auth.phone_ph')}
                                    dir="ltr"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls} htmlFor="reg-gender">{t('auth.gender')}</label>
                            <div className="relative flex items-center">
                                <SelectField
                                    id="reg-gender"
                                    icon={Users}
                                    inputCls={inputCls}
                                    value={formData.gender}
                                    onChange={(v) => setFormData({ ...formData, gender: v })}
                                    placeholder={t('auth.gender_select')}
                                    ariaLabel={t('auth.gender')}
                                    options={[
                                        { value: 'MALE', label: t('auth.gender_male') },
                                        { value: 'FEMALE', label: t('auth.gender_female') },
                                    ]}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls} htmlFor="reg-birthdate">{t('auth.birth_date')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <Cake size={18} className="text-gray-400" />
                                </div>
                                <input
                                    id="reg-birthdate"
                                    type="date"
                                    max={new Date().toISOString().slice(0, 10)}
                                    className={`${inputCls} text-left`}
                                    value={formData.birthDate}
                                    onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>{t('auth.university')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <School size={18} className="text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    className={inputCls}
                                    placeholder={t('auth.university_ph')}
                                    value={formData.university}
                                    onChange={(e) => setFormData({ ...formData, university: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>{t('auth.specialty')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <GraduationCap size={18} className="text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    className={inputCls}
                                    placeholder={t('auth.specialty_ph')}
                                    value={formData.specialty}
                                    onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls} htmlFor="reg-study-status">{t('auth.study_status')}</label>
                            <div className="relative flex items-center">
                                <SelectField
                                    id="reg-study-status"
                                    icon={UserCog}
                                    inputCls={inputCls}
                                    value={formData.studyStatus}
                                    onChange={(v) => setFormData({ ...formData, studyStatus: v })}
                                    placeholder={t('auth.study_status_select')}
                                    ariaLabel={t('auth.study_status')}
                                    options={[
                                        { value: 'STUDENT', label: t('auth.study_status_student') },
                                        { value: 'GRADUATE', label: t('auth.study_status_graduate') },
                                        { value: 'OTHER', label: t('auth.study_status_other') },
                                    ]}
                                />
                            </div>
                        </div>

                        {formData.studyStatus === 'STUDENT' && (
                            <div>
                                <label className={labelCls}>{t('auth.study_level')}</label>
                                <div className="relative flex items-center">
                                    <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                        <Layers size={18} className="text-gray-400" />
                                    </div>
                                    <input
                                        type="text"
                                        className={inputCls}
                                        placeholder={t('auth.study_level_ph')}
                                        value={formData.studyLevel}
                                        onChange={(e) => setFormData({ ...formData, studyLevel: e.target.value })}
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className={labelCls}>{t('auth.email')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <Mail size={18} className="text-gray-400" />
                                </div>
                                <input
                                    type="email"
                                    required
                                    className={`${inputCls} text-left`}
                                    placeholder="you@example.com"
                                    dir="ltr"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>{t('auth.password')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <Lock size={18} className="text-gray-400" />
                                </div>
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    className={`${inputCls} text-left`}
                                    placeholder="••••••••"
                                    dir="ltr"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>{t('auth.confirmPassword')}</label>
                            <div className="relative flex items-center">
                                <div className="absolute left-4 rtl:right-4 rtl:left-auto flex items-center pointer-events-none">
                                    <Lock size={18} className="text-gray-400" />
                                </div>
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    className={`${inputCls} text-left`}
                                    placeholder="••••••••"
                                    dir="ltr"
                                    value={formData.confirmPassword}
                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-brand-gold hover:bg-brand-gold-light text-brand-navy-dark focus:ring-4 focus:ring-brand-gold/30 font-black py-4 rounded-xl shadow-lg transition-all duration-300 transform active:scale-[0.98] flex justify-center items-center gap-2 mt-4 disabled:opacity-50"
                        >
                            {isLoading ? t('auth.creating_account') : (
                                <>
                                    <LogIn size={20} className="rtl:rotate-180" /> {t('auth.register_securely')}
                                </>
                            )}
                        </button>

                        <div className="relative flex items-center justify-center my-6 text-sm mt-8">
                            <span className={`absolute px-3 font-bold z-10 ${dark ? 'bg-brand-navy-dark text-gray-400' : 'bg-white text-gray-500'}`}>{t('common.or')}</span>
                            <div className={`w-full h-px ${dark ? 'bg-white/10' : 'bg-gray-200'}`}></div>
                        </div>

                        <button
                            type="button"
                            onClick={() => router.push('/api/auth/google')}
                            className={`w-full flex items-center justify-center gap-3 py-4 border font-bold rounded-xl transition-all duration-200 ${dark ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-white' : 'bg-white border-gray-300 hover:bg-gray-50 text-brand-charcoal'}`}
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                            {t('auth.continue_with_google')}
                        </button>
                    </form>

                    <div className="mt-8 text-center">
                        <p className={`text-sm font-semibold ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                            {t('auth.already_have_account')}{' '}
                            <Link href="/login" className={`font-black transition-colors ${dark ? 'text-brand-gold-light hover:text-brand-gold' : 'text-brand-gold-dark hover:text-brand-gold'}`}>
                                {t('auth.sign_in')}
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}