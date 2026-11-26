"use client";

import { useEffect, useMemo, useState } from 'react';
import { api, API_BASE_URL, getErrorMessage } from '@/lib/api';
import { useFetchData } from '@/lib/useFetchData';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import {
    Loader, Plus, Pencil, Trash2, X, Check, ClipboardList, ChevronDown, ChevronUp, Mail, Download, Paperclip, Link2, Search, Circle,
    ClipboardCheck,
} from 'lucide-react';
import { EmptyPanel, BtnPrimary } from '@/app/dashboard/admin/components';
import PeerReviewPanel from '@/components/PeerReviewPanel';

/** A submitted file is shown with its size; a bare "attachment" is unhelpful. */
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TaskSubmission {
    id: string;
    content?: string | null;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    attachmentType?: string | null;
    attachmentSize?: number | null;
    score?: number | null;
    notes?: string | null;
    submittedAt: string;
    /** The student's own name, derived server-side from their profile. */
    studentName?: string | null;
    enrollment?: { id: string; student: { id: string; email: string } } | null;
}

interface TaskLink {
    url: string;
    labelAr?: string | null;
    labelEn?: string | null;
}

interface ModuleOption {
    id: string;
    titleAr: string;
    titleEn: string;
    orderIndex?: number | null;
    chapterId?: string | null;
    chapterOrderIndex?: number | null;
}

interface Task {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    dueDate?: string | null;
    maxScore: number;
    createdAt: string;
    moduleId?: string | null;
    module?: ModuleOption | null;
    attachmentUrl?: string | null;
    attachmentType?: string | null;
    links?: TaskLink[] | null;
    submissions: TaskSubmission[];
    isPublished?: boolean;
}

interface TaskForm {
    titleAr: string;
    titleEn: string;
    descriptionAr: string;
    descriptionEn: string;
    dueDate: string;
    maxScore: string;
    moduleId: string;
    attachmentUrl: string;
    links: { url: string; labelAr: string; labelEn: string }[];
}

const emptyForm: TaskForm = { titleAr: '', titleEn: '', descriptionAr: '', descriptionEn: '', dueDate: '', maxScore: '100', moduleId: '', attachmentUrl: '', links: [] };

