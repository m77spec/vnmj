"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getErrorMessage, isUnauthorized } from '@/lib/api';
import {
    AlertTriangle, Check, KeyRound, Loader2, Lock, ShieldAlert, ShieldCheck, Trash2, UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ types */

/**
 * Mirrors `GET /api/admin/operations/settings`. Nothing here is a password or a hash: the
 * API returns only whether a password EXISTS, never any material derived from it.
 */
interface SettingsState {
    hasPassword: boolean;
    keyVersion: number;
    allowlistEmpty: boolean;
    allowlistSize: number;
    allowlist: AllowlistEntry[];
    eligible: EligibleAdmin[];
    /** True while OPERATIONS_KEY alone still opens the page. */
    envFallbackActive: boolean;
}

interface AllowlistEntry {
    id: string;
    userId: string;
    email: string;
    role: string;
    isActive: boolean;
    /** False for a listed admin who has since been demoted: the row grants nothing. */
    effective: boolean;
    grantedById: string | null;
    createdAt: string;
}

interface EligibleAdmin {
    id: string;
    email: string;
}

const MIN_PASSWORD_LENGTH = 12;

const inputClass =
    'w-full px-3.5 py-2.5 border border-gray-300 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white placeholder:text-gray-400 focus:ring-2 focus:ring-brand-gold focus:border-brand-gold outline-none transition';

/* ------------------------------------------------------------------- panel */

export default function OperationsSettingsPanel({
    headers, t, onGrantLost,
}: {
    headers: Record<string, string> | undefined;
    t: (k: string) => string;
    /** Called when the server says the grant is gone, so the page can re-lock. */
    onGrantLost: () => void;
}) {
    const [settings, setSettings] = useState<SettingsState | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const [pwError, setPwError] = useState<string | null>(null);
    const [showFields, setShowFields] = useState(false);

    const [picker, setPicker] = useState('');
    const [mutating, setMutating] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await api.get('/api/admin/operations/settings', { headers });
            setSettings(res.data);
            setLoadError(null);
        } catch (err) {
            // A dead grant must drop back to the lock screen, not sit here as an
            // error on a panel the operator is about to type a new password into.
            if (isUnauthorized(err)) {
                onGrantLost();
                return;
            }
            setLoadError(getErrorMessage(err) || t('ops.settings_load_failed'));
        } finally {
            setLoading(false);
        }
    }, [headers, onGrantLost, t]);

    // Fetching from the API is the external-system case effects exist for, and
    // matches how the rest of this page loads. The state is written only after
    // the response resolves, never during render.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    /** Password fields are cleared after any attempt, so a failed submit never
     * leaves a password sitting in the DOM. */
    const clearFields = () => {
        setCurrent('');
        setNext('');
        setConfirm('');
    };

    const changePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPwError(null);
        setNotice(null);

        // The same three rules the server enforces, checked here so the obvious
        // mistakes never cost a round trip. The server is still the authority:
        // client-side checks are a convenience, never a control.
        if (next.length < MIN_PASSWORD_LENGTH) {
            setPwError(t('ops.pw_weak'));
            return;
        }
        if (next !== confirm) {
            setPwError(t('ops.pw_match_fail'));
            return;
        }
        if (next === current) {
            setPwError(t('ops.pw_same_fail'));
            return;
        }

        setSaving(true);
        try {
            await api.post('/api/admin/operations/settings/password', { currentPassword: current, newPassword: next, confirmPassword: confirm }, { headers });
            clearFields();
            setShowFields(false);
            setNotice({ tone: 'good', text: t('ops.pw_changed') });
            // Reload because the panel's whole point is to show which credential is
            // now authoritative; leaving "using the environment variable" on screen
            // after a successful change would be a lie.
            await load();
        } catch (err) {
            clearFields();
            setPwError(isUnauthorized(err) ? t('ops.pw_wrong_current') : (getErrorMessage(err) || t('ops.pw_failed')));
        } finally {
            setSaving(false);
        }
    };

    const addAdmin = async () => {
        if (!picker) return;
        setMutating(true);
        setNotice(null);
        try {
            const res = await api.post('/api/admin/operations/settings/allowlist', { userId: picker }, { headers });
            setPicker('');
            setNotice({ tone: 'good', text: res.data?.alreadyPresent ? t('ops.allow_already') : t('ops.allow_added') });
            await load();
        } catch (err) {
            if (isUnauthorized(err)) onGrantLost();
            else setNotice({ tone: 'bad', text: getErrorMessage(err) || t('ops.allow_failed') });
        } finally {
            setMutating(false);
        }
    };

    const removeAdmin = async (userId: string) => {
        if (!window.confirm(t('ops.allow_confirm_remove'))) return;
        setMutating(true);
        setNotice(null);
        try {
            await api.delete(`/api/admin/operations/settings/allowlist/${userId}`, { headers });
            setNotice({ tone: 'good', text: t('ops.allow_removed') });
            await load();
        } catch (err) {
            if (isUnauthorized(err)) onGrantLost();
            else setNotice({ tone: 'bad', text: getErrorMessage(err) || t('ops.allow_failed') });
        } finally {
            setMutating(false);
        }
    };

    const eligible = settings?.eligible ?? [];
    const allowlist = settings?.allowlist ?? [];
    const status = useMemo(() => {
        if (!settings) return null;
        return settings.hasPassword ? t('ops.pw_stored') : t('ops.pw_set');
    }, [settings, t]);

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-3 py-20 text-gray-500 dark:text-gray-400">
                <Loader2 size={22} className="animate-spin" />
                <span className="text-sm font-bold">{t('common.loading')}</span>
            </div>
        );
    }

    if (loadError || !settings) {
        return (
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm font-bold text-red-700 dark:text-red-400">{loadError || t('ops.settings_load_failed')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {notice && (
                <div className={`flex items-start gap-3 p-4 border rounded-xl ${
                    notice.tone === 'good'
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                        : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
                }`}>
                    {notice.tone === 'good'
                        ? <Check size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                        : <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />}
                    <p className={`text-sm font-bold ${notice.tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                        {notice.text}
                    </p>
                </div>
            )}

            {/* ---------------------------------------------- password */}
            <Card
                icon={KeyRound}
                title={t('ops.pw_title')}
                subtitle={t('ops.pw_subtitle')}
                badge={<StatusBadge tone={settings.hasPassword ? 'green' : 'amber'} label={status!} />}
            >
                {/*
                  This warning is the whole point of the settings page. While the
                  env variable is still authoritative, the password the owner just
                  set would be ignored -- so the UI says so instead of letting them
                  believe the deployment is tighter than it is.
                */}
                {settings.envFallbackActive && (
                    <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl mb-5">
                        <ShieldAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-black text-amber-800 dark:text-amber-400">{t('ops.pw_warning_title')}</p>
                            <p className="text-xs text-amber-700 dark:text-amber-300/90 mt-1 leading-relaxed">{t('ops.pw_warning_body')}</p>
                        </div>
                    </div>
                )}

                {!settings.hasPassword && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">{t('ops.pw_none_yet')}</p>
                )}

                {!showFields ? (
                    <button
                        type="button"
                        onClick={() => setShowFields(true)}
                        data-ops-action="operations.settings.password_open"
                        className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-light hover:to-brand-gold text-black px-4 py-2.5 rounded-xl text-sm font-black shadow-lg shadow-brand-gold/25 transition-all cursor-pointer"
                    >
                        <KeyRound size={16} />
                        {t('ops.pw_change')}
                    </button>
                ) : (
                    <form onSubmit={changePassword} className="space-y-4 max-w-lg">
                        <Field label={t('ops.pw_current')} hint={t('ops.pw_current_hint')}>
                            <input
                                type="password"
                                autoComplete="off"
                                value={current}
                                onChange={e => setCurrent(e.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label={t('ops.pw_new')} hint={t('ops.pw_new_hint')}>
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={next}
                                onChange={e => setNext(e.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label={t('ops.pw_confirm')}>
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={confirm}
                                onChange={e => setConfirm(e.target.value)}
                                className={inputClass}
                            />
                        </Field>

                        {pwError && (
                            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                                <AlertTriangle size={17} className="text-red-500 shrink-0 mt-0.5" />
                                <p className="text-sm font-bold text-red-700 dark:text-red-400">{pwError}</p>
                            </div>
                        )}

                        <div className="flex items-center gap-2.5">
                            <button
                                type="submit"
                                disabled={saving}
                                data-ops-action="operations.settings.password_save"
                                className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark hover:from-brand-gold-light hover:to-brand-gold text-black px-4 py-2.5 rounded-xl text-sm font-black shadow-lg shadow-brand-gold/25 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                                {saving ? t('ops.pw_changing') : t('ops.pw_change')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowFields(false); clearFields(); setPwError(null); }}
                                className="px-4 py-2.5 rounded-xl text-sm font-bold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 transition cursor-pointer"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </form>
                )}
            </Card>

            {/* ---------------------------------------------- allowlist */}
            <Card
                icon={ShieldCheck}
                title={t('ops.allow_title')}
                subtitle={`${t('ops.allow_count')}: ${allowlist.length}`}
                badge={settings.allowlistEmpty
                    ? <StatusBadge tone="amber" label={t('ops.allow_empty_warning')} />
                    : <StatusBadge tone="green" label={t('ops.allow_narrowed')} />}
            >
                <div className="flex flex-wrap items-center gap-2.5 mb-5">
                    <select
                        value={picker}
                        onChange={e => setPicker(e.target.value)}
                        disabled={mutating || eligible.length === 0}
                        className="px-3 py-2.5 border border-gray-300 dark:border-white/10 rounded-xl text-sm bg-white dark:bg-brand-navy-dark text-brand-navy dark:text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-gold font-bold disabled:opacity-50"
                    >
                        <option value="">{t('ops.allow_picker')}</option>
                        {eligible.map(a => (
                            <option key={a.id} value={a.id}>{a.email}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={addAdmin}
                        disabled={mutating || !picker}
                        data-ops-action="operations.settings.allow_add"
                        className="inline-flex items-center gap-2 bg-brand-navy-light hover:bg-brand-navy text-white px-4 py-2.5 rounded-xl text-sm font-black transition disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                    >
                        {mutating ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                        {t('ops.allow_add')}
                    </button>
                    {eligible.length === 0 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{t('ops.allow_none_eligible')}</span>
                    )}
                </div>

                {allowlist.length === 0 ? (
                    <div className="py-8 text-center">
                        <p className="text-sm font-bold text-gray-500 dark:text-gray-400">{t('ops.allow_empty_warning')}</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-white/5">
                        {allowlist.map(entry => (
                            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-black text-brand-navy dark:text-white truncate">{entry.email}</span>
                                        {entry.grantedById && (
                                            <span className="text-[10px] font-bold text-gray-400">
                                                {t('ops.allow_granted_by')} {entry.grantedById.slice(0, 8)}
                                            </span>
                                        )}
                                        {!entry.isActive && (
                                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                                {t('ops.allow_inactive')}
                                            </span>
                                        )}
                                        {!entry.effective && (
                                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                                {entry.isActive ? t('ops.allow_not_admin') : t('ops.allow_inactive')}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                        {new Date(entry.createdAt).toLocaleString()}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeAdmin(entry.userId)}
                                    disabled={mutating}
                                    data-ops-action="operations.settings.allow_remove"
                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 hover:bg-red-50 dark:hover:bg-red-500/10 transition disabled:opacity-50 cursor-pointer"
                                >
                                    <Trash2 size={14} />
                                    {t('ops.allow_remove')}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}

/* ------------------------------------------------------------- sub-views */

function Card({
    icon: Icon, title, subtitle, badge, children,
}: {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    badge?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="bg-white dark:bg-brand-navy-dark border border-gray-200/80 dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgba(15,42,67,0.05)] hover:shadow-[0_14px_36px_rgba(15,42,67,0.08)] transition-shadow">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-gold/20 to-brand-gold/5 ring-1 ring-brand-gold/10 text-brand-gold-dark dark:text-brand-gold-light flex items-center justify-center shrink-0">
                        <Icon size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-brand-navy dark:text-white">{title}</h3>
                        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
                    </div>
                </div>
                {badge}
            </div>
            {children}
        </section>
    );
}

function StatusBadge({ tone, label }: { tone: 'green' | 'amber'; label: string }) {
    const tones = {
        green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    };
    return (
        <span className={`text-[11px] font-black px-2.5 py-1 rounded-lg max-w-xs text-start ${tones[tone]}`}>
            {label}
        </span>
    );
}

function Field({
    label, hint, children,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <label className="block text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                {label}
            </label>
            {children}
            {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">{hint}</p>}
        </div>
    );
}
