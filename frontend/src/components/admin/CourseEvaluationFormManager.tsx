"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';

type QuestionType = 'RATING' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TEXT' | 'YES_NO';
type Metric = 'COURSE' | 'INSTRUCTOR' | 'GENERAL';
interface OptionRow { value: string; labelAr: string; labelEn: string; }
interface QuestionRow {
    id?: string;
    promptAr: string;
    promptEn: string;
    type: QuestionType;
    metric: Metric;
    isRequired: boolean;
    optionsText: string;
    options: OptionRow[];
}
interface CourseFormRow {
    id: string;
    titleAr: string;
    titleEn: string;
    archivedAt: string | null;
    evaluationForm: {
        id: string;
        titleAr: string;
        titleEn: string;
        descriptionAr: string | null;
        descriptionEn: string | null;
        questions: Array<{
            id: string;
            promptAr: string;
            promptEn: string;
            type: QuestionType;
            metric: Metric;
            isRequired: boolean;
            options: OptionRow[] | null;
        }>;
        _count: { evaluations: number };
    } | null;
}

const typeLabels: Record<QuestionType, { ar: string; en: string }> = {
    RATING: { ar: 'تقييم من 1 إلى 5', en: 'Rating (1–5)' },
    SINGLE_CHOICE: { ar: 'اختيار واحد', en: 'Single choice' },
    MULTIPLE_CHOICE: { ar: 'اختيارات متعددة', en: 'Multiple choice' },
    TEXT: { ar: 'إجابة نصية', en: 'Text answer' },
    YES_NO: { ar: 'نعم أو لا', en: 'Yes / No' },
};

function optionText(options: OptionRow[] | null) {
    return (options ?? []).map((option) => `${option.labelAr} | ${option.labelEn}`).join('\n');
}

