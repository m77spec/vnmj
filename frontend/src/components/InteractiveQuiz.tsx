"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import {
    AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, History,
    Loader, ListChecks, RotateCcw, Send, Trophy, XCircle,
} from 'lucide-react';

interface QuizOptionRaw {
    textAr?: string;
    textEn?: string;
    [key: string]: unknown;
}

interface QuizQuestion {
    id: string;
    type?: string | null;
    textAr: string;
    textEn: string;
    options: unknown;
    explanationAr?: string | null;
    explanationEn?: string | null;
}

interface QuizData {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    passScore?: number;
    maxAttempts?: number | null;
    questions: QuizQuestion[];
}

interface PreviousAttempt {
    id: string;
    score: number;
    passed: boolean;
    submittedAt?: string;
    attemptsUsed?: number;
    attemptsAllowed?: number | null;
    canAttempt?: boolean;
}

interface AttemptDetail {
    questionId: string;
    isCorrect: boolean;
    correctAnswer: number[];
}

interface AttemptResult {
    score: number;
    passed: boolean;
    attemptsUsed: number;
    attemptsAllowed: number | null;
    details?: AttemptDetail[];
    attempt?: PreviousAttempt | null;
    answersSnapshot?: Record<string, number[]>;
}

interface Props {
    quizId: string;
    enrollmentId: string;
    onComplete?: (passed: boolean, score: number) => void;
}

const SECONDS_PER_QUESTION = 30;

