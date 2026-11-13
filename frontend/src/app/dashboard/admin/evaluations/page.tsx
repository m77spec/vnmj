"use client";

import { useEffect, useState } from 'react';
import { MessageSquareText, RefreshCw, Star, Users } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { PageHeader, StatCard } from '../components';
import CourseEvaluationFormManager from '@/components/admin/CourseEvaluationFormManager';

interface EvaluationOption {
    value: string;
    labelAr: string;
    labelEn: string;
}

interface EvaluationAnswer {
    questionId: string;
    promptAr: string;
    promptEn: string;
    type: 'RATING' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TEXT' | 'YES_NO';
    value: number | string | boolean | string[];
    options?: EvaluationOption[];
}

interface EvaluationOpening {
    id: string;
    nameAr?: string | null;
    nameEn?: string | null;
    status: string;
    course: { id: string; titleAr: string; titleEn: string };
    instructor: { id: string; email: string };
    responseCount: number;
    approvedStudentCount: number;
    averageCourseRating: number;
    averageInstructorRating: number;
}

interface EvaluationRow {
    id: string;
    courseRating: number | null;
    instructorRating: number | null;
    answers?: EvaluationAnswer[] | null;
    commentAr?: string | null;
    commentEn?: string | null;
    createdAt: string;
    enrollment: {
        student: {
            id: string;
            email: string;
            metadata?: Record<string, unknown> | null;
        };
    };
}

interface OpeningDetails {
    opening: EvaluationOpening;
    responseCount: number;
    approvedStudentCount: number;
    averageCourseRating: number;
    averageInstructorRating: number;
    evaluations: EvaluationRow[];
}

