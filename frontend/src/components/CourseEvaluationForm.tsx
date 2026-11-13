"use client";

import { useState } from 'react';
import { CheckCircle, Loader, Star } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';

type QuestionType = 'RATING' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TEXT' | 'YES_NO';
interface EvaluationOption {
    value: string;
    labelAr: string;
    labelEn: string;
}
interface EvaluationQuestion {
    id: string;
    promptAr: string;
    promptEn: string;
    type: QuestionType;
    isRequired: boolean;
    options: EvaluationOption[] | null;
}
export interface CourseEvaluationFormData {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr: string | null;
    descriptionEn: string | null;
    questions: EvaluationQuestion[];
}

export interface MyCourseEvaluation {
    submitted: boolean;
    submittedAt: string | null;
    canSubmit: boolean;
    totalLessons: number;
    completedLessons: number;
    pendingTasks: number;
    failedQuizzes: number;
    form?: CourseEvaluationFormData | null;
}

export default function CourseEvaluationForm({
    courseId,
    form,
    onSubmitted,
}: {
    courseId: string;
    form: CourseEvaluationFormData | null;
    onSubmitted: (evaluation: MyCourseEvaluation) => void;
}) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [answers, setAnswers] = useState<Record<string, string | number | boolean | string[]>>({});
    const [saving, setSaving] = useState(false);

    const setAnswer = (questionId: string, value: string | number | boolean | string[]) => {
        setAnswers((current) => ({ ...current, [questionId]: value }));
    };

    const isAnswered = (question: EvaluationQuestion) => {
        const answer = answers[question.id];
        return answer !== undefined
            && answer !== ''
            && !(typeof answer === 'string' && !answer.trim())
            && !(Array.isArray(answer) && answer.length === 0);
    };

    const submit = async () => {
        if (!form || saving) return;
        if (form.questions.some((question) => question.isRequired && !isAnswered(question))) {
            toast.error(isAr ? 'أجب عن جميع الأسئلة المطلوبة' : 'Answer all required questions');
            return;
        }
        setSaving(true);
        try {
            const response = await api.post(`/course-evaluations/my/${courseId}`, {
                answers: form.questions.map((question) => ({
                    questionId: question.id,
                    value: answers[question.id] ?? null,
                })),
            });
            onSubmitted({
                submitted: true,
                submittedAt: response.data.submittedAt,
                canSubmit: true,
                totalLessons: 0,
                completedLessons: 0,
                pendingTasks: 0,
                failedQuizzes: 0,
                form,
            });
            toast.success(isAr ? 'شكراً لك، تم استلام تقييمك' : 'Thank you. Your evaluation was submitted.');
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر إرسال التقييم. حاول مرة أخرى.' : 'Could not submit the evaluation. Please try again.'));
        } finally {
            setSaving(false);
        }
    };

    const ratingField = (question: EvaluationQuestion) => {
        const value = typeof answers[question.id] === 'number' ? answers[question.id] as number : 0;
        const label = isAr ? question.promptAr : question.promptEn;
        return (
            <fieldset key={question.id} className="min-w-0">
                <legend className="mb-2 text-sm font-black text-ink">
                    {label}{question.isRequired && <span className="ms-1 text-red-500">*</span>}
                </legend>
                <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={label}>
                    {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                            key={rating}
                            type="button"
                            role="radio"
                            aria-checked={value === rating}
                            aria-label={`${rating} / 5`}
                            onClick={() => setAnswer(question.id, rating)}
                            className={`rounded-lg p-2 transition ${rating <= value ? 'text-amber-500' : 'text-ink-subtle hover:text-amber-400'}`}
                        >
                            <Star size={24} fill={rating <= value ? 'currentColor' : 'none'} />
                        </button>
                    ))}
                    <span className="ms-2 text-xs font-bold text-ink-subtle">
                        {value ? `${value}/5` : (isAr ? 'اختر التقييم' : 'Choose a rating')}
                    </span>
                </div>
            </fieldset>
        );
    };

    if (!form || form.questions.length === 0) {
        return (
            <section role="alert" className="rounded-2xl border border-red-500/25 bg-red-500/5 p-5 text-sm font-bold text-red-700 dark:text-red-300">
                {isAr ? 'نموذج تقييم هذه الدورة غير متاح حاليًا. يرجى إبلاغ الإدارة.' : 'This course evaluation form is unavailable. Please contact an administrator.'}
            </section>
        );
    }

    return (
        <section className="rounded-2xl border border-brand-gold/30 bg-surface p-5 shadow-lg sm:p-7" aria-labelledby="course-evaluation-title">
            <div className="mb-5 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gold/15 text-amber-500">
                    <Star size={22} />
                </div>
                <div className="min-w-0">
                    <h2 id="course-evaluation-title" className="text-lg font-black text-ink">
                        {isAr ? form.titleAr : form.titleEn}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                        {(isAr ? form.descriptionAr : form.descriptionEn)
                            || (isAr
                                ? 'تقييمك مطلوب لإتمام الدورة وإتاحة إصدار الشهادة. لا يطلع على النتائج إلا المدير ومدير الدورات.'
                                : 'Your evaluation is required to complete the course and make its certificate available. Only administrators and course managers can see the results.')}
                    </p>
                </div>
            </div>

            <div className="space-y-5">
                {form.questions.map((question) => {
                    if (question.type === 'RATING') return ratingField(question);
                    const prompt = isAr ? question.promptAr : question.promptEn;
                    const current = answers[question.id];
                    return (
                        <fieldset key={question.id} className="min-w-0">
                            <legend className="mb-2 text-sm font-black text-ink">
                                {prompt}{question.isRequired && <span className="ms-1 text-red-500">*</span>}
                            </legend>
                            {question.type === 'TEXT' && (
                                <textarea
                                    value={typeof current === 'string' ? current : ''}
                                    onChange={(event) => setAnswer(question.id, event.target.value)}
                                    maxLength={2000}
                                    rows={4}
                                    className="w-full rounded-xl border border-line bg-surface-sunken p-3 text-sm text-ink outline-none transition focus:border-brand-gold"
                                    placeholder={isAr ? 'اكتب إجابتك...' : 'Write your answer...'}
                                />
                            )}
                            {question.type === 'SINGLE_CHOICE' && (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {(question.options ?? []).map((option) => (
                                        <label key={option.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${current === option.value ? 'border-brand-gold bg-brand-gold/10 text-ink' : 'border-line bg-surface-sunken text-ink-muted'}`}>
                                            <input type="radio" name={question.id} value={option.value} checked={current === option.value} onChange={() => setAnswer(question.id, option.value)} className="accent-amber-500" />
                                            <span>{isAr ? option.labelAr : option.labelEn}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                            {question.type === 'MULTIPLE_CHOICE' && (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {(question.options ?? []).map((option) => {
                                        const selected = Array.isArray(current) ? current : [];
                                        return (
                                            <label key={option.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition ${selected.includes(option.value) ? 'border-brand-gold bg-brand-gold/10 text-ink' : 'border-line bg-surface-sunken text-ink-muted'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected.includes(option.value)}
                                                    onChange={(event) => setAnswer(question.id, event.target.checked
                                                        ? [...selected, option.value]
                                                        : selected.filter((item) => item !== option.value))}
                                                    className="accent-amber-500"
                                                />
                                                <span>{isAr ? option.labelAr : option.labelEn}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                            {question.type === 'YES_NO' && (
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { value: true, label: isAr ? 'نعم' : 'Yes' },
                                        { value: false, label: isAr ? 'لا' : 'No' },
                                    ].map((option) => (
                                        <label key={String(option.value)} className={`flex min-w-24 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition ${current === option.value ? 'border-brand-gold bg-brand-gold/10 text-ink' : 'border-line bg-surface-sunken text-ink-muted'}`}>
                                            <input type="radio" name={question.id} checked={current === option.value} onChange={() => setAnswer(question.id, option.value)} className="accent-amber-500" />
                                            {option.label}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </fieldset>
                    );
                })}
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => void submit()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-navy px-5 py-2.5 text-sm font-black text-white transition hover:bg-brand-navy-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? <Loader size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    {isAr ? 'إرسال التقييم وإتمام الدورة' : 'Submit evaluation and finish'}
                </button>
            </div>
        </section>
    );
}
