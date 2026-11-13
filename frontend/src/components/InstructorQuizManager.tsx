"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { BookOpenCheck, Check, CircleHelp, FilePlus2, Loader, Pencil, Plus, RotateCcw, Save, Trash2, Users, X } from 'lucide-react';

type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
type InputLanguage = 'ARABIC' | 'ENGLISH' | 'BOTH';

interface QuizOption {
    textAr: string;
    textEn: string;
    isCorrect: boolean;
}

interface QuizQuestion {
    id?: string;
    type: QuestionType;
    textAr: string;
    textEn: string;
    explanationAr: string;
    explanationEn: string;
    options: QuizOption[];
    correctIndex?: number;
}

interface CourseQuiz {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    moduleId?: string | null;
    isFinal?: boolean;
    isPublished: boolean;
    passScore: number;
    maxAttempts: number | null;
    gateNextLessons: boolean;
    questions: QuizQuestion[];
}

interface QuizStudentAttempts {
    enrollmentId: string;
    student: { id: string; email: string; metadata?: Record<string, unknown> | null };
    attempts: Array<{ id: string; score: number; passed: boolean; submittedAt: string }>;
    extraAttempts: number;
    attemptsAllowed: number | null;
}

interface Lesson {
    id: string;
    titleAr?: string | null;
    titleEn?: string | null;
    chapterOrderIndex?: number | null;
    orderIndex?: number | null;
    createdAt?: string;
}

interface Props {
    openingId: string;
    courseId: string;
    lessons: Lesson[];
    administrative?: boolean;
}

const makeQuestion = (): QuizQuestion => ({
    type: 'SINGLE_CHOICE',
    textAr: '',
    textEn: '',
    explanationAr: '',
    explanationEn: '',
    options: [
        { textAr: '', textEn: '', isCorrect: true },
        { textAr: '', textEn: '', isCorrect: false },
        { textAr: '', textEn: '', isCorrect: false },
        { textAr: '', textEn: '', isCorrect: false },
    ],
    correctIndex: 0,
});