export default function CourseEvaluationFormManager() {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [courses, setCourses] = useState<CourseFormRow[]>([]);
    const [courseId, setCourseId] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [formTitleAr, setFormTitleAr] = useState('');
    const [formTitleEn, setFormTitleEn] = useState('');
    const [descriptionAr, setDescriptionAr] = useState('');
    const [descriptionEn, setDescriptionEn] = useState('');
    const [questions, setQuestions] = useState<QuestionRow[]>([]);

    const selectedCourse = useMemo(() => courses.find((course) => course.id === courseId) ?? null, [courses, courseId]);

    const loadCourses = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get('/course-evaluations/admin/forms');
            const rows = response.data as CourseFormRow[];
            setCourses(rows);
            setCourseId((current) => current && rows.some((course) => course.id === current) ? current : rows[0]?.id ?? '');
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر تحميل نماذج التقييم' : 'Could not load evaluation forms'));
        } finally {
            setLoading(false);
        }
    }, [isAr]);

    // Load the course catalog once the component mounts; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void loadCourses(); }, [loadCourses]);

    useEffect(() => {
        if (!selectedCourse) return;
        const form = selectedCourse.evaluationForm;
        // Reset the editor to the selected course's saved form.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFormTitleAr(form?.titleAr ?? '');
        setFormTitleEn(form?.titleEn ?? '');
        setDescriptionAr(form?.descriptionAr ?? '');
        setDescriptionEn(form?.descriptionEn ?? '');
        setQuestions((form?.questions ?? []).map((question) => ({
            ...question,
            optionsText: optionText(question.options),
            options: question.options ?? [],
        })));
    }, [selectedCourse]);

    const updateQuestion = (index: number, patch: Partial<QuestionRow>) => {
        setQuestions((current) => current.map((question, itemIndex) =>
            itemIndex === index ? { ...question, ...patch } : question,
        ));
    };

    const addQuestion = () => setQuestions((current) => [...current, {
        promptAr: '',
        promptEn: '',
        type: 'RATING',
        metric: 'GENERAL',
        isRequired: true,
        optionsText: '',
        options: [],
    }]);

    const moveQuestion = (index: number, offset: number) => {
        const target = index + offset;
        if (target < 0 || target >= questions.length) return;
        setQuestions((current) => {
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const save = async () => {
        if (!selectedCourse || !formTitleAr.trim() || !formTitleEn.trim() || questions.length === 0) {
            toast.error(isAr ? 'أدخل عنوان التقييم وأضف سؤالًا واحدًا على الأقل' : 'Enter a form title and add at least one question');
            return;
        }
        const invalidQuestionIndex = questions.findIndex((question) =>
            !question.promptAr.trim() || !question.promptEn.trim()
            || ((question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE')
                && (question.optionsText.split(/\r?\n/).filter((line) => line.trim()).length < 2
                    || question.optionsText.split(/\r?\n/).filter((line) => line.trim())
                        .some((line) => {
                            const [labelAr, ...labelEn] = line.split('|');
                            return !labelEn.length || !labelAr.trim() || !labelEn.join('|').trim();
                        }))),
        );
        if (invalidQuestionIndex >= 0) {
            toast.error(isAr ? `أكمل نص السؤال وخيارات السؤال رقم ${invalidQuestionIndex + 1}` : `Complete the prompt and options for question ${invalidQuestionIndex + 1}`);
            return;
        }
        setSaving(true);
        try {
            await api.put(`/course-evaluations/admin/courses/${selectedCourse.id}/form`, {
                titleAr: formTitleAr.trim(),
                titleEn: formTitleEn.trim(),
                descriptionAr: descriptionAr.trim() || null,
                descriptionEn: descriptionEn.trim() || null,
                questions: questions.map((question, index) => {
                    const options = question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE'
                        ? question.optionsText.split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter(Boolean)
                            .map((line, optionIndex) => {
                                const [labelAr, ...englishParts] = line.split('|');
                                const existing = question.options[optionIndex];
                                return {
                                    value: existing?.value ?? `option-${index + 1}-${optionIndex + 1}`,
                                    labelAr: labelAr.trim(),
                                    labelEn: englishParts.join('|').trim(),
                                };
                            })
                        : [];
                    return {
                        promptAr: question.promptAr.trim(),
                        promptEn: question.promptEn.trim(),
                        type: question.type,
                        metric: question.type === 'RATING' ? question.metric : 'GENERAL',
                        isRequired: question.isRequired,
                        options,
                    };
                }),
            });
            toast.success(isAr ? 'تم حفظ نموذج التقييم للدورة' : 'Course evaluation form saved');
            await loadCourses();
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر حفظ نموذج التقييم' : 'Could not save evaluation form'));
        } finally {
            setSaving(false);
        }
    };

    if (loading && courses.length === 0) {
        return <div className="flex h-32 items-center justify-center text-gray-400"><Loader className="animate-spin" size={24} /></div>;
    }

    return (
        <section className="space-y-5 rounded-2xl border border-brand-gold/25 bg-white p-4 shadow-sm dark:bg-brand-navy-dark sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-xl font-black text-brand-navy dark:text-white">{isAr ? 'منشئ نماذج تقييم الدورات' : 'Course evaluation form builder'}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500 dark:text-gray-400">
                        {isAr
                            ? 'اختر الدورة وأنشئ نموذج نهاية الدورة الذي يجيب عنه الطالب بعد إكمال الدروس والواجبات والاختبارات. النموذج مطلوب لإتمام الدورة وإتاحة الشهادة.'
                            : 'Choose a course and configure its end-of-course questionnaire. Students complete it after lessons, assignments, and quizzes to finish the course and unlock their certificate.'}
                    </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-700 dark:text-emerald-300">
                    <Check size={13} className="me-1 inline" /> {isAr ? 'مرتبط بالدورة المحددة' : 'Assigned to selected course'}
                </span>
            </header>

            {courses.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10">
                    {isAr ? 'لا توجد دورات لإعداد تقييماتها.' : 'There are no courses to configure.'}
                </p>
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-black text-gray-500 dark:text-gray-400">{isAr ? 'الدورة المستهدفة' : 'Target course'}</span>
                            <select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-brand-navy dark:text-white">
                                {courses.map((course) => (
                                    <option key={course.id} value={course.id}>
                                        {isAr ? course.titleAr : course.titleEn}{course.archivedAt ? (isAr ? ' (مؤرشفة)' : ' (Archived)') : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {selectedCourse?.evaluationForm && (
                            <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                                {selectedCourse.evaluationForm._count.evaluations} {isAr ? 'رد محفوظ' : 'saved responses'}
                            </span>
                        )}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                        <input value={formTitleAr} onChange={(event) => setFormTitleAr(event.target.value)} maxLength={160} placeholder="عنوان التقييم بالعربية" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-white/5 dark:text-white" />
                        <input value={formTitleEn} onChange={(event) => setFormTitleEn(event.target.value)} maxLength={160} placeholder="Evaluation title in English" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-white/5 dark:text-white" />
                        <textarea value={descriptionAr} onChange={(event) => setDescriptionAr(event.target.value)} maxLength={1000} rows={2} placeholder="وصف مختصر للطالب بالعربية (اختياري)" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-white/5 dark:text-white" />
                        <textarea value={descriptionEn} onChange={(event) => setDescriptionEn(event.target.value)} maxLength={1000} rows={2} placeholder="Short student-facing description (optional)" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-white/5 dark:text-white" />
                    </div>

                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="font-black text-brand-navy dark:text-white">{isAr ? `الأسئلة (${questions.length}/40)` : `Questions (${questions.length}/40)`}</h3>
                            <button type="button" disabled={questions.length >= 40} onClick={addQuestion} className="inline-flex items-center gap-1.5 rounded-xl border border-brand-gold/50 px-3 py-2 text-sm font-black text-brand-navy hover:bg-brand-gold/10 disabled:opacity-40 dark:text-white">
                                <Plus size={16} /> {isAr ? 'إضافة سؤال' : 'Add question'}
                            </button>
                        </div>
                        {questions.length === 0 && (
                            <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/10">
                                {isAr ? 'أضف أسئلة التقييم التي سيجيب عنها الطالب.' : 'Add questions for students to answer.'}
                            </p>
                        )}
                        {questions.map((question, index) => (
                            <article key={question.id ?? `new-${index}`} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-white/10 dark:bg-white/[0.03] sm:p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-black uppercase tracking-wide text-gray-400">{isAr ? `السؤال ${index + 1}` : `Question ${index + 1}`}</span>
                                    <div className="flex items-center gap-1">
                                        <button type="button" disabled={index === 0} onClick={() => moveQuestion(index, -1)} aria-label={isAr ? 'رفع السؤال' : 'Move question up'} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-white/10"><ChevronUp size={16} /></button>
                                        <button type="button" disabled={index === questions.length - 1} onClick={() => moveQuestion(index, 1)} aria-label={isAr ? 'خفض السؤال' : 'Move question down'} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-white/10"><ChevronDown size={16} /></button>
                                        <button type="button" onClick={() => setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={isAr ? 'حذف السؤال' : 'Delete question'} className="rounded-lg p-1.5 text-red-600 hover:bg-red-500/10"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                                <div className="grid gap-2 lg:grid-cols-2">
                                    <input value={question.promptAr} onChange={(event) => updateQuestion(index, { promptAr: event.target.value })} maxLength={500} placeholder="نص السؤال بالعربية" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-brand-navy dark:text-white" />
                                    <input value={question.promptEn} onChange={(event) => updateQuestion(index, { promptEn: event.target.value })} maxLength={500} placeholder="Question text in English" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-brand-navy dark:text-white" />
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto]">
                                    <select value={question.type} onChange={(event) => updateQuestion(index, {
                                        type: event.target.value as QuestionType,
                                        options: [],
                                        optionsText: '',
                                        metric: 'GENERAL',
                                    })} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-brand-navy dark:border-white/10 dark:bg-brand-navy dark:text-white">
                                        {Object.entries(typeLabels).map(([type, label]) => <option key={type} value={type}>{isAr ? label.ar : label.en}</option>)}
                                    </select>
                                    {question.type === 'RATING' ? (
                                        <select value={question.metric} onChange={(event) => updateQuestion(index, { metric: event.target.value as Metric })} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-brand-navy dark:border-white/10 dark:bg-brand-navy dark:text-white">
                                            <option value="GENERAL">{isAr ? 'تقييم عام' : 'General rating'}</option>
                                            <option value="COURSE">{isAr ? 'تقييم الدورة' : 'Course rating metric'}</option>
                                            <option value="INSTRUCTOR">{isAr ? 'تقييم المدرّب' : 'Instructor rating metric'}</option>
                                        </select>
                                    ) : <span className="hidden lg:block" />}
                                    <label className="inline-flex items-center gap-2 rounded-lg px-2 text-sm font-bold text-gray-600 dark:text-gray-300">
                                        <input type="checkbox" checked={question.isRequired} onChange={(event) => updateQuestion(index, { isRequired: event.target.checked })} className="accent-amber-500" />
                                        {isAr ? 'سؤال مطلوب' : 'Required question'}
                                    </label>
                                </div>
                                {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') && (
                                    <label className="block">
                                        <span className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">{isAr ? 'خيار واحد بكل سطر، واكتب العربية | English' : 'One option per line, format: Arabic | English'}</span>
                                        <textarea value={question.optionsText} onChange={(event) => updateQuestion(index, { optionsText: event.target.value })} rows={4} placeholder={'ممتاز | Excellent\nجيد | Good\nيحتاج إلى تحسين | Needs improvement'} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-gold dark:border-white/10 dark:bg-brand-navy dark:text-white" />
                                    </label>
                                )}
                            </article>
                        ))}
                    </div>

                    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/10">
                        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                            {isAr ? 'الردود السابقة تحتفظ بنسخة من نص السؤال وخياراته عند الإرسال حتى لو عدّلت النموذج لاحقًا.' : 'Previously submitted responses keep a snapshot of their question text and options when the form is edited.'}
                        </p>
                        <button type="button" disabled={saving || questions.length === 0} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-5 py-2.5 text-sm font-black text-brand-navy transition hover:brightness-95 disabled:opacity-50">
                            {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                            {isAr ? 'حفظ نموذج الدورة' : 'Save course form'}
                        </button>
                    </footer>
                </>
            )}
        </section>
    );
}