function ScoreRing({ pct, passed }: { pct: number; passed: boolean }) {
    const clamped = Math.min(100, Math.max(0, pct));
    const radius = 52;
    const circ = 2 * Math.PI * radius;
    const offset = circ - (clamped / 100) * circ;
    return (
        <div className="relative w-36 h-36 shrink-0">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                <circle
                    cx="60" cy="60" r={radius} fill="none"
                    stroke={passed ? '#34d399' : '#f87171'}
                    strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={circ} strokeDashoffset={offset}
                    style={{ transition: 'stroke-dashoffset 1s ease' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-ink">{clamped}%</span>
            </div>
        </div>
    );
}

export default function InteractiveQuiz({ quizId, enrollmentId, onComplete }: Props) {
    const { t, locale, pick } = useI18n();
    const isAr = locale === 'ar';

    const [loaded, setLoaded] = useState<{ id: string; quiz: QuizData } | null>(null);
    const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
    const [previous, setPrevious] = useState<PreviousAttempt | null>(null);
    const [attemptStatus, setAttemptStatus] = useState<Pick<PreviousAttempt, 'attemptsUsed' | 'attemptsAllowed' | 'canAttempt'> | null>(null);

    const loading = !!quizId && (!loaded || loaded.id !== quizId) && (!failure || failure.id !== quizId);
    const error = failure && failure.id === quizId ? failure.message : null;
    const quiz = loaded && loaded.id === quizId ? loaded.quiz : null;

    const [phase, setPhase] = useState<'idle' | 'playing' | 'submitting' | 'results'>('idle');
    const [current, setCurrent] = useState(0);
    const [answers, setAnswers] = useState<Record<string, number[]>>({});
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [result, setResult] = useState<AttemptResult | null>(null);
    const submittingRef = useRef(false);
    const onCompleteRef = useRef(onComplete);
    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await api.get(`/quizzes/${quizId}`);
                if (!active) return;
                setLoaded({ id: quizId, quiz: res.data });
                try {
                    const att = await api.get(`/quizzes/${quizId}/my-attempt`);
                    if (active) {
                        const status = att.data as PreviousAttempt | null;
                        const defaultLimit = res.data.maxAttempts === undefined ? 1 : res.data.maxAttempts;
                        setAttemptStatus(status ? {
                            attemptsUsed: status.attemptsUsed ?? 0,
                            attemptsAllowed: status.attemptsAllowed === undefined ? defaultLimit : status.attemptsAllowed,
                            canAttempt: status.canAttempt ?? true,
                        } : { attemptsUsed: 0, attemptsAllowed: defaultLimit, canAttempt: true });
                        setPrevious(status?.id ? status : null);
                    }
                } catch {
                    if (active) {
                        toast.error(isAr ? 'تعذر تحميل حالة محاولات الاختبار.' : 'Could not load quiz attempt status.');
                    }
                }
            } catch (err) {
                if (active) setFailure({ id: quizId, message: getErrorMessage(err) || t('common.error') });
            }
        })();
        return () => { active = false; };
    }, [quizId, t, isAr]);

    const questions = useMemo(() => quiz?.questions ?? [], [quiz]);
    const answeredCount = questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length;

    const startQuiz = () => {
        if (!quiz) return;
        setAnswers({});
        setCurrent(0);
        setResult(null);
        setSecondsLeft(Math.max(questions.length, 1) * SECONDS_PER_QUESTION);
        setPhase('playing');
    };

    const doSubmit = async (auto = false) => {
        if (!quiz || submittingRef.current) return;
        if (!auto) {
            const unanswered = questions.length - answeredCount;
            if (unanswered > 0 && !confirm(isAr ? `لديك ${unanswered} سؤال بدون إجابة. هل تريد الإرسال؟` : `You have ${unanswered} unanswered question(s). Submit anyway?`)) {
                return;
            }
        }
        submittingRef.current = true;
        setPhase('submitting');
        try {
            const payload = {
                enrollmentId,
                answers: questions.map((q) => ({
                    questionId: q.id,
                    selected: [...(answers[q.id] || [])].sort((a, b) => a - b),
                })),
            };
            const res = await api.post(`/quizzes/${quizId}/attempt`, payload);
            const data: AttemptResult = res.data;
            setResult({ ...data, answersSnapshot: { ...answers } });
            setPrevious({
                id: data.attempt?.id || '',
                score: Math.max(previous?.score ?? 0, Number(data.score ?? data.attempt?.score ?? 0)),
                passed: !!previous?.passed || !!data.passed,
                submittedAt: data.attempt?.submittedAt,
                attemptsUsed: data.attemptsUsed,
                attemptsAllowed: data.attemptsAllowed,
                canAttempt: data.attemptsAllowed === null || (data.attemptsAllowed !== undefined && data.attemptsUsed < data.attemptsAllowed),
            });
            setAttemptStatus({
                attemptsUsed: data.attemptsUsed,
                attemptsAllowed: data.attemptsAllowed,
                canAttempt: data.attemptsAllowed === null || (data.attemptsAllowed !== undefined && data.attemptsUsed < data.attemptsAllowed),
            });
            setPhase('results');
            toast.success(data.passed
                ? (isAr ? 'مبروك! لقد نجحت في الاختبار' : 'Congratulations, you passed!')
                : (isAr ? 'تم إرسال محاولتك' : 'Attempt submitted'));
            onCompleteRef.current?.(!!data.passed, Number(data.score ?? data.attempt?.score ?? 0));
        } catch (err) {
            toast.error(getErrorMessage(err) || t('common.error'));
            setPhase('playing');
        } finally {
            submittingRef.current = false;
        }
    };

    useEffect(() => {
        if (phase !== 'playing') return;
        const id = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
        return () => clearInterval(id);
    }, [phase]);

    useEffect(() => {
        if (phase !== 'playing' || secondsLeft > 0 || questions.length === 0) return;
        const t = setTimeout(() => { void doSubmit(true); }, 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [secondsLeft, phase, questions.length]);

    const isMultiple = (q: QuizQuestion) => q.type === 'MULTIPLE_CHOICE' || q.type === 'MULTIPLE';

    const optionLabels = (q: QuizQuestion): string[] => {
        const opts = Array.isArray(q.options) ? (q.options as Array<string | QuizOptionRaw>) : [];
        return opts.map((o) => {
            if (typeof o === 'string') return o;
            const obj = (o || {}) as QuizOptionRaw;
            return (isAr ? obj.textAr : obj.textEn) || obj.textAr || obj.textEn || '—';
        });
    };

    const selectOption = (q: QuizQuestion, idx: number) => {
        setAnswers((prev) => {
            const cur = prev[q.id] || [];
            if (isMultiple(q)) {
                const next = cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx].sort((a, b) => a - b);
                return { ...prev, [q.id]: next };
            }
            return { ...prev, [q.id]: [idx] };
        });
    };

    const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader size={28} className="animate-spin text-accent" />
            </div>
        );
    }

    if (error || !quiz) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <AlertTriangle size={32} className="text-red-700 dark:text-red-400" />
                <p className="text-ink-subtle font-bold">{error || (isAr ? 'تعذر تحميل الاختبار' : 'Failed to load quiz')}</p>
            </div>
        );
    }

    const passScore = quiz.passScore ?? 60;

    // ===== Results =====
    if (phase === 'results' && result) {
        const detailMap = new Map((result.details || []).map((d) => [d.questionId, d]));
        const correctCount = questions.filter((q) => detailMap.get(q.id)?.isCorrect).length || (result.score >= passScore ? questions.length : 0);
        return (
            <div className="space-y-5 animate-fade-in">
                <div className="bg-surface-sunken border border-line rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6">
                    <ScoreRing pct={Number(result.score ?? 0)} passed={!!result.passed} />
                    <div className="flex-1 text-center sm:text-start space-y-2">
                        <h3 className={`text-xl font-black ${result.passed ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                            {result.passed
                                ? (isAr ? 'نجحت في الاختبار!' : 'You passed the quiz!')
                                : (isAr ? 'لم تجتز الاختبار هذه المرة' : 'Not passed this time')}
                        </h3>
                        <p className="text-ink-subtle text-sm font-bold">
                            {isAr ? 'درجة النجاح' : 'Pass score'}: {passScore}% · {isAr ? 'إجابات صحيحة' : 'Correct answers'}: {correctCount}/{questions.length}
                        </p>
                        {attemptStatus?.canAttempt !== false && (
                            <button
                                onClick={startQuiz}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-brand-gold/10 text-gold-ink border border-brand-gold/30 hover:bg-brand-gold/20 transition"
                            >
                                <RotateCcw size={14} /> {isAr ? 'إعادة المحاولة' : 'Retake quiz'}
                            </button>
                        )}
                        {attemptStatus?.canAttempt === false && (
                            <p className="text-sm font-bold text-ink-subtle">
                                {isAr ? 'انتهت المحاولات المتاحة. تواصل مع المدرّس لطلب محاولة إضافية.' : 'No attempts remain. Contact your instructor to request another attempt.'}
                            </p>
                        )}
                    </div>
                </div>

                <div className="space-y-3">
                    {questions.map((q, qi) => {
                        const d = detailMap.get(q.id);
                        const chosen = result.answersSnapshot?.[q.id] || [];
                        const labels = optionLabels(q);
                        const correctIdx = d?.correctAnswer || [];
                        const explanation = isAr ? q.explanationAr : q.explanationEn;
                        return (
                            <div key={q.id} className={`bg-surface-sunken border rounded-2xl p-5 ${d?.isCorrect ? 'border-green-500/20' : 'border-red-500/20'}`}>
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <h4 className="text-ink font-bold text-sm leading-relaxed">
                                        {qi + 1}. {pick(q, 'text')}
                                    </h4>
                                    {d?.isCorrect
                                        ? <CheckCircle2 size={18} className="text-green-700 dark:text-green-400 shrink-0" />
                                        : <XCircle size={18} className="text-red-700 dark:text-red-400 shrink-0" />}
                                </div>
                                <div className="space-y-1.5 mb-3">
                                    {labels.map((label, oi) => {
                                        const wasChosen = chosen.includes(oi);
                                        const isCorrectOpt = correctIdx.includes(oi);
                                        return (
                                            <div
                                                key={oi}
                                                className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                                                    isCorrectOpt
                                                        ? 'border-green-500/30 bg-green-500/10 text-green-900 dark:text-green-400'
                                                        : wasChosen
                                                          ? 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-400'
                                                          : 'border-line bg-ink/[0.02] text-ink-muted'
                                                }`}
                                            >
                                                {label}
                                                {wasChosen && <span className="ms-2 opacity-75">({isAr ? 'إجابتك' : 'your answer'})</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                                {explanation && (
                                    <div className="border-s-2 border-brand-gold ps-3 text-xs text-accent leading-relaxed">
                                        {explanation}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ===== Playing / Submitting =====
    if (phase === 'playing' || phase === 'submitting') {
        const q = questions[current];
        if (!q) return null;
        const progress = questions.length ? (answeredCount / questions.length) * 100 : 0;
        const lowTime = secondsLeft <= 30;
        return (
            <div className="space-y-4">
                <div className="bg-surface-sunken border border-line rounded-2xl p-5">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                        <div>
                            <h3 className="text-ink font-black">{pick(quiz, 'title')}</h3>
                            <p className="text-xs text-ink-subtle font-bold mt-0.5">
                                {isAr ? `سؤال ${current + 1} من ${questions.length}` : `Question ${current + 1} of ${questions.length}`}
                            </p>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-black tabular-nums ${
                            lowTime ? 'bg-red-500/15 text-red-800 dark:text-red-400 animate-pulse' : 'bg-ink/[0.04] text-ink-muted'
                        }`}>
                            <Clock size={14} /> {fmtTime(secondsLeft)}
                        </span>
                    </div>
                    <div className="h-2 bg-ink/[0.04] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-brand-gold to-brand-gold-light rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-[11px] text-ink-subtle font-bold mt-1.5">
                        {isAr ? `أجبت على ${answeredCount} من ${questions.length}` : `Answered ${answeredCount} of ${questions.length}`}
                    </p>
                </div>

                <div key={current} className="bg-surface-sunken border border-line rounded-2xl p-6 animate-fade-in">
                    <span className={`inline-block mb-4 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                        isMultiple(q)
                            ? 'bg-surface-raised text-blue-700 dark:text-blue-400 border-brand-navy-light/30'
                            : 'bg-brand-gold/10 text-gold-ink border-brand-gold/30'
                    }`}>
                        {isMultiple(q)
                            ? (isAr ? 'اختيار متعدد' : 'Multiple choice')
                            : (isAr ? 'اختيار واحد' : 'Single choice')}
                    </span>
                    <h4 className="text-ink font-bold text-base leading-relaxed mb-5">{pick(q, 'text')}</h4>
                    <div className="space-y-2.5">
                        {optionLabels(q).map((label, oi) => {
                            const checked = (answers[q.id] || []).includes(oi);
                            return (
                                <label
                                    key={oi}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                                        checked
                                            ? 'border-brand-gold/50 bg-brand-gold/10'
                                            : 'border-line bg-ink/[0.02] hover:border-line-strong hover:bg-ink/[0.04]'
                                    }`}
                                >
                                    <input
                                        type={isMultiple(q) ? 'checkbox' : 'radio'}
                                        name={`q-${q.id}`}
                                        checked={checked}
                                        onChange={() => selectOption(q, oi)}
                                        className="w-4 h-4 accent-brand-gold cursor-pointer"
                                    />
                                    <span className={`text-sm font-semibold ${checked ? 'text-ink' : 'text-ink-muted'}`}>{label}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <button
                        onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                        disabled={current === 0 || phase === 'submitting'}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-ink-muted bg-ink/[0.04] border border-line hover:text-ink hover:bg-ink/[0.08] transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        {isAr ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                        {isAr ? 'السابق' : 'Previous'}
                    </button>

                    {current < questions.length - 1 ? (
                        <button
                            onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
                            disabled={phase === 'submitting'}
                            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold bg-brand-gold text-ink-on-gold hover:bg-brand-gold-light transition disabled:opacity-50"
                        >
                            {isAr ? 'التالي' : 'Next'}
                            {isAr ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                        </button>
                    ) : (
                        <button
                            onClick={() => doSubmit(false)}
                            disabled={phase === 'submitting'}
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-brand-gold text-ink-on-gold hover:bg-brand-gold-light transition disabled:opacity-50"
                        >
                            {phase === 'submitting' ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                            {isAr ? 'إرسال الاختبار' : 'Submit quiz'}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // ===== Idle / intro =====
    return (
        <div className="bg-surface-sunken border border-line rounded-2xl p-8 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-brand-gold/10 border border-brand-gold/30 flex items-center justify-center">
                <ListChecks size={28} className="text-accent" />
            </div>
            <h3 className="text-xl font-black text-ink">{pick(quiz, 'title')}</h3>
            {pick(quiz, 'description') && (
                <p className="text-ink-subtle text-sm max-w-md mx-auto">{pick(quiz, 'description')}</p>
            )}
            <div className="flex items-center justify-center gap-3 flex-wrap text-xs font-bold">
                <span className="px-3 py-1.5 rounded-lg bg-ink/[0.04] border border-line text-ink-muted">
                    {questions.length} {isAr ? 'سؤال' : 'questions'}
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-ink/[0.04] border border-line text-ink-muted">
                    {isAr ? 'النجاح عند' : 'Pass at'} {passScore}%
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-ink/[0.04] border border-line text-ink-muted">
                    <Clock size={12} />
                    {isAr ? '~' : '~'}{Math.ceil((questions.length * SECONDS_PER_QUESTION) / 60)} {isAr ? 'دقيقة' : 'min'}
                </span>
            </div>

            {previous && (
                <div className="max-w-sm mx-auto flex items-center gap-3 bg-ink/[0.024] border border-line rounded-xl p-4 text-start">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                        previous.passed ? 'bg-green-500/15 text-green-900 dark:text-green-400' : 'bg-red-500/15 text-red-800 dark:text-red-400'
                    }`}>
                        <Trophy size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-ink font-black text-sm">{isAr ? 'أفضل نتيجة' : 'Best score'}: {previous.score}%</p>
                        <p className="text-[11px] text-ink-subtle font-bold">
                            {previous.passed
                                ? (isAr ? 'ناجح' : 'Passed')
                                : (isAr ? 'غير مجتاز' : 'Not passed')}
                            {previous.submittedAt ? ` · ${new Date(previous.submittedAt).toLocaleDateString(isAr ? 'ar' : 'en-US')}` : ''}
                        </p>
                    </div>
                    <History size={16} className="text-ink-subtle shrink-0" />
                </div>
            )}

            <button
                onClick={startQuiz}
                disabled={attemptStatus?.canAttempt === false}
                className="inline-flex items-center gap-2 px-8 py-3 rounded-xl font-black bg-brand-gold text-ink-on-gold hover:bg-brand-gold-light transition disabled:cursor-not-allowed disabled:opacity-50"
            >
                {previous ? <RotateCcw size={16} /> : <ListChecks size={16} />}
                {attemptStatus?.canAttempt === false
                    ? (isAr ? 'انتهت المحاولات' : 'No attempts left')
                    : previous ? (isAr ? 'إعادة المحاولة' : 'Retake quiz') : (isAr ? 'ابدأ الاختبار' : 'Start quiz')}
            </button>
            {attemptStatus && (
                <p className="text-[11px] text-ink-subtle font-bold">
                    {isAr ? 'المحاولات المستخدمة' : 'Attempts used'}: {attemptStatus.attemptsUsed ?? 0}
                    {attemptStatus.attemptsAllowed === null ? ' / ∞' : ` / ${attemptStatus.attemptsAllowed ?? 1}`}
                </p>
            )}
            {previous && (
                <p className="text-[11px] text-ink-subtle font-bold">
                    {isAr ? 'يتم الاحتفاظ بأفضل درجة لديك' : 'Your best score is kept'}
                </p>
            )}
        </div>
    );
}
