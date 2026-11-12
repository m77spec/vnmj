"use client";

import { useEffect, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { BookOpen, Loader, Plus, Save } from 'lucide-react';

interface Outcome {
    descriptionAr: string;
    descriptionEn: string;
}

interface OpeningLesson {
    id: string;
    titleAr: string;
    titleEn: string;
    descriptionAr?: string | null;
    descriptionEn?: string | null;
    videoUrl?: string | null;
    durationMinutes?: number | null;
    files?: unknown[] | null;
    links?: unknown[] | null;
    outcomes?: Outcome[] | null;
}

interface LessonForm {
    titleAr: string;
    titleEn: string;
    descriptionAr: string;
    descriptionEn: string;
    videoUrl: string;
    durationMinutes: string;
    files: { url: string; nameAr: string; nameEn: string }[];
    links: string;
    outcomes: string;
}

const emptyForm = (): LessonForm => ({
    titleAr: '',
    titleEn: '',
    descriptionAr: '',
    descriptionEn: '',
    videoUrl: '',
    durationMinutes: '',
    files: [],
    links: '',
    outcomes: '',
});

const linesFrom = (items: unknown[] | null | undefined, fields: string[]) => (items || []).map((item) => {
    if (!item || typeof item !== 'object') return String(item ?? '');
    const record = item as Record<string, unknown>;
    return fields.map((field) => String(record[field] ?? '')).join(' | ');
}).join('\n');

const itemsFrom = (value: string, fields: string[]) => value.split(/\r?\n/)
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => parts.some(Boolean))
    .map((parts) => Object.fromEntries(fields.map((field, index) => [field, parts[index] || ''])));

const toForm = (lesson: OpeningLesson): LessonForm => ({
    titleAr: lesson.titleAr || '',
    titleEn: lesson.titleEn || '',
    descriptionAr: lesson.descriptionAr || '',
    descriptionEn: lesson.descriptionEn || '',
    videoUrl: lesson.videoUrl || '',
    durationMinutes: lesson.durationMinutes == null ? '' : String(lesson.durationMinutes),
    files: (lesson.files || []).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const file = item as Record<string, unknown>;
        return typeof file.url === 'string' ? [{
            url: file.url,
            nameAr: typeof file.nameAr === 'string' ? file.nameAr : '',
            nameEn: typeof file.nameEn === 'string' ? file.nameEn : '',
        }] : [];
    }),
    links: linesFrom(lesson.links, ['url', 'labelAr', 'labelEn']),
    outcomes: linesFrom(lesson.outcomes, ['descriptionAr', 'descriptionEn']),
});

