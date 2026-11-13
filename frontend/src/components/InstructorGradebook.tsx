"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import toast from 'react-hot-toast';
import { Download, Loader, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';

type SourceType = 'assessment' | 'task' | 'quiz' | 'attendance';

interface GradeCategory {
    id: string;
    nameAr: string;
    nameEn: string;
    weightPercent: number;
    orderIndex: number;
}

interface GradebookItem {
    id: string;
    sourceType: SourceType;
    sourceId: string;
    titleAr: string;
    titleEn: string;
    maxScore: number;
    categoryId: string | null;
    scores: Record<string, {
        score: number | null;
        originalScore: number | null;
        notes: string | null;
        overridden: boolean;
        status?: string;
    }>;
}

interface GradebookStudent {
    id: string;
    status: string;
    createdAt: string;
    student: { id: string; email: string; name: string | null };
}

interface GradebookData {
    categories: GradeCategory[];
    items: GradebookItem[];
    enrollments: GradebookStudent[];
    summary: Record<string, { percentage: number | null; coveragePercent: number }>;
}

interface CategoryDraft {
    id?: string;
    nameAr: string;
    nameEn: string;
    weightPercent: string;
}

const initialCategories: CategoryDraft[] = [
    { nameAr: 'الواجبات', nameEn: 'Assignments', weightPercent: '30' },
    { nameAr: 'الاختبارات', nameEn: 'Quizzes', weightPercent: '30' },
    { nameAr: 'الحضور والمشاركة', nameEn: 'Attendance & participation', weightPercent: '20' },
    { nameAr: 'أعمال أخرى', nameEn: 'Other work', weightPercent: '20' },
];

export default function InstructorGradebook({ openingId }: { openingId: string }) {
    const { locale } = useI18n();
    const isAr = locale === 'ar';
    const [data, setData] = useState<GradebookData | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingCategories, setSavingCategories] = useState(false);
    const [savingItems, setSavingItems] = useState(false);
    const [categoryDrafts, setCategoryDrafts] = useState<CategoryDraft[]>([]);
    const [categoryDirty, setCategoryDirty] = useState(false);
    const [itemCategories, setItemCategories] = useState<Record<string, string>>({});
    const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
    const [search, setSearch] = useState('');
    const [manualOpen, setManualOpen] = useState(false);
    const [manualNameAr, setManualNameAr] = useState('');
    const [manualNameEn, setManualNameEn] = useState('');
    const [manualMaxScore, setManualMaxScore] = useState('100');

    const load = useCallback(async () => {
        try {
            const response = await api.get(`/openings/${openingId}/gradebook`);
            const next = response.data as GradebookData;
            const nextCategoryDrafts = next.categories.length
                ? next.categories.map((category) => ({
                    id: category.id,
                    nameAr: category.nameAr,
                    nameEn: category.nameEn,
                    weightPercent: String(category.weightPercent),
                }))
                : initialCategories;
            setData(next);
            setItemCategories(Object.fromEntries(next.items.map((item) => [item.id, item.categoryId ?? ''])));
            setCategoryDrafts(nextCategoryDrafts);
            setCategoryDirty(next.categories.length === 0);
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر تحميل سجل الدرجات' : 'Could not load the gradebook'));
        } finally {
            setLoading(false);
        }
    }, [openingId, isAr]);

    // The effect fetches persisted server state and applies it after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void load(); }, [load]);

    const totalWeight = categoryDrafts.reduce((sum, category) => sum + (Number(category.weightPercent) || 0), 0);
    const filteredStudents = useMemo(() => (data?.enrollments ?? []).filter(({ student }) =>
        !search || `${student.name ?? ''} ${student.email}`.toLowerCase().includes(search.toLowerCase()),
    ), [data, search]);

    const categoryName = (id: string) => {
        const category = data?.categories.find((item) => item.id === id);
        return category ? (isAr ? category.nameAr : category.nameEn) : (isAr ? 'غير مصنف' : 'Uncategorized');
    };

    const saveCategories = async () => {
        if (Math.abs(totalWeight - 100) > 0.01 || categoryDrafts.length === 0) {
            toast.error(isAr ? 'يجب أن يكون مجموع أوزان الفئات 100٪' : 'Category weights must total 100%');
            return;
        }
        if (categoryDrafts.some(({ nameAr, nameEn, weightPercent }) =>
            !nameAr.trim() || !nameEn.trim() || !Number.isFinite(Number(weightPercent)) || Number(weightPercent) < 0,
        )) {
            toast.error(isAr ? 'أكمل أسماء الفئات وأوزانها' : 'Complete each category name and weight');
            return;
        }
        setSavingCategories(true);
        try {
            const response = await api.put(`/openings/${openingId}/gradebook/categories`, {
                categories: categoryDrafts.map((category) => ({
                    ...(category.id ? { id: category.id } : {}),
                    nameAr: category.nameAr.trim(),
                    nameEn: category.nameEn.trim(),
                    weightPercent: Number(category.weightPercent),
                })),
            });
            const categories = response.data as GradeCategory[];
            setData((current) => current ? { ...current, categories } : current);
            setCategoryDrafts(categories.map((category) => ({
                id: category.id,
                nameAr: category.nameAr,
                nameEn: category.nameEn,
                weightPercent: String(category.weightPercent),
            })));
            setCategoryDirty(false);
            toast.success(isAr ? 'تم حفظ الفئات والأوزان' : 'Categories and weights saved');
            void load();
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر حفظ الفئات' : 'Could not save categories'));
        } finally {
            setSavingCategories(false);
        }
    };

    const saveItemCategories = async () => {
        if (!data) return;
        if (categoryDirty) {
            toast.error(isAr ? 'احفظ الفئات أولًا قبل ربط عناصر الدرجات' : 'Save categories before assigning grade items');
            return;
        }
        setSavingItems(true);
        try {
            await api.put(`/openings/${openingId}/gradebook/items`, {
                items: data.items.map((item) => ({
                    sourceType: item.sourceType,
                    sourceId: item.sourceId,
                    categoryId: itemCategories[item.id] || null,
                })),
            });
            toast.success(isAr ? 'تم حفظ تصنيف عناصر الدرجات' : 'Grade item categories saved');
            void load();
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر حفظ تصنيف العناصر' : 'Could not save item categories'));
        } finally {
            setSavingItems(false);
        }
    };

    const draftKey = (studentId: string, itemId: string) => `${studentId}|${itemId}`;
    const scoreValue = (studentId: string, item: GradebookItem) => {
        const key = draftKey(studentId, item.id);
        if (scoreDrafts[key] !== undefined) return scoreDrafts[key];
        const score = item.scores[studentId]?.score;
        return score == null ? '' : String(score);
    };

    const saveScore = async (studentId: string, item: GradebookItem) => {
        const key = draftKey(studentId, item.id);
        const raw = scoreValue(studentId, item);
        const current = item.scores[studentId];
        if (raw === '') {
            if (item.sourceType === 'assessment' && current?.score !== null && current?.score !== undefined) {
                try {
                    await api.delete(`/grades/${studentId}/${item.sourceId}`);
                    toast.success(isAr ? 'تم حذف الدرجة' : 'Grade deleted');
                    setScoreDrafts((drafts) => { const next = { ...drafts }; delete next[key]; return next; });
                    void load();
                } catch (error) {
                    toast.error(getErrorMessage(error) || (isAr ? 'تعذر حذف الدرجة' : 'Could not delete grade'));
                }
            } else if (item.sourceType !== 'assessment' && current?.overridden) {
                try {
                    await api.delete(`/openings/${openingId}/gradebook/overrides/${studentId}/${item.sourceType}/${item.sourceId}`);
                    toast.success(isAr ? 'تمت استعادة الدرجة الأصلية' : 'Original grade restored');
                    setScoreDrafts((drafts) => { const next = { ...drafts }; delete next[key]; return next; });
                    void load();
                } catch (error) {
                    toast.error(getErrorMessage(error) || (isAr ? 'تعذرت استعادة الدرجة' : 'Could not restore the original grade'));
                }
            }
            return;
        }
        const score = Number(raw);
        if (!Number.isFinite(score) || score < 0 || score > item.maxScore) {
            toast.error(isAr ? `أدخل درجة بين 0 و ${item.maxScore}` : `Enter a score between 0 and ${item.maxScore}`);
            return;
        }
        if (current?.score !== null && current?.score !== undefined && Number(current.score) === score) {
            setScoreDrafts((drafts) => { const next = { ...drafts }; delete next[key]; return next; });
            return;
        }
        try {
            if (item.sourceType === 'assessment') {
                await api.put('/grades', { enrollmentId: studentId, assessmentId: item.sourceId, score });
            } else {
                await api.put(`/openings/${openingId}/gradebook/overrides`, {
                    enrollmentId: studentId,
                    sourceType: item.sourceType,
                    sourceId: item.sourceId,
                    score,
                    notes: current?.notes ?? undefined,
                });
            }
            toast.success(isAr ? 'تم حفظ الدرجة' : 'Grade saved');
            setScoreDrafts((drafts) => { const next = { ...drafts }; delete next[key]; return next; });
            void load();
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر حفظ الدرجة' : 'Could not save grade'));
        }
    };

    const restoreOriginal = async (studentId: string, item: GradebookItem) => {
        if (!window.confirm(isAr ? 'سيتم إلغاء التعديل وإظهار الدرجة الأصلية. هل تريد المتابعة؟' : 'Remove the override and restore the original grade?')) return;
        try {
            await api.delete(`/openings/${openingId}/gradebook/overrides/${studentId}/${item.sourceType}/${item.sourceId}`);
            toast.success(isAr ? 'تمت استعادة الدرجة الأصلية' : 'Original grade restored');
            setScoreDrafts((drafts) => { const next = { ...drafts }; delete next[draftKey(studentId, item.id)]; return next; });
            void load();
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذرت استعادة الدرجة' : 'Could not restore the original grade'));
        }
    };

    const addCategory = () => {
        setCategoryDrafts((current) => [...current, {
            nameAr: '',
            nameEn: '',
            weightPercent: '0',
        }]);
        setCategoryDirty(true);
    };

    const createManualAssessment = async () => {
        const maxScore = Number(manualMaxScore);
        if (!manualNameAr.trim() || !manualNameEn.trim() || !Number.isFinite(maxScore) || maxScore <= 0) {
            toast.error(isAr ? 'أدخل اسم العنصر والدرجة الكاملة بشكل صحيح' : 'Enter a valid item name and maximum score');
            return;
        }
        try {
            await api.post(`/openings/${openingId}/assessments`, {
                nameAr: manualNameAr.trim(),
                nameEn: manualNameEn.trim(),
                maxScore,
            });
            setManualOpen(false);
            setManualNameAr('');
            setManualNameEn('');
            toast.success(isAr ? 'تمت إضافة بند التقييم' : 'Manual grade item added');
            void load();
        } catch (error) {
            toast.error(getErrorMessage(error) || (isAr ? 'تعذر إضافة بند التقييم' : 'Could not add manual grade item'));
        }
    };

    const exportCsv = () => {
        if (!data) return;
        const headers = [
            isAr ? 'الطالب' : 'Student',
            ...data.items.map((item) => `${isAr ? item.titleAr : item.titleEn} (${item.maxScore})`),
            isAr ? 'النتيجة الحالية %' : 'Current grade %',
            isAr ? 'الأوزان المتاحة %' : 'Weight covered %',
        ];
        const rows = filteredStudents.map((enrollment) => {
            const summary = data.summary[enrollment.id];
            return [
                enrollment.student.name || enrollment.student.email,
                ...data.items.map((item) => item.scores[enrollment.id]?.score ?? ''),
                summary?.percentage == null ? '' : summary.percentage.toFixed(2),
                summary?.coveragePercent.toFixed(2) ?? '0',
            ];
        });
        const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'gradebook.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const labelForSource = (type: SourceType) => ({
        assessment: isAr ? 'يدوي' : 'Manual',
        task: isAr ? 'واجب' : 'Assignment',
        quiz: isAr ? 'اختبار' : 'Quiz',
        attendance: isAr ? 'حضور' : 'Attendance',
    })[type];

    if (loading && !data) return <div className="flex h-64 items-center justify-center text-accent"><Loader className="animate-spin" size={32} /></div>;
    if (!data) return null;

    return (
        <div className="space-y-5 rounded-3xl border border-line bg-surface-sunken p-4 sm:p-6 lg:p-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-ink">{isAr ? 'سجل الدرجات الشامل' : 'Unified gradebook'}</h2>
                    <p className="mt-1 text-sm text-ink-subtle">
                        {isAr
                            ? 'يجمع الاختبارات والواجبات والحضور والبنود اليدوية، ويحسب متوسط نسبة عناصر كل فئة. أفضل محاولة للاختبار هي المعتمدة، وتظل المحاولات والتسليمات الأصلية محفوظة.'
                            : 'Combines quizzes, assignments, attendance, and manual items. Items are averaged within each category; the best quiz attempt counts and original records stay unchanged.'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-bold text-ink">
                        <Download size={16} /> CSV
                    </button>
                    <button onClick={() => setManualOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-3 py-2 text-sm font-black text-brand-navy">
                        <Plus size={16} /> {isAr ? 'إضافة بند يدوي' : 'Add manual item'}
                    </button>
                </div>
            </header>

            {manualOpen && (
                <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <input value={manualNameAr} onChange={(event) => setManualNameAr(event.target.value)} placeholder="اسم البند بالعربية" className="rounded-xl border border-line bg-surface-sunken px-3 py-2 text-ink" />
                    <input value={manualNameEn} onChange={(event) => setManualNameEn(event.target.value)} placeholder="Item name in English" className="rounded-xl border border-line bg-surface-sunken px-3 py-2 text-ink" />
                    <input type="number" min="1" value={manualMaxScore} onChange={(event) => setManualMaxScore(event.target.value)} aria-label={isAr ? 'الدرجة الكاملة' : 'Maximum score'} className="rounded-xl border border-line bg-surface-sunken px-3 py-2 text-ink" />
                    <button onClick={() => void createManualAssessment()} className="rounded-xl bg-brand-gold px-3 py-2 font-black text-brand-navy">{isAr ? 'إضافة' : 'Create'}</button>
                </section>
            )}

            <section className="rounded-2xl border border-line bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="font-black text-ink">{isAr ? 'فئات الدرجات وأوزانها' : 'Grade categories and weights'}</h3>
                        <p className="text-xs text-ink-subtle">{isAr ? 'أوزان الفئات يجب أن تساوي 100٪. الدرجة المرحلية لا تعتبر غير المنجز صفرًا.' : 'Category weights must total 100%. Ungraded work is not automatically treated as zero.'}</p>
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-sm font-black ${Math.abs(totalWeight - 100) < 0.01 ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                        {isAr ? 'المجموع' : 'Total'}: {totalWeight.toFixed(2)}%
                    </span>
                </div>
                <div className="space-y-2">
                    {categoryDrafts.map((category, index) => (
                        <div key={category.id ?? `new-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_42px]">
                            <input value={category.nameAr} onChange={(event) => {
                                setCategoryDrafts((current) => current.map((item, i) => i === index ? { ...item, nameAr: event.target.value } : item));
                                setCategoryDirty(true);
                            }} placeholder="اسم الفئة بالعربية" className="min-w-0 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm text-ink" />
                            <input value={category.nameEn} onChange={(event) => {
                                setCategoryDrafts((current) => current.map((item, i) => i === index ? { ...item, nameEn: event.target.value } : item));
                                setCategoryDirty(true);
                            }} placeholder="Category name in English" className="min-w-0 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm text-ink" />
                            <div className="relative">
                                <input type="number" min="0" max="100" step="0.01" value={category.weightPercent} onChange={(event) => {
                                    setCategoryDrafts((current) => current.map((item, i) => i === index ? { ...item, weightPercent: event.target.value } : item));
                                    setCategoryDirty(true);
                                }} aria-label={isAr ? 'وزن الفئة بالمئة' : 'Category weight percent'} className="w-full rounded-xl border border-line bg-surface-sunken px-3 py-2 pe-8 text-sm text-ink" />
                                <span className="absolute end-3 top-2 text-sm text-ink-subtle">%</span>
                            </div>
                            <button onClick={() => {
                                setCategoryDrafts((current) => current.filter((_, i) => i !== index));
                                if (category.id) setItemCategories((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, value === category.id ? '' : value])));
                                setCategoryDirty(true);
                            }} aria-label={isAr ? 'حذف الفئة' : 'Remove category'} className="flex h-10 items-center justify-center rounded-xl border border-line text-red-600 hover:bg-red-500/10">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={addCategory} className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-sm font-bold text-ink">
                        <Plus size={15} /> {isAr ? 'فئة جديدة' : 'Add category'}
                    </button>
                    <button disabled={savingCategories || !categoryDirty} onClick={() => void saveCategories()} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-3 py-2 text-sm font-black text-brand-navy disabled:opacity-50">
                        {savingCategories ? <Loader className="animate-spin" size={15} /> : <Save size={15} />} {isAr ? 'حفظ الفئات' : 'Save categories'}
                    </button>
                </div>
            </section>

            {data.items.length > 0 && (
                <section className="rounded-2xl border border-line bg-surface p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="font-black text-ink">{isAr ? 'ربط عناصر التقييم بالفئات' : 'Assign grade items to categories'}</h3>
                            <p className="text-xs text-ink-subtle">{isAr ? 'اختر فئة لكل اختبار أو واجب أو جلسة حضور أو بند يدوي.' : 'Choose a category for each quiz, assignment, attendance session, or manual item.'}</p>
                        </div>
                        <button disabled={savingItems || categoryDirty || data.categories.length === 0} onClick={() => void saveItemCategories()} className="inline-flex items-center gap-2 rounded-xl bg-brand-gold px-3 py-2 text-sm font-black text-brand-navy disabled:opacity-50">
                            {savingItems ? <Loader className="animate-spin" size={15} /> : <Save size={15} />} {isAr ? 'حفظ التصنيفات' : 'Save assignments'}
                        </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {data.items.map((item) => (
                            <label key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-line bg-surface-sunken p-3">
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-bold text-ink">{isAr ? item.titleAr : item.titleEn}</span>
                                    <span className="text-xs text-ink-subtle">{labelForSource(item.sourceType)} · {item.maxScore}</span>
                                </span>
                                <select value={itemCategories[item.id] ?? ''} onChange={(event) => setItemCategories((current) => ({ ...current, [item.id]: event.target.value }))} className="max-w-[45%] rounded-lg border border-line bg-surface px-2 py-2 text-xs text-ink">
                                    <option value="">{isAr ? 'غير مصنف' : 'Uncategorized'}</option>
                                    {data.categories.map((category) => <option key={category.id} value={category.id}>{isAr ? category.nameAr : category.nameEn}</option>)}
                                </select>
                            </label>
                        ))}
                    </div>
                </section>
            )}

            <section className="rounded-2xl border border-line bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isAr ? 'ابحث عن طالب...' : 'Search students...'} className="w-full max-w-sm rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm text-ink" />
                    <span className="text-xs text-ink-subtle">
                        {isAr ? 'أفضل محاولة للاختبار · الحضور: حاضر 1، متأخر 0.5، غائب 0، معذور مستثنى' : 'Best quiz attempt · attendance: present 1, late 0.5, absent 0, excused excluded'}
                    </span>
                </div>
                {data.items.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-ink-subtle">
                        {isAr ? 'أضف بندًا يدويًا أو أنشئ اختبارًا أو واجبًا أو جلسة لعرض النتائج هنا.' : 'Add a manual item or create a quiz, assignment, or session to show grades here.'}
                    </div>
                ) : filteredStudents.length === 0 ? (
                    <div className="p-8 text-center text-sm text-ink-subtle">{isAr ? 'لا يوجد طلاب مطابقون للبحث.' : 'No students match this search.'}</div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-line">
                        <table className="min-w-full border-collapse text-start text-sm">
                            <thead className="bg-surface-sunken text-xs text-ink-subtle">
                                <tr>
                                    <th className="sticky start-0 z-10 min-w-52 bg-surface-sunken p-3 text-start">{isAr ? 'الطالب' : 'Student'}</th>
                                    {data.items.map((item) => (
                                        <th key={item.id} className="min-w-36 p-3 text-center">
                                            <span className="block max-w-48 truncate font-black text-ink">{isAr ? item.titleAr : item.titleEn}</span>
                                            <span className="block text-[11px] font-normal">{categoryName(itemCategories[item.id] || item.categoryId || '')} · /{item.maxScore}</span>
                                        </th>
                                    ))}
                                    <th className="min-w-32 p-3 text-center">{isAr ? 'النتيجة المرحلية' : 'Current grade'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map((enrollment) => {
                                    const summary = data.summary[enrollment.id];
                                    return (
                                        <tr key={enrollment.id} className="border-t border-line">
                                            <td className="sticky start-0 z-10 bg-surface p-3">
                                                <span className="block max-w-52 truncate font-bold text-ink">{enrollment.student.name || enrollment.student.email}</span>
                                                {enrollment.student.name && <span className="block max-w-52 truncate text-xs text-ink-subtle">{enrollment.student.email}</span>}
                                            </td>
                                            {data.items.map((item) => {
                                                const current = item.scores[enrollment.id];
                                                const key = draftKey(enrollment.id, item.id);
                                                return (
                                                    <td key={item.id} className="p-2 text-center">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max={item.maxScore}
                                                                step="any"
                                                                value={scoreValue(enrollment.id, item)}
                                                                onChange={(event) => setScoreDrafts((drafts) => ({ ...drafts, [key]: event.target.value }))}
                                                                onBlur={() => void saveScore(enrollment.id, item)}
                                                                aria-label={`${isAr ? 'درجة' : 'Score'} ${isAr ? item.titleAr : item.titleEn} ${enrollment.student.email}`}
                                                                className="w-20 rounded-lg border border-line bg-surface-sunken px-2 py-1.5 text-center text-sm text-ink outline-none focus:border-brand-gold"
                                                            />
                                                            {current?.overridden && item.sourceType !== 'assessment' && (
                                                                <button onClick={() => void restoreOriginal(enrollment.id, item)} title={isAr ? 'استعادة الدرجة الأصلية' : 'Restore original grade'} className="rounded-md p-1 text-amber-700 hover:bg-amber-500/10">
                                                                    <RotateCcw size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                        {current?.overridden && <span className="mt-1 block text-[10px] font-bold text-amber-700">{isAr ? 'معدّلة' : 'Overridden'}</span>}
                                                        {current?.status === 'EXCUSED' && <span className="mt-1 block text-[10px] text-ink-subtle">{isAr ? 'معذور' : 'Excused'}</span>}
                                                    </td>
                                                );
                                            })}
                                            <td className="p-3 text-center">
                                                <span className="block font-black text-ink">{summary?.percentage == null ? '—' : `${summary.percentage.toFixed(1)}%`}</span>
                                                <span className="text-[11px] text-ink-subtle">{isAr ? 'مكتمل الوزن' : 'Weight covered'}: {summary?.coveragePercent.toFixed(0) ?? '0'}%</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