function normalizedLessonOptions(modules: ModuleOption[]) {
    const keyOf = (lesson: ModuleOption) => [
        lesson.orderIndex ?? 0,
        (lesson.titleAr || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
        (lesson.titleEn || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
    ].join('|');
    const chapterLessonKeys = new Set(modules.filter((lesson) => lesson.chapterId).map(keyOf));
    const seenIds = new Set<string>();
    const seenStructuralKeys = new Set<string>();

    const unique = modules.filter((lesson) => {
        if (seenIds.has(lesson.id)) return false;
        seenIds.add(lesson.id);

        const key = keyOf(lesson);
        if (!lesson.chapterId && chapterLessonKeys.has(key)) return false;

        const structuralKey = `${lesson.chapterId || 'root'}|${key}`;
        if (seenStructuralKeys.has(structuralKey)) return false;
        seenStructuralKeys.add(structuralKey);
        return true;
    });

    return unique.slice().sort((left, right) => {
        const leftChapter = left.chapterOrderIndex ?? (left.chapterId ? 0 : -1);
        const rightChapter = right.chapterOrderIndex ?? (right.chapterId ? 0 : -1);
        return leftChapter - rightChapter
            || (left.orderIndex ?? 0) - (right.orderIndex ?? 0)
            || (left.titleAr || '').localeCompare(right.titleAr || '')
            || left.id.localeCompare(right.id);
    });
}

export default function TasksPanel({
    openingId,
    canManageTasks = true,
    canGrade = true,
}: {
    openingId: string;
    canManageTasks?: boolean;
    canGrade?: boolean;
}) {
    const { t, pick, locale } = useI18n();
    const isAr = locale === 'ar';
    const [tasks, setTasks] = useState<Task[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [modules, setModules] = useState<ModuleOption[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Task | null>(null);
    const [form, setForm] = useState<TaskForm>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [savingGrade, setSavingGrade] = useState<string | null>(null);
    const [savingScore, setSavingScore] = useState<Record<string, string>>({});
    const [savingNotes, setSavingNotes] = useState<Record<string, string>>({});
    const [filterModule, setFilterModule] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [peerReviewSubId, setPeerReviewSubId] = useState<string | null>(null);
    const lessonOptions = useMemo(() => normalizedLessonOptions(modules), [modules]);
    const rosterPath = canGrade
        ? `/openings/${openingId}/roster`
        : canManageTasks ? `/tasks/opening/${openingId}/roster` : null;
    const { data: rosterData } = useFetchData<
        { enrollments: { id: string; student: { id: string; email: string } }[] }
        | { id: string; student: { id: string; email: string } }[]
    >(rosterPath);
    const enrolledStudents = Array.isArray(rosterData) ? rosterData : (rosterData?.enrollments ?? []);

    const filteredTasks = (tasks || []).filter(task => {
        if (filterModule !== 'all' && task.moduleId !== filterModule) return false;
        if (filterStatus === 'has-submissions' && task.submissions.length === 0) return false;
        if (filterStatus === 'no-submissions' && task.submissions.length > 0) return false;
        if (searchQuery && !(pick(task, 'title') || '').toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const load = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await api.get(`/tasks/opening/${openingId}`);
            setTasks(res.data);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('tasks.load_fail'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        const run = async () => {
            try {
                const [res, modRes] = await Promise.all([
                    api.get(`/tasks/opening/${openingId}`),
                    canManageTasks
                        ? api.get(`/openings/${openingId}/modules`)
                        : Promise.resolve({ data: [] }),
                ]);
                if (active) {
                    setTasks(res.data);
                    setModules(modRes.data || []);
                }
            } catch (err) {
                if (active) toast.error(getErrorMessage(err) || t('tasks.load_fail'));
            } finally {
                if (active) setLoading(false);
            }
        };
        run();
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openingId, canManageTasks]);

    const openCreate = () => { setEditing(null); setForm(emptyForm); setModalOpen(true); };
    const openEdit = (task: Task) => {
        setEditing(task);
        setForm({
            titleAr: task.titleAr,
            titleEn: task.titleEn,
            descriptionAr: task.descriptionAr ?? '',
            descriptionEn: task.descriptionEn ?? '',
            dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : '',
            maxScore: String(task.maxScore),
            moduleId: task.moduleId ?? '',
            attachmentUrl: task.attachmentUrl ?? '',
            links: (task.links || []).map((l) => ({ url: l.url, labelAr: l.labelAr ?? '', labelEn: l.labelEn ?? '' })),
        });
        setModalOpen(true);
    };

    const updateLink = (idx: number, patch: Partial<{ url: string; labelAr: string; labelEn: string }>) => {
        setForm((f) => ({ ...f, links: f.links.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
    };

    const attachmentTypeFromUrl = (url: string) => {
        const ext = (url.split('?')[0].match(/\.(\w+)$/)?.[1] || '').toLowerCase();
        if (!ext) return undefined;
        return ext;
    };

    const moduleLabel = (task: Task) => (task.module ? pick(task.module, 'title') : null);

    const saveTask = async () => {
        if (!form.titleAr.trim() || !form.titleEn.trim()) {
            toast.error(t('tasks.titles_required'));
            return;
        }
        setSaving(true);
        try {
            const attachmentUrl = form.attachmentUrl.trim();
            const body = {
                titleAr: form.titleAr.trim(),
                titleEn: form.titleEn.trim(),
                descriptionAr: form.descriptionAr.trim() || undefined,
                descriptionEn: form.descriptionEn.trim() || undefined,
                dueDate: form.dueDate ? new Date(`${form.dueDate}T00:00:00Z`).toISOString() : null,
                maxScore: Number(form.maxScore) || 100,
                moduleId: form.moduleId || undefined,
                attachmentUrl: attachmentUrl || undefined,
                attachmentType: attachmentUrl ? attachmentTypeFromUrl(attachmentUrl) : undefined,
                links: form.links.filter((l) => l.url.trim()).map((l) => ({
                    url: l.url.trim(),
                    labelAr: l.labelAr.trim() || undefined,
                    labelEn: l.labelEn.trim() || undefined,
                })),
            };
            if (editing) {
                await api.patch(`/tasks/${editing.id}`, body);
                toast.success(t('tasks.task_updated'));
            } else {
                await api.post(`/tasks/opening/${openingId}`, body);
                toast.success(t('tasks.task_created'));
            }
            setModalOpen(false);
            load(true);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('tasks.task_save_fail'));
        }
        setSaving(false);
    };

    const deleteTask = async (task: Task) => {
        if (!window.confirm(t('tasks.delete_task_confirm'))) return;
        try {
            await api.delete(`/tasks/${task.id}`);
            toast.success(t('tasks.task_deleted'));
            load(true);
        } catch {
            toast.error(t('tasks.task_save_fail'));
        }
    };

    const gradeSubmission = async (submission: TaskSubmission) => {
        const score = savingScore[submission.id];
        if (score === undefined || score === '' || isNaN(Number(score))) {
            toast.error(t('tasks.grade_invalid'));
            return;
        }
        setSavingGrade(submission.id);
        try {
            await api.patch(`/tasks/submissions/${submission.id}/grade`, {
                score: Number(score),
                notes: savingNotes[submission.id]?.trim() || undefined,
            });
            toast.success(t('tasks.grade_saved'));
            setSavingScore((p) => { const n = { ...p }; delete n[submission.id]; return n; });
            setSavingNotes((p) => { const n = { ...p }; delete n[submission.id]; return n; });
            load(true);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('tasks.grade_fail'));
        }
        setSavingGrade(null);
    };

    const inputCls = "w-full px-3 py-2.5 bg-ink/[0.04] border border-line rounded-xl focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold/40 outline-none transition text-placeholder:ink-subtle text-ink";

    if (loading && !tasks) {
        return <div className="h-64 flex items-center justify-center text-accent"><Loader className="animate-spin" size={36} /></div>;
    }

    return (
        <div className="bg-surface-sunken p-6 lg:p-8 rounded-3xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-black text-ink tracking-tight">{t('tasks.tasks_title')}</h2>
                    <p className="text-ink-subtle text-sm mt-0.5">{t('tasks.tasks_subtitle')}</p>
                </div>
                {canManageTasks && <BtnPrimary icon={Plus} onClick={openCreate}>{t('tasks.add_task')}</BtnPrimary>}
            </div>

            {tasks?.length === 0 && <EmptyPanel icon={ClipboardList} title={t('tasks.no_tasks')} />}

            {tasks && tasks.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-surface rounded-xl border border-line">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            placeholder={isAr ? 'بحث في المهام...' : 'Search tasks...'}
                            className="w-full pl-9 pr-4 py-2.5 bg-ink/[0.04] border border-line rounded-xl text-ink text-sm text-placeholder:ink-subtle focus:ring-2 focus:ring-brand-gold/40 outline-none" />
                    </div>
                    <select value={filterModule} onChange={e => setFilterModule(e.target.value)}
                        className="px-3 py-2.5 bg-ink/[0.04] border border-line rounded-xl text-ink text-sm focus:ring-2 focus:ring-brand-gold/40 outline-none">
                        <option value="all">{isAr ? 'كل الوحدات' : 'All Modules'}</option>
                        {lessonOptions.map(m => <option key={m.id} value={m.id}>{pick(m, 'title')}</option>) }
                    </select>
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                        className="px-3 py-2.5 bg-ink/[0.04] border border-line rounded-xl text-ink text-sm focus:ring-2 focus:ring-brand-gold/40 outline-none">
                        <option value="all">{isAr ? 'كل الحالات' : 'All Status'}</option>
                        <option value="has-submissions">{isAr ? 'يوجد تسليمات' : 'Has Submissions'}</option>
                        <option value="no-submissions">{isAr ? 'لا تسليمات' : 'No Submissions'}</option>
                    </select>
                </div>
            )}

            <div className="space-y-4">
                {filteredTasks.map((task) => {
                    const expanded = expandedId === task.id;
                    return (
                        <div key={task.id} className="border border-line rounded-2xl overflow-hidden">
                            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-white/5 to-transparent">
                                <div className="min-w-0">
                                    <h4 className="font-black text-ink truncate flex items-center gap-2">
                                        {pick(task, 'title')}
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${task.isPublished !== false ? 'bg-green-400' : 'bg-gray-500'}`} title={task.isPublished !== false ? (isAr ? 'منشور' : 'Published') : (isAr ? 'مسودة' : 'Draft')} />
                                    </h4>
                                    <p className="text-xs text-ink-subtle font-semibold mt-0.5">
                                        {moduleLabel(task) ? <span className="text-accent inline-flex items-center gap-1 mr-2"><ClipboardList size={12} />{moduleLabel(task)}</span> : null}
                                        {t('tasks.max_score_label')}: {task.maxScore}
                                        {task.dueDate ? <> · {t('tasks.due_on')} {new Date(task.dueDate).toLocaleDateString()}</> : null}
                                        {task.submissions.length > 0 ? <> · {task.submissions.length} {t('tasks.submissions')}</> : null}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {canManageTasks && (
                                        <>
                                            <button onClick={() => openEdit(task)} className="admin-action-btn text-ink hover:bg-surface-raised tooltip" title={t('common.edit')}>
                                                <Pencil size={17} />
                                            </button>
                                            <button onClick={() => deleteTask(task)} className="admin-action-btn text-red-800 dark:text-red-400 hover:bg-red-500/10 tooltip" title={t('common.delete')}>
                                                <Trash2 size={17} />
                                            </button>
                                        </>
                                    )}
                                    <button onClick={() => setExpandedId(expanded ? null : task.id)}
                                        className="admin-action-btn text-ink-muted hover:bg-ink/[0.04] tooltip" title={t('tasks.view_submissions')}>
                                        {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                                    </button>
                                </div>
                            </div>

                            <div className="px-5 py-3 text-sm text-ink-subtle border-t border-line">
                                {pick(task, 'description') || t('tasks.no_description')}
                            </div>

                            {(task.attachmentUrl || task.links?.length) ? (
                                <div className="px-5 py-3 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                                    {task.attachmentUrl && (
                                        <a href={task.attachmentUrl.startsWith('/') ? API_BASE_URL + task.attachmentUrl : task.attachmentUrl} target="_blank" rel="noreferrer"
                                            className="inline-flex items-center gap-1.5 font-bold text-accent hover:text-accent transition">
                                            <Paperclip size={15} /> {t('tasks.attachment')}
                                        </a>
                                    )}
                                    {(task.links || []).map((lk, i) => (
                                        <a key={i} href={lk.url} target="_blank" rel="noreferrer"
                                            className="inline-flex items-center gap-1.5 font-bold text-accent hover:text-accent transition">
                                            <Link2 size={15} /> {pick(lk, 'label') || lk.url}
                                        </a>
                                    ))}
                                </div>
                            ) : null}

                            {expanded && (
                                <div className="px-5 pb-5 border-t border-line">
                                    {task.submissions.length === 0 ? (
                                        <div className="py-8 text-center text-ink-subtle font-bold text-sm">{t('tasks.no_submissions')}</div>
                                    ) : (
                                        <div className="space-y-3 mt-4">
                                            {task.submissions.map((sub) => {
                                                const email = sub.enrollment?.student?.email ?? '—';
                                                // The name is what a teacher recognises; the email stays as
                                                // the fallback for an account registered without one.
                                                const who = sub.studentName || email;
                                                return (
                                                    <div key={sub.id} className="border border-line rounded-xl p-4 bg-surface">
                                                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                                            <div className="flex items-center gap-2 text-sm font-bold text-accent">
                                                                <Mail size={14} className="text-ink-subtle" /> {who}
                                                                {sub.studentName && sub.studentName !== email && (
                                                                    <span className="text-xs font-semibold text-ink-subtle">{email}</span>
                                                                )}
                                                                {task.dueDate && new Date(sub.submittedAt) > new Date(task.dueDate) && (
                                                                    <span className="px-2 py-0.5 text-[10px] font-bold bg-red-500/10 text-red-800 dark:text-red-400 border border-red-500/20 rounded-full">LATE</span>
                                                                )}
                                                            </div>
                                                            <span className="text-xs text-ink-subtle font-semibold">
                                                                {t('tasks.submitted_at')}: {new Date(sub.submittedAt).toLocaleString()}
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-ink-muted bg-ink/[0.04] rounded-xl px-4 py-3 mb-3 whitespace-pre-wrap">
                                                            {sub.content || t('tasks.no_content')}
                                                        </div>
                                                        {sub.attachmentUrl && (
                                                            <a href={sub.attachmentUrl.startsWith('/') ? API_BASE_URL + sub.attachmentUrl : sub.attachmentUrl} target="_blank" rel="noreferrer"
                                                                className="inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:text-accent transition mb-3">
                                                                <Download size={15} />
                                                                {sub.attachmentName || t('tasks.attachment')}
                                                                {sub.attachmentSize ? (
                                                                    <span className="text-xs font-semibold text-ink-subtle">({formatFileSize(sub.attachmentSize)})</span>
                                                                ) : null}
                                                            </a>
                                                        )}
                                                        <div className="grid sm:grid-cols-[180px_1fr_auto] gap-2 items-end">
                                                            {canGrade && <div>
                                                                <label className="block text-xs font-bold text-ink-subtle mb-1">{t('tasks.score')} / {task.maxScore}</label>
                                                                <input type="number" step="any" min={0} value={savingScore[sub.id] ?? (sub.score != null ? String(sub.score) : '')}
                                                                    onChange={(e) => setSavingScore((p) => ({ ...p, [sub.id]: e.target.value }))}
                                                                    className={inputCls} placeholder={t('tasks.score_placeholder')} />
                                                            </div>}
                                                            {canGrade && <div>
                                                                <label className="block text-xs font-bold text-ink-subtle mb-1">{t('tasks.notes')}</label>
                                                                <input value={savingNotes[sub.id] ?? (sub.notes ?? '')}
                                                                    onChange={(e) => setSavingNotes((p) => ({ ...p, [sub.id]: e.target.value }))}
                                                                    className={inputCls} placeholder={t('tasks.notes_placeholder')} />
                                                                {sub.score != null && (
                                                                    <p className="text-xs mt-1.5 text-ink-subtle font-semibold">
                                                                        {t('tasks.current_grade')}: {sub.score}{sub.notes ? ` — ${sub.notes}` : ''}
                                                                    </p>
                                                                )}
                                                            </div>}
                                                            {canGrade && <button onClick={() => gradeSubmission(sub)} disabled={savingGrade === sub.id}
                                                                className="inline-flex items-center gap-1.5 bg-brand-gold text-ink-on-gold text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-brand-gold-light transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
                                                                {savingGrade === sub.id ? <Loader size={15} className="animate-spin" /> : <Check size={15} />} {t('tasks.grade')}
                                                            </button>}
                                                        </div>
                                                        {canGrade && <button
                                                            onClick={() => setPeerReviewSubId(peerReviewSubId === sub.id ? null : sub.id)}
                                                            className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:text-accent transition cursor-pointer"
                                                        >
                                                            <ClipboardCheck size={14} />
                                                            {peerReviewSubId === sub.id ? (isAr ? 'إخفاء تقييم الأقران' : 'Hide Peer Review') : (isAr ? 'تقييم الأقران' : 'Peer Review')}
                                                        </button>}
                                                        {peerReviewSubId === sub.id && (
                                                            <div className="mt-4 pt-4 border-t border-line">
                                                                <PeerReviewPanel taskId={task.id} submissionId={sub.id} />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {(() => {
                                        const allStudents = enrolledStudents;
                                        const submittedIds = new Set(task.submissions.map(s => s.enrollment?.student?.id).filter(Boolean));
                                        const missing = allStudents.filter(e => !submittedIds.has(e.student.id));
                                        if (missing.length === 0) return null;
                                        return (
                                            <div className="mt-4 pt-4 border-t border-line">
                                                <p className="text-xs font-bold text-ink-subtle mb-2">{isAr ? 'لم يسلّم بعد' : 'Not Submitted'} ({missing.length})</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {missing.map(e => (
                                                        <span key={e.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/5 border border-red-500/10 rounded-lg text-xs text-red-800 dark:text-red-400 font-bold">
                                                            <Circle size={8} className="fill-red-400" /> {e.student.email}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {canManageTasks && modalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
                    <div className="bg-surface rounded-3xl shadow-2xl p-6 lg:p-8 w-full max-w-lg animate-fade-in-up max-h-[90vh] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-black text-ink">
                                {editing ? t('tasks.edit_task') : t('tasks.add_task')}
                            </h3>
                            <button onClick={() => setModalOpen(false)} className="text-ink-subtle hover:text-ink"><X size={20} /></button>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.task_title_ar')} *</label>
                                    <input value={form.titleAr} onChange={(e) => setForm({ ...form, titleAr: e.target.value })} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.task_title_en')} *</label>
                                    <input value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} className={inputCls} />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.task_description_ar')}</label>
                                    <input value={form.descriptionAr} onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.task_description_en')}</label>
                                    <input value={form.descriptionEn} onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })} className={inputCls} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.lecture_label')}</label>
                                <select value={form.moduleId} onChange={(e) => setForm({ ...form, moduleId: e.target.value })} className={inputCls}>
                                    <option value="">{t('tasks.no_lecture')}</option>
                                    {lessonOptions.map((mod, index) => (
                                        <option key={mod.id} value={mod.id}>{index + 1}. {pick(mod, 'title')}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.attachment_label')}</label>
                                <input dir="ltr" value={form.attachmentUrl} onChange={(e) => setForm({ ...form, attachmentUrl: e.target.value })} className={inputCls} placeholder={t('tasks.attachment_placeholder')} />
                            </div>
                            <div>
                                <span className="block text-xs font-black text-accent uppercase tracking-wider mb-2 flex items-center gap-1"><Link2 size={14} /> {t('tasks.links_heading')}</span>
                                <div className="space-y-2">
                                    {form.links.map((lk, i) => (
                                        <div key={i} className="rounded-xl border border-line bg-ink/[0.04] p-3 space-y-2">
                                            <input dir="ltr" value={lk.url} onChange={(e) => updateLink(i, { url: e.target.value })} className={inputCls} placeholder={t('tasks.link_url_placeholder')} />
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                <input value={lk.labelAr} onChange={(e) => updateLink(i, { labelAr: e.target.value })} className={inputCls} placeholder={t('tasks.link_label_ar_placeholder')} />
                                                <input value={lk.labelEn} onChange={(e) => updateLink(i, { labelEn: e.target.value })} className={inputCls} placeholder={t('tasks.link_label_en_placeholder')} />
                                            </div>
                                            <button type="button" onClick={() => setForm((f) => ({ ...f, links: f.links.filter((_, x) => x !== i) }))}
                                                className="inline-flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-400 text-red-700 dark:text-red-400 transition cursor-pointer">
                                                <Trash2 size={13} /> {t('common.delete')}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <button type="button" onClick={() => setForm((f) => ({ ...f, links: [...f.links, { url: '', labelAr: '', labelEn: '' }] }))}
                                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:text-accent transition cursor-pointer">
                                    <Plus size={15} /> {t('tasks.add_link')}
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.task_due_date')}</label>
                                    <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-ink-muted mb-1">{t('tasks.task_max_score')}</label>
                                    <input type="number" min={1} value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: e.target.value })} className={inputCls} />
                                </div>
                            </div>
                            <button onClick={saveTask} disabled={saving}
                                className="w-full inline-flex items-center justify-center gap-2 bg-brand-gold hover:bg-brand-gold-light text-ink-on-gold font-bold py-3.5 rounded-xl shadow-md transition disabled:opacity-50">
                                {saving ? t('common.saving') : t('tasks.save_task')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}