function studentName(metadata?: Record<string, unknown> | null) {
    if (!metadata) return null;
    for (const key of ['nameAr', 'nameEn', 'fullName']) {
        const value = metadata[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

export default function CourseEvaluationsPage() {
    const { locale, pick } = useI18n();
    const isAr = locale === 'ar';
    const [openings, setOpenings] = useState<EvaluationOpening[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [details, setDetails] = useState<OpeningDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [detailsReadyFor, setDetailsReadyFor] = useState<string | null>(null);
    const [detailsErrorFor, setDetailsErrorFor] = useState<string | null>(null);
    const [detailsRetry, setDetailsRetry] = useState(0);

    const loadOpenings = async () => {
        try {
            const response = await api.get('/course-evaluations/admin/openings');
            const rows = response.data as EvaluationOpening[];
            setOpenings(rows);
            setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر تحميل التقييمات' : 'Could not load evaluations'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        api.get('/course-evaluations/admin/openings')
            .then((response) => {
                if (!active) return;
                const rows = response.data as EvaluationOpening[];
                setOpenings(rows);
                setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
            })
            .catch((error) => {
                if (active) toast.error(getErrorMessage(error) || (isAr ? 'تعذر تحميل التقييمات' : 'Could not load evaluations'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
        // Only load the current language on mount; request data is language-neutral.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedId) return;
        let active = true;
        api.get(`/course-evaluations/admin/openings/${selectedId}`)
            .then((response) => {
                if (active) {
                    setDetails(response.data as OpeningDetails);
                    setDetailsReadyFor(selectedId);
                    setDetailsErrorFor(null);
                }
            })
            .catch((error) => {
                if (active) {
                    setDetailsErrorFor(selectedId);
                    toast.error(getErrorMessage(error) || (isAr ? 'تعذر تحميل تفاصيل التقييم' : 'Could not load evaluation details'));
                }
            });
        return () => { active = false; };
    }, [selectedId, detailsRetry, isAr]);

    const summary = openings.find((opening) => opening.id === selectedId);
    const visibleDetails = details?.opening.id === selectedId ? details : null;
    const detailsLoading = Boolean(selectedId && detailsReadyFor !== selectedId && detailsErrorFor !== selectedId);
    const completionRate = visibleDetails?.approvedStudentCount
        ? Math.round((visibleDetails.responseCount / visibleDetails.approvedStudentCount) * 100)
        : 0;
    const questionGroups = new Map<string, { question: EvaluationAnswer; answers: EvaluationAnswer[] }>();
    for (const evaluation of visibleDetails?.evaluations ?? []) {
        for (const answer of evaluation.answers ?? []) {
            const group = questionGroups.get(answer.questionId) ?? { question: answer, answers: [] };
            group.answers.push(answer);
            questionGroups.set(answer.questionId, group);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <PageHeader
                    title={isAr ? 'تقييمات نهاية الدورات' : 'End-of-course evaluations'}
                    subtitle={isAr
                        ? 'نتائج سرية لا تظهر إلا للمدير ومدير الدورات.'
                        : 'Confidential feedback visible only to administrators and course managers.'}
                />
                <button
                    type="button"
                    onClick={() => { setLoading(true); void loadOpenings(); }}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
                >
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    {isAr ? 'تحديث' : 'Refresh'}
                </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                <StatCard icon={Users} color="blue" value={openings.length} label={isAr ? 'دفعات لديها تقييمات' : 'Batches with feedback'} />
                <StatCard icon={MessageSquareText} color="green" value={openings.reduce((sum, item) => sum + item.responseCount, 0)} label={isAr ? 'إجمالي الردود' : 'Total responses'} />
                <StatCard icon={Star} color="amber" value={summary ? `${summary.averageCourseRating.toFixed(1)} / 5` : '—'} label={isAr ? 'متوسط تقييم الدورة' : 'Selected course rating'} />
            </div>

            <CourseEvaluationFormManager />

            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                <div className="border-b border-gray-100 p-4 dark:border-white/5">
                    <h2 className="font-black text-brand-navy dark:text-white">
                        {isAr ? 'اختر دفعة لمراجعة نتائجها' : 'Choose a batch to review its results'}
                    </h2>
                </div>
                {loading ? (
                    <p className="p-8 text-center text-sm font-bold text-gray-400">{isAr ? 'جارٍ التحميل...' : 'Loading...'}</p>
                ) : openings.length === 0 ? (
                    <p className="p-8 text-center text-sm font-bold text-gray-400">
                        {isAr ? 'لا توجد تقييمات مرسلة حتى الآن.' : 'No evaluations have been submitted yet.'}
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-2 p-4">
                        {openings.map((opening) => (
                            <button
                                key={opening.id}
                                type="button"
                                onClick={() => setSelectedId(opening.id)}
                                className={`rounded-xl border px-4 py-3 text-start transition ${
                                    opening.id === selectedId
                                        ? 'border-brand-gold bg-brand-gold/10'
                                        : 'border-gray-200 hover:border-brand-gold/50 dark:border-white/10'
                                }`}
                            >
                                <span className="block font-black text-brand-navy dark:text-white">{pick(opening.course, 'title')}</span>
                                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                                    {pick(opening, 'name') || (isAr ? 'الدفعة' : 'Opening')} · {opening.responseCount}/{opening.approvedStudentCount}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            {detailsLoading ? (
                <p className="p-8 text-center text-sm font-bold text-gray-400">{isAr ? 'جارٍ تحميل النتائج...' : 'Loading results...'}</p>
            ) : detailsErrorFor === selectedId ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                    <p className="font-bold">{isAr ? 'تعذر تحميل نتائج هذه الدفعة.' : 'Could not load this batch’s results.'}</p>
                    <button
                        type="button"
                        onClick={() => { setDetailsErrorFor(null); setDetailsRetry((value) => value + 1); }}
                        className="mt-3 rounded-lg border border-current px-3 py-1.5 font-bold"
                    >
                        {isAr ? 'إعادة المحاولة' : 'Try again'}
                    </button>
                </div>
            ) : visibleDetails && (
                <>
                    <section className="grid gap-4 sm:grid-cols-3">
                        <StatCard icon={Star} color="purple" value={`${visibleDetails.averageCourseRating.toFixed(1)} / 5`} label={isAr ? 'متوسط تقييم الدورة' : 'Course rating average'} />
                        <StatCard icon={Star} color="amber" value={`${visibleDetails.averageInstructorRating.toFixed(1)} / 5`} label={isAr ? 'متوسط تقييم المدرّب' : 'Instructor rating average'} />
                        <StatCard icon={Users} color="green" value={`${visibleDetails.responseCount}/${visibleDetails.approvedStudentCount} · ${completionRate}%`} label={isAr ? 'الطلاب الذين أرسلوا التقييم' : 'Students who submitted'} />
                    </section>

                    {questionGroups.size > 0 && (
                        <section className="space-y-4">
                            <div>
                                <h2 className="text-lg font-black text-brand-navy dark:text-white">{isAr ? 'تحليل إجابات الأسئلة' : 'Question response analytics'}</h2>
                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{isAr ? 'ملخص الردود المسجلة لهذه الدورة والدفعة.' : 'Summary of submitted answers for this course batch.'}</p>
                            </div>
                            <div className="grid gap-4 xl:grid-cols-2">
                                {[...questionGroups.values()].map(({ question, answers }) => {
                                    const prompt = isAr ? question.promptAr : question.promptEn;
                                    if (question.type === 'RATING') {
                                        const values = answers.map(({ value }) => value).filter((value): value is number => typeof value === 'number');
                                        const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
                                        return (
                                            <article key={question.questionId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                                                <h3 className="font-black text-brand-navy dark:text-white">{prompt}</h3>
                                                <p className="mt-2 text-2xl font-black text-amber-600">{average.toFixed(1)} <span className="text-sm font-bold text-gray-400">/ 5</span></p>
                                                <div className="mt-3 space-y-1.5">
                                                    {[5, 4, 3, 2, 1].map((rating) => {
                                                        const count = values.filter((value) => value === rating).length;
                                                        const percent = values.length ? (count / values.length) * 100 : 0;
                                                        return (
                                                            <div key={rating} className="flex items-center gap-2 text-xs">
                                                                <span className="w-8 text-gray-500">{rating} ★</span>
                                                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"><div className="h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} /></div>
                                                                <span className="w-8 text-end text-gray-500">{count}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </article>
                                        );
                                    }
                                    if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'YES_NO') {
                                        const options = question.type === 'YES_NO'
                                            ? [
                                                { value: 'true', labelAr: 'نعم', labelEn: 'Yes' },
                                                { value: 'false', labelAr: 'لا', labelEn: 'No' },
                                            ]
                                            : question.options ?? [];
                                        const totalAnswers = answers.reduce((sum, item) => sum + (Array.isArray(item.value) ? item.value.length : 1), 0);
                                        return (
                                            <article key={question.questionId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                                                <h3 className="font-black text-brand-navy dark:text-white">{prompt}</h3>
                                                <p className="mb-3 mt-1 text-xs text-gray-400">{answers.length} {isAr ? 'رد' : 'responses'}</p>
                                                <div className="space-y-2">
                                                    {options.map((option) => {
                                                        const count = answers.reduce((sum, item) => {
                                                            const selected = Array.isArray(item.value) ? item.value : [item.value];
                                                            return sum + selected.filter((value) => String(value) === option.value).length;
                                                        }, 0);
                                                        const percent = totalAnswers ? (count / totalAnswers) * 100 : 0;
                                                        return (
                                                            <div key={option.value}>
                                                                <div className="mb-1 flex justify-between gap-2 text-xs">
                                                                    <span className="font-bold text-gray-600 dark:text-gray-300">{isAr ? option.labelAr : option.labelEn}</span>
                                                                    <span className="text-gray-400">{count} · {Math.round(percent)}%</span>
                                                                </div>
                                                                <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"><div className="h-full rounded-full bg-brand-gold" style={{ width: `${percent}%` }} /></div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </article>
                                        );
                                    }
                                    return (
                                        <article key={question.questionId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                                            <h3 className="font-black text-brand-navy dark:text-white">{prompt}</h3>
                                            <p className="mb-3 mt-1 text-xs text-gray-400">{answers.length} {isAr ? 'إجابة نصية' : 'text responses'}</p>
                                            <div className="max-h-60 space-y-2 overflow-auto">
                                                {answers.map((answer, index) => (
                                                    <p key={`${answer.questionId}-${index}`} className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-700 dark:bg-white/[0.04] dark:text-gray-300">{String(answer.value)}</p>
                                                ))}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/5 dark:bg-brand-navy-dark">
                        <div className="border-b border-gray-100 p-4 dark:border-white/5">
                            <h2 className="font-black text-brand-navy dark:text-white">{isAr ? 'التقييمات الفردية' : 'Individual evaluations'}</h2>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {pick(visibleDetails.opening.course, 'title')} · {visibleDetails.opening.instructor.email}
                            </p>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-white/5">
                            {visibleDetails.evaluations.map((evaluation) => {
                                const name = studentName(evaluation.enrollment.student.metadata);
                                const comment = isAr
                                    ? evaluation.commentAr || evaluation.commentEn
                                    : evaluation.commentEn || evaluation.commentAr;
                                const answers = evaluation.answers ?? [];
                                return (
                                    <article key={evaluation.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(180px,0.7fr)_minmax(0,2fr)] lg:items-start">
                                        <div className="min-w-0">
                                            <p className="break-words font-bold text-brand-navy dark:text-white">{name || evaluation.enrollment.student.email}</p>
                                            {name && <p className="mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">{evaluation.enrollment.student.email}</p>}
                                            <time className="mt-1 block text-xs text-gray-400" dateTime={evaluation.createdAt}>
                                                {new Date(evaluation.createdAt).toLocaleDateString(isAr ? 'ar' : 'en')}
                                            </time>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {answers.map((answer) => (
                                                <div key={answer.questionId} className="min-w-0 rounded-xl bg-gray-50 p-3 dark:bg-white/[0.04]">
                                                    <p className="mb-1 text-xs font-black text-gray-500 dark:text-gray-400">{isAr ? answer.promptAr : answer.promptEn}</p>
                                                    <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6 text-brand-navy dark:text-white">
                                                        {renderEvaluationAnswer(answer, isAr)}
                                                    </p>
                                                    {answer.type === 'RATING' && typeof answer.value === 'number' && (
                                                        <div className="mt-1 flex text-amber-500" aria-label={`${answer.value} / 5`}>
                                                            {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={13} fill={star <= Number(answer.value) ? 'currentColor' : 'none'} />)}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {answers.length === 0 && (
                                                <>
                                                    <Rating label={isAr ? 'الدورة' : 'Course'} value={evaluation.courseRating ?? 0} />
                                                    <Rating label={isAr ? 'المدرّب' : 'Instructor'} value={evaluation.instructorRating ?? 0} />
                                                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-600 dark:text-gray-300">
                                                        {comment || (isAr ? 'لا توجد ملاحظات مكتوبة.' : 'No written comment.')}
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}

function Rating({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <p className="mb-1 text-xs font-bold text-gray-500 dark:text-gray-400">{label}: {value}/5</p>
            <div className="flex text-amber-500" aria-label={`${value} / 5`}>
                {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={14} fill={star <= value ? 'currentColor' : 'none'} />)}
            </div>
        </div>
    );
}

function renderEvaluationAnswer(answer: EvaluationAnswer, isAr: boolean) {
    if (answer.type === 'YES_NO' && typeof answer.value === 'boolean') {
        return isAr ? (answer.value ? 'نعم' : 'لا') : (answer.value ? 'Yes' : 'No');
    }
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];
    if (answer.type === 'SINGLE_CHOICE' || answer.type === 'MULTIPLE_CHOICE') {
        return values.map((value) => {
            const option = answer.options?.find((item) => item.value === value);
            return option ? (isAr ? option.labelAr : option.labelEn) : String(value);
        }).join(isAr ? '، ' : ', ');
    }
    return values.map(String).join(', ');
}