export default function OpeningContentEditor({ openingId }: { openingId: string }) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [lessons, setLessons] = useState<OpeningLesson[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [form, setForm] = useState<LessonForm>(emptyForm);
    const [creating, setCreating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
    const [uploadingFile, setUploadingFile] = useState(false);
    const t = (ar: string, en: string) => isAr ? ar : en;

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const response = await api.get(`/lms/openings/${openingId}/modules`);
                if (!active) return;
                setLessons(response.data);
                if (response.data[0]) {
                    setSelectedId(response.data[0].id);
                    setForm(toForm(response.data[0]));
                }
            } catch (error) {
                if (active) setMessage({ text: getErrorMessage(error) || (isAr ? 'تعذر تحميل محتوى الدفعة.' : 'Could not load this batch content.'), error: true });
            } finally {
                if (active) setLoading(false);
            }
        };
        void load();
        return () => { active = false; };
    }, [openingId, isAr]);

    const selectLesson = (lesson: OpeningLesson) => {
        setSelectedId(lesson.id);
        setCreating(false);
        setForm(toForm(lesson));
        setMessage(null);
    };

    const startNew = () => {
        setCreating(true);
        setSelectedId(null);
        setForm(emptyForm());
        setMessage(null);
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.titleAr.trim() || !form.titleEn.trim()) {
            setMessage({ text: t('أدخل عنوان الدرس بالعربية والإنجليزية.', 'Enter the lesson title in Arabic and English.'), error: true });
            return;
        }
        const files = form.files.filter((file) => file.url.trim()).map((file) => ({
            ...file,
            url: file.url.trim(),
            nameAr: file.nameAr.trim(),
            nameEn: file.nameEn.trim(),
        }));
        const links = itemsFrom(form.links, ['url', 'labelAr', 'labelEn']);
        const outcomes = itemsFrom(form.outcomes, ['descriptionAr', 'descriptionEn'])
            .map((outcome) => ({ descriptionAr: outcome.descriptionAr || '', descriptionEn: outcome.descriptionEn || '' }));
        const duration = form.durationMinutes ? Number(form.durationMinutes) : null;
        if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 10000)) {
            setMessage({ text: t('مدة الدرس غير صحيحة.', 'Lesson duration is invalid.'), error: true });
            return;
        }
        const payload = {
            titleAr: form.titleAr.trim(),
            titleEn: form.titleEn.trim(),
            descriptionAr: form.descriptionAr || null,
            descriptionEn: form.descriptionEn || null,
            videoUrl: form.videoUrl.trim() || null,
            durationMinutes: duration,
            files,
            links,
            outcomes,
        };
        setSaving(true);
        setMessage(null);
        try {
            let saved: OpeningLesson;
            if (creating) {
                const response = await api.post(`/lms/openings/${openingId}/modules`, payload);
                saved = response.data;
                setLessons((current) => [...current, saved]);
            } else if (selectedId) {
                await api.patch(`/lms/openings/${openingId}/modules/${selectedId}`, payload);
                saved = { id: selectedId, ...payload };
                setLessons((current) => current.map((lesson) => lesson.id === selectedId ? saved : lesson));
            } else {
                return;
            }
            setCreating(false);
            setSelectedId(saved.id);
            setForm(toForm(saved));
            setMessage({ text: t('تم حفظ التعديلات في هذه الدفعة فقط.', 'Changes saved for this batch only.'), error: false });
        } catch (error) {
            setMessage({ text: getErrorMessage(error) || t('تعذر حفظ المحتوى.', 'Could not save content.'), error: true });
        } finally {
            setSaving(false);
        }
    };

    const uploadLessonFile = async (file: File | undefined) => {
        if (!file) return;
        const body = new FormData();
        body.append('file', file);
        setUploadingFile(true);
        setMessage(null);
        try {
            const response = await api.post(`/lms/openings/${openingId}/modules/files`, body, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setForm((current) => ({
                ...current,
                files: [...current.files, {
                    url: response.data.url,
                    nameAr: response.data.name,
                    nameEn: response.data.name,
                }],
            }));
        } catch (error) {
            setMessage({ text: getErrorMessage(error) || t('تعذر رفع الملف.', 'Could not upload the file.'), error: true });
        } finally {
            setUploadingFile(false);
        }
    };

    const field = 'w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-gold/60 placeholder:text-gray-500';

    if (loading) return <div className="flex justify-center rounded-2xl bg-brand-navy-dark p-10"><Loader className="animate-spin text-brand-gold-light" /></div>;

    return (
        <section className="space-y-4 rounded-2xl border border-white/5 bg-brand-navy-dark p-4 sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gold/10 text-brand-gold-light"><BookOpen size={20} /></span>
                    <div>
                        <h3 className="font-black text-white">{t('محتوى الدروس لهذه الدفعة', 'Lessons for this batch')}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-gray-400">
                            {t('التعديلات محفوظة للدفعة الحالية فقط. محتوى الدورة الرئيسية والدفعات الأخرى لا يتغير.', 'Edits are isolated to this batch. The main course and other batches are not changed.')}
                        </p>
                    </div>
                </div>
                <button type="button" onClick={startNew} className="inline-flex items-center gap-2 rounded-xl border border-brand-gold/30 px-3.5 py-2 text-sm font-bold text-brand-gold-light hover:bg-brand-gold/10">
                    <Plus size={16} /> {t('إضافة درس للدفعة', 'Add batch lesson')}
                </button>
            </header>

            {message && <p role="status" className={`rounded-xl border px-4 py-3 text-sm font-semibold ${message.error ? 'border-red-400/20 bg-red-500/10 text-red-300' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'}`}>{message.text}</p>}

            <div className="grid min-w-0 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
                {lessons.length > 0 && (
                    <label className="block lg:hidden">
                        <span className="mb-2 block text-xs font-bold text-gray-400">
                            {t('اختر درسًا للتعديل', 'Choose a lesson to edit')}
                        </span>
                        <select
                            value={creating ? '__new__' : selectedId ?? ''}
                            onChange={(event) => {
                                if (event.target.value === '__new__') {
                                    startNew();
                                    return;
                                }
                                const lesson = lessons.find((item) => item.id === event.target.value);
                                if (lesson) selectLesson(lesson);
                            }}
                            className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm font-bold text-white outline-none focus:border-brand-gold/60 [&>option]:bg-brand-navy"
                        >
                            {creating && (
                                <option value="__new__">{t('درس جديد خاص بالدفعة', 'New batch-only lesson')}</option>
                            )}
                            {lessons.map((lesson, index) => (
                                <option key={lesson.id} value={lesson.id}>
                                    {index + 1}. {isAr ? lesson.titleAr : lesson.titleEn}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <nav className="hidden space-y-2 lg:block">
                    {lessons.map((lesson, index) => (
                        <button key={lesson.id} type="button" onClick={() => selectLesson(lesson)} className={`w-full rounded-xl border px-3 py-3 text-start text-sm font-bold ${selectedId === lesson.id && !creating ? 'border-brand-gold/40 bg-brand-gold/10 text-white' : 'border-white/5 text-gray-300 hover:bg-white/5'}`}>
                            <span className="me-2 text-brand-gold-light">{index + 1}.</span>{isAr ? lesson.titleAr : lesson.titleEn}
                        </button>
                    ))}
                    {lessons.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-gray-500">{t('لم تتم إضافة دروس بعد.', 'No lessons have been added yet.')}</p>}
                </nav>
                {lessons.length === 0 && (
                    <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-gray-500 lg:hidden">
                        {t('لم تتم إضافة دروس بعد.', 'No lessons have been added yet.')}
                    </p>
                )}

                {(creating || selectedId) && (
                    <form onSubmit={save} className="space-y-4 rounded-xl border border-white/5 bg-black/10 p-4">
                        <h4 className="font-black text-white">{creating ? t('درس جديد خاص بالدفعة', 'New batch-only lesson') : t('تعديل محتوى الدرس', 'Edit lesson content')}</h4>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1.5 text-xs font-bold text-gray-300">{t('العنوان بالعربية', 'Title in Arabic')}<input className={field} required value={form.titleAr} onChange={(event) => setForm({ ...form, titleAr: event.target.value })} /></label>
                            <label className="space-y-1.5 text-xs font-bold text-gray-300">{t('العنوان بالإنجليزية', 'Title in English')}<input className={field} required value={form.titleEn} onChange={(event) => setForm({ ...form, titleEn: event.target.value })} /></label>
                            <label className="space-y-1.5 text-xs font-bold text-gray-300">{t('الوصف بالعربية', 'Description in Arabic')}<textarea className={field} rows={3} value={form.descriptionAr} onChange={(event) => setForm({ ...form, descriptionAr: event.target.value })} /></label>
                            <label className="space-y-1.5 text-xs font-bold text-gray-300">{t('الوصف بالإنجليزية', 'Description in English')}<textarea className={field} rows={3} value={form.descriptionEn} onChange={(event) => setForm({ ...form, descriptionEn: event.target.value })} /></label>
                            <label className="space-y-1.5 text-xs font-bold text-gray-300">{t('رابط الفيديو أو التسجيل', 'Video or recording URL')}<input className={field} type="url" value={form.videoUrl} onChange={(event) => setForm({ ...form, videoUrl: event.target.value })} /></label>
                            <label className="space-y-1.5 text-xs font-bold text-gray-300">{t('المدة بالدقائق', 'Duration in minutes')}<input className={field} type="number" min={0} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-3">
                            {([
                                ['links', t('الروابط', 'Links'), t('الرابط | العنوان بالعربية | العنوان بالإنجليزية', 'URL | Arabic label | English label')],
                                ['outcomes', t('مخرجات التعلم', 'Learning outcomes'), t('الوصف بالعربية | الوصف بالإنجليزية', 'Arabic description | English description')],
                            ] as const).map(([key, label]) => (
                                <label key={key} className="space-y-1.5 text-xs font-bold text-gray-300">{label}
                                    <textarea dir="auto" spellCheck={false} className={field} rows={5} placeholder={key === 'outcomes' ? label : undefined} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
                                    <span className="block font-normal text-gray-500">{label} — {key === 'links' ? t('كل رابط في سطر مستقل', 'One link per line') : t('كل مخرج تعلم في سطر مستقل', 'One learning outcome per line')}</span>
                                </label>
                            ))}
                        </div>
                        <div className="space-y-2 rounded-xl border border-white/5 bg-black/10 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-bold text-gray-300">{t('مرفقات الدرس', 'Lesson attachments')}</span>
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-gold/30 px-3 py-2 text-xs font-bold text-brand-gold-light hover:bg-brand-gold/10">
                                    {uploadingFile ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                                    {uploadingFile ? t('جارٍ الرفع...', 'Uploading...') : t('رفع ملف', 'Upload file')}
                                    <input
                                        type="file"
                                        className="sr-only"
                                        disabled={uploadingFile}
                                        onChange={(event) => {
                                            void uploadLessonFile(event.target.files?.[0]);
                                            event.currentTarget.value = '';
                                        }}
                                    />
                                </label>
                            </div>
                            {form.files.length === 0 ? (
                                <p className="text-xs text-gray-500">{t('لم تتم إضافة مرفقات.', 'No attachments added.')}</p>
                            ) : form.files.map((file, index) => (
                                <div key={`${file.url}-${index}`} className="grid gap-2 rounded-lg border border-white/5 p-2 sm:grid-cols-[1fr_1fr_auto]">
                                    <input className={field} value={file.nameAr} aria-label={t('اسم الملف بالعربية', 'File name in Arabic')} onChange={(event) => setForm((current) => ({ ...current, files: current.files.map((item, i) => i === index ? { ...item, nameAr: event.target.value } : item) }))} />
                                    <input className={field} value={file.nameEn} aria-label={t('اسم الملف بالإنجليزية', 'File name in English')} onChange={(event) => setForm((current) => ({ ...current, files: current.files.map((item, i) => i === index ? { ...item, nameEn: event.target.value } : item) }))} />
                                    <button type="button" className="rounded-lg px-3 text-xs font-bold text-red-300 hover:bg-red-500/10" onClick={() => setForm((current) => ({ ...current, files: current.files.filter((_, i) => i !== index) }))}>{t('حذف', 'Remove')}</button>
                                    <a className="truncate text-xs text-gray-500 underline sm:col-span-2" href={file.url} target="_blank" rel="noreferrer">{file.url}</a>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end border-t border-white/5 pt-4">
                            <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-5 py-2.5 text-sm font-black text-black disabled:opacity-60">
                                {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
                                {t('حفظ في هذه الدفعة', 'Save to this batch')}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </section>
    );
}