export default function InstructorQuizManager({ openingId, courseId, lessons, administrative = false }: Props) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [inputLanguage, setInputLanguage] = useState<InputLanguage>(locale === 'ar' ? 'ARABIC' : 'ENGLISH');
    const showArabic = inputLanguage !== 'ENGLISH';
    const showEnglish = inputLanguage !== 'ARABIC';
    const openingEndpoint = administrative ? '/quizzes/admin/manage/opening' : '/quizzes/manage/opening';
    const [quizzes, setQuizzes] = useState<CourseQuiz[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<CourseQuiz | null>(null);
    const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
    const [attemptsByQuiz, setAttemptsByQuiz] = useState<Record<string, QuizStudentAttempts[]>>({});
    const [openAttemptsQuizId, setOpenAttemptsQuizId] = useState<string | null>(null);
    const [attemptsLoadingQuizId, setAttemptsLoadingQuizId] = useState<string | null>(null);
    const [attemptActionKey, setAttemptActionKey] = useState<string | null>(null);
    const orderedLessons = useMemo(() => {
        const unique = new Map<string, Lesson>();
        lessons.forEach((lesson) => unique.set(lesson.id, lesson));
        return [...unique.values()].sort((left, right) =>
            (left.chapterOrderIndex ?? 0) - (right.chapterOrderIndex ?? 0)
            || (left.orderIndex ?? 0) - (right.orderIndex ?? 0)
            || (left.createdAt || '').localeCompare(right.createdAt || '')
            || (left.titleAr || left.titleEn || '').localeCompare(right.titleAr || right.titleEn || '')
            || left.id.localeCompare(right.id),
        );
    }, [lessons]);
    const lessonNames = useMemo(() => new Map(orderedLessons.map((lesson, index) => [
        lesson.id,
        `${index + 1}. ${(isAr ? lesson.titleAr : lesson.titleEn) || lesson.titleAr || lesson.titleEn || (isAr ? 'درس' : 'Lesson')}`,
    ])), [isAr, orderedLessons]);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get(`${openingEndpoint}/${openingId}`);
            setQuizzes(response.data);
        } catch (error) {
            setNotice({ text: getErrorMessage(error) || (isAr ? 'تعذر تحميل الاختبارات.' : 'Could not load quizzes.'), error: true });
        } finally {
            setLoading(false);
        }
    }, [openingEndpoint, openingId, isAr]);

    useEffect(() => {
        let active = true;
        const loadQuizzes = async () => {
            try {
                const response = await api.get(`${openingEndpoint}/${openingId}`);
                if (active) setQuizzes(response.data);
            } catch (error) {
                if (active) setNotice({ text: getErrorMessage(error) || (isAr ? 'تعذر تحميل الاختبارات.' : 'Could not load quizzes.'), error: true });
            } finally {
                if (active) setLoading(false);
            }
        };
        void loadQuizzes();
        return () => { active = false; };
    }, [openingEndpoint, openingId, isAr]);

    const startNew = () => {
        setEditingId(null);
        setInputLanguage(isAr ? 'ARABIC' : 'ENGLISH');
        setDraft({
            id: '',
            titleAr: '',
            titleEn: '',
            descriptionAr: '',
            descriptionEn: '',
            moduleId: orderedLessons[0]?.id ?? '',
            isFinal: false,
            isPublished: false,
            passScore: 60,
            maxAttempts: 1,
            gateNextLessons: false,
            questions: [makeQuestion()],
        });
        setNotice(null);
    };

    const startEdit = (quiz: CourseQuiz) => {
        setEditingId(quiz.id);
        setInputLanguage('BOTH');
        setDraft({
            ...quiz,
            maxAttempts: quiz.maxAttempts ?? null,
            gateNextLessons: !!quiz.gateNextLessons,
            questions: quiz.questions.map((question) => {
                const options = (question.options as unknown[]).map((rawOption, index) => {
                    if (typeof rawOption === 'string') {
                        return { textAr: rawOption, textEn: rawOption, isCorrect: question.correctIndex === index };
                    }
                    const option = rawOption as QuizOption;
                    return { ...option, isCorrect: !!option.isCorrect || question.correctIndex === index };
                });
                return {
                    ...question,
                    type: question.type || 'SINGLE_CHOICE',
                    explanationAr: question.explanationAr || '',
                    explanationEn: question.explanationEn || '',
                    options,
                };
            }),
        });
        setNotice(null);
    };

    const setQuestion = (index: number, patch: Partial<QuizQuestion>) => {
        setDraft((current) => current && ({
            ...current,
            questions: current.questions.map((question, i) => i === index ? { ...question, ...patch } : question),
        }));
    };

    const setOption = (questionIndex: number, optionIndex: number, patch: Partial<QuizOption>) => {
        setDraft((current) => current && ({
            ...current,
            questions: current.questions.map((question, i) => i === questionIndex
                ? { ...question, options: question.options.map((option, j) => j === optionIndex ? { ...option, ...patch } : option) }
                : question),
        }));
    };

    const changeQuestionType = (index: number, type: QuestionType) => {
        const question = draft?.questions[index];
        if (!question) return;
        let options = type === 'TRUE_FALSE'
            ? [
                { textAr: 'صح', textEn: 'True', isCorrect: true },
                { textAr: 'خطأ', textEn: 'False', isCorrect: false },
            ]
            : question.options.length >= 2
                ? question.options
                : [...question.options, { textAr: '', textEn: '', isCorrect: false }];
        if (type !== 'MULTIPLE_CHOICE' && type !== 'TRUE_FALSE') {
            const correct = options.findIndex((option) => option.isCorrect);
            options = options.map((option, optionIndex) => ({ ...option, isCorrect: optionIndex === (correct < 0 ? 0 : correct) }));
        }
        setQuestion(index, { type, options, correctIndex: question.correctIndex ?? 0 });
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!draft) return;
        if (!draft.isFinal && (!draft.moduleId || !orderedLessons.some((lesson) => lesson.id === draft.moduleId))) {
            setNotice({ text: isAr ? 'اختر الدرس المرتبط بالاختبار.' : 'Select the lesson for this quiz.', error: true });
            return;
        }
        const hasRequiredText = (arabic: string | null | undefined, english: string | null | undefined) =>
            (!showArabic || !!arabic?.trim()) && (!showEnglish || !!english?.trim());
        if (draft.questions.length === 0 || draft.questions.some((question) =>
            !hasRequiredText(question.textAr, question.textEn) ||
            question.options.length < 2 ||
            question.options.some((option) => !hasRequiredText(option.textAr, option.textEn)) ||
            !question.options.some((option) => option.isCorrect),
        )) {
            setNotice({ text: isAr ? 'أكمل نص كل سؤال وخياراته وحدد إجابة صحيحة واحدة على الأقل.' : 'Complete each question and its options, and select at least one correct answer.', error: true });
            return;
        }

        const localizedFields = (arabic: string | null | undefined, english: string | null | undefined) => {
            if (inputLanguage === 'ARABIC') return { textAr: arabic?.trim() || '', textEn: arabic?.trim() || '' };
            if (inputLanguage === 'ENGLISH') return { textAr: english?.trim() || '', textEn: english?.trim() || '' };
            return { textAr: arabic?.trim() || '', textEn: english?.trim() || '' };
        };
        const title = localizedFields(draft.titleAr, draft.titleEn);
        const description = localizedFields(draft.descriptionAr, draft.descriptionEn);
        const payload = {
            courseId,
            titleAr: title.textAr,
            titleEn: title.textEn,
            descriptionAr: description.textAr || null,
            descriptionEn: description.textEn || null,
            moduleId: draft.isFinal ? null : draft.moduleId,
            isFinal: !!draft.isFinal,
            isPublished: !!draft.isPublished,
            passScore: Math.min(100, Math.max(1, Number(draft.passScore) || 60)),
            maxAttempts: draft.maxAttempts === null ? null : Math.min(100, Math.max(1, Number(draft.maxAttempts) || 1)),
            gateNextLessons: !draft.isFinal && !!draft.gateNextLessons,
            questions: draft.questions.map((question, orderIndex) => ({
                type: question.type,
                ...localizedFields(question.textAr, question.textEn),
                explanationAr: localizedFields(question.explanationAr, question.explanationEn).textAr || null,
                explanationEn: localizedFields(question.explanationAr, question.explanationEn).textEn || null,
                options: question.options.map((option) => ({
                    ...localizedFields(option.textAr, option.textEn),
                    isCorrect: option.isCorrect,
                })),
                correctIndex: question.type === 'SINGLE_CHOICE'
                    ? question.options.findIndex((option) => option.isCorrect)
                    : null,
                orderIndex,
            })),
        };
        if (!payload.titleAr || !payload.titleEn) {
            setNotice({ text: isAr ? 'أدخل عنوان الاختبار باللغة المحددة.' : 'Enter the quiz title in the selected language.', error: true });
            return;
        }

        setSaving(true);
        setNotice(null);
        try {
            if (editingId) await api.patch(`${openingEndpoint}/${openingId}/${editingId}`, payload);
            else await api.post(`${openingEndpoint}/${openingId}`, payload);
            setDraft(null);
            setEditingId(null);
            setNotice({ text: isAr ? 'تم حفظ الاختبار بنجاح.' : 'Quiz saved successfully.', error: false });
            await refresh();
        } catch (error) {
            setNotice({ text: getErrorMessage(error) || (isAr ? 'تعذر حفظ الاختبار.' : 'Could not save the quiz.'), error: true });
        } finally {
            setSaving(false);
        }
    };

    const removeQuiz = async (quiz: CourseQuiz) => {
        if (!confirm(isAr ? `هل تريد حذف «${quiz.titleAr}»؟` : `Delete "${quiz.titleEn}"?`)) return;
        try {
            await api.delete(`${openingEndpoint}/${openingId}/${quiz.id}`);
            setNotice({ text: isAr ? 'تم حذف الاختبار.' : 'Quiz deleted.', error: false });
            await refresh();
        } catch (error) {
            setNotice({ text: getErrorMessage(error) || (isAr ? 'تعذر حذف الاختبار.' : 'Could not delete the quiz.'), error: true });
        }
    };

    const loadAttempts = async (quiz: CourseQuiz) => {
        setOpenAttemptsQuizId(quiz.id);
        setAttemptsLoadingQuizId(quiz.id);
        try {
            const response = await api.get(`${openingEndpoint}/${openingId}/${quiz.id}/attempts`);
            setAttemptsByQuiz((current) => ({ ...current, [quiz.id]: response.data }));
        } catch (error) {
            setNotice({ text: getErrorMessage(error) || text('تعذر تحميل نتائج الاختبار.', 'Could not load quiz results.'), error: true });
        } finally {
            setAttemptsLoadingQuizId(null);
        }
    };

    const manageStudentAttempts = async (quiz: CourseQuiz, student: QuizStudentAttempts, action: 'grant' | 'reset') => {
        if (action === 'reset' && !confirm(text(
            'سيتم حذف سجل محاولات الطالب لهذا الاختبار وإتاحة البدء من جديد. هل تريد المتابعة؟',
            'This deletes the student’s attempt history for this quiz and allows a fresh start. Continue?',
        ))) return;
        const key = `${quiz.id}:${student.enrollmentId}`;
        setAttemptActionKey(key);
        try {
            const endpoint = `${openingEndpoint}/${openingId}/${quiz.id}/attempts/${student.enrollmentId}`;
            if (action === 'grant') await api.post(`${endpoint}/grant`);
            else await api.delete(endpoint);
            setNotice({ text: action === 'grant'
                ? text('تم منح الطالب محاولة إضافية.', 'An extra attempt was granted.')
                : text('تم تصفير محاولات الطالب.', 'The student’s attempts were reset.'), error: false });
            await loadAttempts(quiz);
        } catch (error) {
            setNotice({ text: getErrorMessage(error) || text('تعذر تعديل محاولات الطالب.', 'Could not update the student’s attempts.'), error: true });
        } finally {
            setAttemptActionKey(null);
        }
    };

    const studentName = (student: QuizStudentAttempts['student']) => {
        const metadata = student.metadata || {};
        for (const key of ['nameAr', 'nameEn', 'fullName']) {
            const value = metadata[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return student.email;
    };

    const text = (ar: string, en: string) => isAr ? ar : en;
    const inputClass = 'w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-gold/60 placeholder:text-gray-500';
    const languageInput = (language: 'ARABIC' | 'ENGLISH') => language === 'ARABIC'
        ? { dir: 'rtl' as const, lang: 'ar' }
        : { dir: 'ltr' as const, lang: 'en' };

    return (
        <section className="space-y-5">
            <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-brand-navy-dark p-5 sm:p-6">
                <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gold/10 text-brand-gold-light">
                        <BookOpenCheck size={22} />
                    </span>
                    <div>
                        <h3 className="text-lg font-black text-white">{text('إدارة الاختبارات', 'Quiz management')}</h3>
                        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-400">
                            {text('أنشئ اختبارات مرتبطة بأي درس أو اختبارًا نهائيًا للدورة. تظهر الاختبارات المنشورة للطلاب فقط.', 'Create quizzes for any lesson or a final exam for the course. Only published quizzes are visible to students.')}
                        </p>
                    </div>
                </div>
                <button onClick={startNew} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110">
                    <Plus size={17} /> {text('إنشاء اختبار', 'Create quiz')}
                </button>
            </header>

            {notice && (
                <p role="status" className={`rounded-xl border px-4 py-3 text-sm font-semibold ${notice.error ? 'border-red-400/20 bg-red-500/10 text-red-300' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'}`}>
                    {notice.text}
                </p>
            )}

            {draft && (
                <form onSubmit={save} className="space-y-5 rounded-2xl border border-brand-gold/20 bg-brand-navy-dark p-4 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                        <h4 className="text-base font-black text-white">{editingId ? text('تعديل الاختبار', 'Edit quiz') : text('اختبار جديد', 'New quiz')}</h4>
                        <button type="button" onClick={() => setDraft(null)} aria-label={text('إغلاق', 'Close')} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"><X size={18} /></button>
                    </div>

                    <label className="block max-w-sm space-y-1.5 text-xs font-bold text-gray-300">
                        {text('لغة إدخال الاختبار', 'Quiz input language')}
                        <select
                            className={inputClass}
                            value={inputLanguage}
                            onChange={(event) => setInputLanguage(event.target.value as InputLanguage)}
                        >
                            <option value="ARABIC">{text('العربية فقط', 'Arabic only')}</option>
                            <option value="ENGLISH">{text('الإنجليزية فقط', 'English only')}</option>
                            <option value="BOTH">{text('العربية والإنجليزية', 'Arabic and English')}</option>
                        </select>
                    </label>

                    <div className={`grid gap-3 ${inputLanguage === 'BOTH' ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                        {showArabic && (
                            <>
                                <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('العنوان بالعربية', 'Title in Arabic')}
                                    <input {...languageInput('ARABIC')} className={inputClass} value={draft.titleAr} onChange={(event) => setDraft({ ...draft, titleAr: event.target.value })} required />
                                </label>
                                <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('الوصف بالعربية', 'Description in Arabic')}
                                    <textarea {...languageInput('ARABIC')} className={inputClass} rows={2} value={draft.descriptionAr || ''} onChange={(event) => setDraft({ ...draft, descriptionAr: event.target.value })} />
                                </label>
                            </>
                        )}
                        {showEnglish && (
                            <>
                                <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('العنوان بالإنجليزية', 'Title in English')}
                                    <input {...languageInput('ENGLISH')} className={inputClass} value={draft.titleEn} onChange={(event) => setDraft({ ...draft, titleEn: event.target.value })} required />
                                </label>
                                <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('الوصف بالإنجليزية', 'Description in English')}
                                    <textarea {...languageInput('ENGLISH')} className={inputClass} rows={2} value={draft.descriptionEn || ''} onChange={(event) => setDraft({ ...draft, descriptionEn: event.target.value })} />
                                </label>
                            </>
                        )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('نوع الاختبار', 'Quiz type')}
                            <select className={inputClass} value={draft.isFinal ? 'final' : 'lesson'} onChange={(event) => setDraft({ ...draft, isFinal: event.target.value === 'final', moduleId: event.target.value === 'final' ? '' : (draft.moduleId || orderedLessons[0]?.id || '') })}>
                                <option value="lesson">{text('اختبار درس', 'Lesson quiz')}</option>
                                <option value="final">{text('اختبار نهائي للدورة', 'Course final exam')}</option>
                            </select>
                        </label>
                        {!draft.isFinal && (
                            <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('الدرس', 'Lesson')}
                                <select className={inputClass} value={draft.moduleId || ''} onChange={(event) => setDraft({ ...draft, moduleId: event.target.value })} required>
                                    <option value="">{text('اختر درسًا', 'Choose a lesson')}</option>
                                    {orderedLessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lessonNames.get(lesson.id)}</option>)}
                                </select>
                            </label>
                        )}
                        <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('درجة النجاح (%)', 'Passing score (%)')}
                            <input className={inputClass} type="number" min={1} max={100} value={draft.passScore} onChange={(event) => setDraft({ ...draft, passScore: Number(event.target.value) })} />
                        </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1.5 text-xs font-bold text-gray-300">
                            {text('عدد المحاولات المسموح', 'Allowed attempts')}
                            <select
                                className={inputClass}
                                value={draft.maxAttempts === null ? 'unlimited' : draft.maxAttempts === 1 ? 'one' : 'limited'}
                                onChange={(event) => {
                                    const value = event.target.value;
                                    setDraft({ ...draft, maxAttempts: value === 'unlimited' ? null : value === 'one' ? 1 : Math.max(2, draft.maxAttempts || 2) });
                                }}
                            >
                                <option value="one">{text('مرة واحدة', 'One attempt')}</option>
                                <option value="limited">{text('عدد محدد', 'Limited attempts')}</option>
                                <option value="unlimited">{text('مفتوح بلا حد', 'Unlimited')}</option>
                            </select>
                            {draft.maxAttempts !== null && draft.maxAttempts > 1 && (
                                <input
                                    className={inputClass}
                                    type="number"
                                    min={2}
                                    max={100}
                                    value={draft.maxAttempts}
                                    onChange={(event) => setDraft({ ...draft, maxAttempts: Math.min(100, Math.max(2, Number(event.target.value) || 2)) })}
                                    aria-label={text('عدد المحاولات', 'Attempt count')}
                                />
                            )}
                        </label>
                        {!draft.isFinal && (
                            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/10 bg-black/10 p-3 text-xs font-bold leading-relaxed text-gray-300">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-gold"
                                    checked={draft.gateNextLessons}
                                    onChange={(event) => setDraft({ ...draft, gateNextLessons: event.target.checked })}
                                />
                                {text('قفل الدروس التالية حتى يجتاز الطالب هذا الاختبار', 'Lock subsequent lessons until the student passes this quiz')}
                            </label>
                        )}
                    </div>

                    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-bold text-gray-300">
                        <input type="checkbox" className="h-4 w-4 accent-brand-gold" checked={draft.isPublished} onChange={(event) => setDraft({ ...draft, isPublished: event.target.checked })} />
                        {text('نشر الاختبار وإتاحته للطلاب', 'Publish and make available to students')}
                    </label>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h5 className="font-black text-white">{text('الأسئلة', 'Questions')}</h5>
                            <button type="button" onClick={() => setDraft({ ...draft, questions: [...draft.questions, makeQuestion()] })} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-200 hover:bg-white/5">
                                <FilePlus2 size={15} /> {text('إضافة سؤال', 'Add question')}
                            </button>
                        </div>
                        {draft.questions.map((question, qi) => (
                            <article key={qi} className="space-y-4 rounded-xl border border-white/10 bg-black/10 p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <h6 className="font-bold text-white">{text('السؤال', 'Question')} {qi + 1}</h6>
                                    {draft.questions.length > 1 && <button type="button" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== qi) })} className="rounded-lg p-2 text-red-300 hover:bg-red-500/10" aria-label={text('حذف السؤال', 'Remove question')}><Trash2 size={16} /></button>}
                                </div>
                                <div className={`grid gap-3 ${inputLanguage === 'BOTH' ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                                    {showArabic && (
                                        <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('نص السؤال بالعربية', 'Question in Arabic')}
                                            <textarea {...languageInput('ARABIC')} className={inputClass} rows={2} value={question.textAr} onChange={(event) => setQuestion(qi, { textAr: event.target.value })} required />
                                        </label>
                                    )}
                                    {showEnglish && (
                                        <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('نص السؤال بالإنجليزية', 'Question in English')}
                                            <textarea {...languageInput('ENGLISH')} className={inputClass} rows={2} value={question.textEn} onChange={(event) => setQuestion(qi, { textEn: event.target.value })} required />
                                        </label>
                                    )}
                                </div>
                                <label className="block max-w-sm space-y-1.5 text-xs font-bold text-gray-300">{text('نمط الإجابة', 'Answer type')}
                                    <select className={inputClass} value={question.type} onChange={(event) => changeQuestionType(qi, event.target.value as QuestionType)}>
                                        <option value="SINGLE_CHOICE">{text('اختيار واحد', 'Single choice')}</option>
                                        <option value="MULTIPLE_CHOICE">{text('اختيارات متعددة', 'Multiple choice')}</option>
                                        <option value="TRUE_FALSE">{text('صح أو خطأ', 'True or false')}</option>
                                    </select>
                                </label>
                                <div className="space-y-2">
                                    <p className="text-xs font-bold text-gray-300">{text(question.type === 'MULTIPLE_CHOICE' ? 'حدد كل الإجابات الصحيحة' : 'حدد الإجابة الصحيحة', question.type === 'MULTIPLE_CHOICE' ? 'Select all correct answers' : 'Select the correct answer')}</p>
                                    {question.options.map((option, oi) => (
                                        <div key={oi} className={`grid items-center gap-2 ${inputLanguage === 'BOTH' ? 'sm:grid-cols-[24px_1fr_1fr]' : 'grid-cols-[24px_minmax(0,1fr)]'}`}>
                                            <input
                                                aria-label={text(`الخيار ${oi + 1} صحيح`, `Option ${oi + 1} is correct`)}
                                                type={question.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'}
                                                name={`correct-${qi}`}
                                                className="h-4 w-4 accent-brand-gold"
                                                checked={option.isCorrect}
                                                onChange={(event) => {
                                                    if (question.type === 'MULTIPLE_CHOICE') setOption(qi, oi, { isCorrect: event.target.checked });
                                                    else setQuestion(qi, { correctIndex: oi, options: question.options.map((item, index) => ({ ...item, isCorrect: index === oi })) });
                                                }}
                                            />
                                            {showArabic && <input {...languageInput('ARABIC')} className={inputClass} aria-label={text(`الخيار ${oi + 1} بالعربية`, `Option ${oi + 1} in Arabic`)} value={option.textAr} onChange={(event) => setOption(qi, oi, { textAr: event.target.value })} readOnly={question.type === 'TRUE_FALSE'} required />}
                                            {showEnglish && <input {...languageInput('ENGLISH')} className={inputClass} aria-label={text(`الخيار ${oi + 1} بالإنجليزية`, `Option ${oi + 1} in English`)} value={option.textEn} onChange={(event) => setOption(qi, oi, { textEn: event.target.value })} readOnly={question.type === 'TRUE_FALSE'} required />}
                                        </div>
                                    ))}
                                    {question.type !== 'TRUE_FALSE' && question.options.length < 6 && (
                                        <button type="button" onClick={() => setQuestion(qi, { options: [...question.options, { textAr: '', textEn: '', isCorrect: false }] })} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-brand-gold-light hover:bg-white/5">
                                            <Plus size={14} /> {text('إضافة خيار', 'Add option')}
                                        </button>
                                    )}
                                    {question.type !== 'TRUE_FALSE' && question.options.length > 2 && (
                                        <button type="button" onClick={() => {
                                            let options = question.options.slice(0, -1);
                                            if (!options.some((option) => option.isCorrect)) {
                                                options = options.map((option, index) => ({ ...option, isCorrect: index === 0 }));
                                            }
                                            setQuestion(qi, { options });
                                        }} className="ms-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-gray-400 hover:bg-white/5">
                                            <X size={14} /> {text('إزالة آخر خيار', 'Remove last option')}
                                        </button>
                                    )}
                                </div>
                                <div className={`grid gap-3 ${inputLanguage === 'BOTH' ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                                    {showArabic && (
                                        <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('تفسير الإجابة بالعربية (اختياري)', 'Explanation in Arabic (optional)')}
                                            <textarea {...languageInput('ARABIC')} className={inputClass} rows={2} value={question.explanationAr} onChange={(event) => setQuestion(qi, { explanationAr: event.target.value })} />
                                        </label>
                                    )}
                                    {showEnglish && (
                                        <label className="space-y-1.5 text-xs font-bold text-gray-300">{text('تفسير الإجابة بالإنجليزية (اختياري)', 'Explanation in English (optional)')}
                                            <textarea {...languageInput('ENGLISH')} className={inputClass} rows={2} value={question.explanationEn} onChange={(event) => setQuestion(qi, { explanationEn: event.target.value })} />
                                        </label>
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 pt-4">
                        <button type="button" onClick={() => setDraft(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-gray-300 hover:bg-white/5">{text('إلغاء', 'Cancel')}</button>
                        <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-5 py-2.5 text-sm font-black text-black disabled:opacity-60">
                            {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                            {text('حفظ الاختبار', 'Save quiz')}
                        </button>
                    </div>
                </form>
            )}

            {loading ? (
                <div className="flex justify-center rounded-2xl border border-white/5 bg-brand-navy-dark p-10"><Loader className="animate-spin text-brand-gold-light" /></div>
            ) : quizzes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-brand-navy-dark px-5 py-12 text-center">
                    <CircleHelp className="mx-auto mb-3 text-gray-500" size={32} />
                    <p className="font-bold text-gray-300">{text('لا توجد اختبارات لهذه الدورة بعد.', 'No quizzes have been created for this course yet.')}</p>
                    <p className="mt-1 text-sm text-gray-500">{text('ابدأ بإنشاء اختبار لدرس أو اختبار نهائي.', 'Create a lesson quiz or a final exam to get started.')}</p>
                </div>
            ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {quizzes.map((quiz) => (
                        <article key={quiz.id} className="rounded-2xl border border-white/5 bg-brand-navy-dark p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="mb-2 flex flex-wrap gap-2">
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${quiz.isFinal ? 'bg-purple-400/10 text-purple-200' : 'bg-brand-gold/10 text-brand-gold-light'}`}>
                                            {quiz.isFinal ? text('اختبار نهائي', 'Final exam') : lessonNames.get(quiz.moduleId || '') || text('اختبار درس', 'Lesson quiz')}
                                        </span>
                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${quiz.isPublished ? 'bg-emerald-400/10 text-emerald-300' : 'bg-gray-400/10 text-gray-400'}`}>
                                            {quiz.isPublished ? text('منشور', 'Published') : text('مسودة', 'Draft')}
                                        </span>
                                    </div>
                                    <h4 className="truncate font-black text-white">{isAr ? quiz.titleAr : quiz.titleEn}</h4>
                                    {(isAr ? quiz.descriptionAr : quiz.descriptionEn) && <p className="mt-1 line-clamp-2 text-sm text-gray-400">{isAr ? quiz.descriptionAr : quiz.descriptionEn}</p>}
                                    <p className="mt-3 text-xs font-bold text-gray-500">
                                        {quiz.questions.length} {text('سؤال', 'questions')} · {text('درجة النجاح', 'Pass score')} {quiz.passScore}% · {quiz.maxAttempts == null ? text('محاولات مفتوحة', 'Unlimited attempts') : `${text('المحاولات', 'Attempts')}: ${quiz.maxAttempts}`}
                                    </p>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <button type="button" onClick={() => startEdit(quiz)} className="rounded-lg p-2 text-gray-300 hover:bg-white/5 hover:text-brand-gold-light" aria-label={text('تعديل', 'Edit')}><Pencil size={16} /></button>
                                    <button type="button" onClick={() => void removeQuiz(quiz)} className="rounded-lg p-2 text-gray-300 hover:bg-red-500/10 hover:text-red-300" aria-label={text('حذف', 'Delete')}><Trash2 size={16} /></button>
                                </div>
                            </div>
                            <div className="mt-4 flex items-center gap-1 text-xs text-gray-500">
                                <Check size={13} className="text-emerald-400" />
                                {text('الإجابات محفوظة بشكل آمن ولا تظهر للطلاب قبل التقييم.', 'Answer keys stay private and are never sent to students.')}
                            </div>
                            <button
                                type="button"
                                onClick={() => openAttemptsQuizId === quiz.id ? setOpenAttemptsQuizId(null) : void loadAttempts(quiz)}
                                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-200 hover:border-brand-gold/40 hover:text-brand-gold-light"
                            >
                                <Users size={14} />
                                {text('نتائج ومحاولات الطلاب', 'Student results & attempts')}
                            </button>
                            {openAttemptsQuizId === quiz.id && (
                                <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-black/10 p-3">
                                    {attemptsLoadingQuizId === quiz.id ? (
                                        <div className="flex justify-center py-4"><Loader size={18} className="animate-spin text-brand-gold-light" /></div>
                                    ) : (attemptsByQuiz[quiz.id] || []).length === 0 ? (
                                        <p className="py-3 text-center text-xs text-gray-400">{text('لم يسجل أي طالب محاولة لهذا الاختبار بعد.', 'No students have attempted this quiz yet.')}</p>
                                    ) : (attemptsByQuiz[quiz.id] || []).map((student) => {
                                        const actionKey = `${quiz.id}:${student.enrollmentId}`;
                                        return (
                                            <article key={student.enrollmentId} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                                                <div className="flex flex-wrap items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-black text-white">{studentName(student.student)}</p>
                                                        <p className="truncate text-xs text-gray-500">{student.student.email}</p>
                                                        <p className="mt-1 text-[11px] font-bold text-gray-400">
                                                            {text('المحاولات', 'Attempts')}: {student.attempts.length}
                                                            {student.attemptsAllowed === null ? ` / ∞` : ` / ${student.attemptsAllowed}`}
                                                            {student.extraAttempts > 0 && ` · ${text('إضافية', 'extra')}: ${student.extraAttempts}`}
                                                        </p>
                                                    </div>
                                                    <div className="flex shrink-0 flex-wrap gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={attemptActionKey === actionKey}
                                                            onClick={() => void manageStudentAttempts(quiz, student, 'grant')}
                                                            className="inline-flex items-center gap-1 rounded-lg bg-brand-gold/10 px-2.5 py-2 text-[11px] font-black text-brand-gold-light hover:bg-brand-gold/20 disabled:opacity-50"
                                                        >
                                                            {attemptActionKey === actionKey ? <Loader size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                                                            {text('منح محاولة', 'Grant attempt')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={attemptActionKey === actionKey}
                                                            onClick={() => void manageStudentAttempts(quiz, student, 'reset')}
                                                            className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] font-black text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                                                        >
                                                            {text('تصفير المحاولات', 'Reset attempts')}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="mt-3 space-y-1.5">
                                                    {student.attempts.map((attempt, index) => (
                                                        <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/10 px-2.5 py-2 text-[11px]">
                                                            <span className="font-bold text-gray-300">
                                                                {text('محاولة', 'Attempt')} {student.attempts.length - index} · {new Date(attempt.submittedAt).toLocaleString(isAr ? 'ar' : 'en-US')}
                                                            </span>
                                                            <span className={`font-black ${attempt.passed ? 'text-emerald-300' : 'text-red-300'}`}>
                                                                {attempt.score}% · {attempt.passed ? text('ناجح', 'Passed') : text('غير مجتاز', 'Not passed')}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
