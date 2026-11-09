"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import { Loader, Send, MessageSquarePlus, X, Inbox as InboxIcon, Settings, Check, Search } from 'lucide-react';
import { PageHeader } from '@/app/dashboard/admin/components';

interface Conv {
    id: string;
    otherUser: { id: string; nameAr?: string | null; nameEn?: string | null; role: string };
    course: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    opening?: { id: string } | null;
    lastMessage: { content: string; createdAt: string; fromMe: boolean; read: boolean };
    unreadCount: number;
    updatedAt: string;
}
interface ThreadMsg {
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    readAt?: string | null;
}
interface Contact {
    id: string;
    nameAr?: string | null;
    nameEn?: string | null;
    role: string;
    course?: { id: string; titleAr?: string | null; titleEn?: string | null } | null;
    openingId?: string | null;
    requestId?: string | null;
    requestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | null;
    requestDirection?: 'INCOMING' | 'OUTGOING' | null;
}
interface Contacts {
    admins: Contact[];
    instructors: Contact[];
    students: Contact[];
}

const roleLabel: Record<string, string> = {
    STUDENT: 'roles.student',
    INSTRUCTOR: 'roles.instructor',
    COURSE_MANAGER: 'roles.course_manager',
    FINANCE: 'roles.finance',
    ADMIN: 'roles.admin',
};

export default function InboxPage() {
    const { t, pick, locale } = useI18n();
    const { user } = useAuth();
    const [conversations, setConversations] = useState<Conv[]>([]);
    const [loadingConv, setLoadingConv] = useState(true);
    const [active, setActive] = useState<Conv | null>(null);
    const [thread, setThread] = useState<ThreadMsg[]>([]);
    const [loadingThread, setLoadingThread] = useState(false);
    const [text, setText] = useState('');
    const [conversationSearch, setConversationSearch] = useState('');
    const [sending, setSending] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [nameSettingsOpen, setNameSettingsOpen] = useState(false);
    const [loadingNameSettings, setLoadingNameSettings] = useState(false);
    const [savingNameSettings, setSavingNameSettings] = useState(false);
    const [inboxDisplayName, setInboxDisplayName] = useState('');
    const [inboxUseOfficialName, setInboxUseOfficialName] = useState(true);
    const [contacts, setContacts] = useState<Contacts>({ admins: [], instructors: [], students: [] });
    const threadBoxRef = useRef<HTMLDivElement>(null);

    const loadConversations = useCallback(async () => {
        try {
            const res = await api.get('/messages/conversations');
            setConversations(res.data);
        } catch {
            /* keep silent on polling */
        } finally {
            setLoadingConv(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            try {
                const res = await api.get('/messages/conversations');
                if (active) setConversations(res.data);
            } catch {
                /* keep silent on polling */
            } finally {
                if (active) setLoadingConv(false);
            }
        };
        refresh();
        const timer = setInterval(refresh, 10000);
        return () => { active = false; clearInterval(timer); };
    }, []);

    const openThread = useCallback(async (conv: Conv, markRead: boolean) => {
        setActive(conv);
        setLoadingThread(true);
        const params = new URLSearchParams({ with: conv.otherUser.id });
        if (conv.course) params.set('courseId', conv.course.id);
        if (conv.opening?.id) params.set('openingId', conv.opening.id);
        try {
            const res = await api.get(`/messages/thread?${params.toString()}`);
            setThread(res.data);
            if (markRead && conv.unreadCount > 0) {
                await api.patch(`/messages/read?${params.toString()}`);
                loadConversations();
            }
        } catch (err) {
            toast.error(getErrorMessage(err) || t('inbox.message_fail'));
        }
        setLoadingThread(false);
    }, [loadConversations, t]);

    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => { openThread(active, false); }, 10000);
        return () => clearInterval(timer);
    }, [active, openThread]);

    useEffect(() => {
        if (threadBoxRef.current) {
            threadBoxRef.current.scrollTop = threadBoxRef.current.scrollHeight;
        }
    }, [thread]);

    const send = async () => {
        if (!active) return;
        if (!text.trim()) { toast.error(t('inbox.message_required')); return; }
        setSending(true);
        try {
            await api.post('/messages', {
                recipientId: active.otherUser.id,
                ...(active.course ? { courseId: active.course.id } : {}),
                ...(active.opening?.id ? { openingId: active.opening.id } : {}),
                content: text.trim(),
            });
            setText('');
            await openThread(active, false);
            loadConversations();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('inbox.message_fail'));
        }
        setSending(false);
    };

    const openNew = async () => {
        setNewOpen(true);
        try {
            const res = await api.get('/messages/contacts');
            setContacts(res.data);
        } catch {
            toast.error(t('inbox.message_fail'));
        }
    };

    const openNameSettings = async () => {
        setNameSettingsOpen(true);
        setLoadingNameSettings(true);
        try {
            const res = await api.get('/users/me');
            const metadata = res.data?.metadata && typeof res.data.metadata === 'object'
                ? res.data.metadata as Record<string, unknown>
                : {};
            setInboxDisplayName(typeof metadata.inboxDisplayName === 'string' ? metadata.inboxDisplayName : '');
            setInboxUseOfficialName(metadata.inboxUseOfficialName !== false);
        } catch (err) {
            setNameSettingsOpen(false);
            toast.error(getErrorMessage(err) || t('inbox.name_settings_failed'));
        } finally {
            setLoadingNameSettings(false);
        }
    };

    const saveNameSettings = async () => {
        const displayName = inboxDisplayName.trim();
        if (!inboxUseOfficialName && !displayName) {
            toast.error(t('inbox.display_name_required'));
            return;
        }
        setSavingNameSettings(true);
        try {
            await api.patch('/users/me', {
                metadata: {
                    inboxDisplayName: displayName,
                    inboxUseOfficialName,
                },
            });
            toast.success(t('inbox.name_settings_saved'));
            setNameSettingsOpen(false);
            loadConversations();
        } catch (err) {
            toast.error(getErrorMessage(err) || t('inbox.name_settings_failed'));
        } finally {
            setSavingNameSettings(false);
        }
    };

    const startContact = (c: Contact) => {
        const conv: Conv = {
            id: `${c.id}|${c.course?.id ?? ''}|${c.openingId ?? ''}`,
            otherUser: { id: c.id, nameAr: c.nameAr, nameEn: c.nameEn, role: c.role },
            course: c.course ? { id: c.course.id, titleAr: c.course.titleAr, titleEn: c.course.titleEn } : null,
            opening: c.openingId ? { id: c.openingId } : null,
            lastMessage: { content: '', createdAt: '', fromMe: false, read: true },
            unreadCount: 0,
            updatedAt: '',
        };
        setNewOpen(false);
        openThread(conv, false);
    };

    const messageRequest = async (c: Contact) => {
        if (!c.openingId) return;
        try {
            await api.post('/messages/requests', { recipientId: c.id, openingId: c.openingId });
            toast.success(t('inbox.request_sent'));
            const res = await api.get('/messages/contacts');
            setContacts(res.data);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('inbox.request_failed'));
        }
    };

    const respondToRequest = async (c: Contact, approved: boolean) => {
        if (!c.requestId) return;
        try {
            await api.patch(`/messages/requests/${c.requestId}`, { approved });
            toast.success(t(approved ? 'inbox.request_approved' : 'inbox.request_rejected'));
            const res = await api.get('/messages/contacts');
            setContacts(res.data);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('inbox.request_failed'));
        }
    };

    const cancelRequest = async (c: Contact) => {
        if (!c.requestId) return;
        try {
            await api.patch(`/messages/requests/${c.requestId}/cancel`);
            toast.success(t('inbox.request_cancelled'));
            const res = await api.get('/messages/contacts');
            setContacts(res.data);
        } catch (err) {
            toast.error(getErrorMessage(err) || t('inbox.request_failed'));
        }
    };

    const contactName = (contact: Pick<Contact, 'nameAr' | 'nameEn' | 'role'>) =>
        (locale === 'ar' ? contact.nameAr || contact.nameEn : contact.nameEn || contact.nameAr)
        || t(roleLabel[contact.role] ?? 'roles.unknown');

    const isStudent = user?.role === 'STUDENT';
    const isInstructor = user?.role === 'INSTRUCTOR';
    const groupLabel = (): [string, Contact[]][] => {
        if (isStudent) return [
            [t('inbox.enrolled_courses'), contacts.instructors],
            [t('inbox.batch_classmates'), contacts.students],
            [t('inbox.contact_support'), contacts.admins],
        ];
        if (isInstructor) return [[t('inbox.my_students'), contacts.students], [t('inbox.contact_support'), contacts.admins]];
        return [[t('inbox.all_students'), contacts.students], [t('inbox.contact_support'), contacts.admins]];
    };

    const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fmtDay = (iso: string) => new Date(iso).toLocaleDateString();
    const fmtConversationTime = (iso: string) => {
        const date = new Date(iso);
        return date.toLocaleDateString() === new Date().toLocaleDateString() ? fmtTime(iso) : fmtDay(iso);
    };
    const filteredConversations = conversations.filter((conversation) => {
        const query = conversationSearch.trim().toLocaleLowerCase();
        if (!query) return true;
        return [
            contactName(conversation.otherUser),
            conversation.lastMessage.content,
            conversation.course ? pick(conversation.course, 'title') : '',
        ].some((value) => value?.toLocaleLowerCase().includes(query));
    });

    return (
        <ProtectedRoute>
            <div className="space-y-6 animate-fade-in">
                <PageHeader
                    title={t('inbox.title')}
                    subtitle={t('inbox.subtitle')}
                    actions={
                        <div className="flex flex-wrap gap-2">
                            {isStudent && (
                                <button onClick={openNameSettings} className="inline-flex items-center gap-2 border border-gray-300 dark:border-white/10 text-brand-navy dark:text-white px-4 py-2.5 rounded-xl font-bold hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer">
                                    <Settings size={18} /> {t('inbox.display_name_settings')}
                                </button>
                            )}
                            <button onClick={openNew} className="inline-flex items-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black px-4 py-2.5 rounded-xl font-bold hover:from-brand-gold-light hover:to-brand-gold transition cursor-pointer">
                                <MessageSquarePlus size={18} /> {t('inbox.new_message')}
                            </button>
                        </div>
                    }
                />

                <div className="bg-white dark:bg-brand-navy-dark rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 overflow-hidden flex flex-col md:flex-row min-h-[70vh]">
                    {/* Conversations list */}
                    <aside className={`md:w-[360px] md:shrink-0 border-b md:border-b-0 md:border-e border-gray-200 dark:border-white/5 ${active ? 'hidden md:flex' : 'flex'} flex-col`}>
                        <div className="p-4 space-y-3 border-b border-gray-200 dark:border-white/5">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="font-black text-brand-navy dark:text-white">{t('inbox.conversations')}</h3>
                                {conversations.length > 0 && (
                                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{conversations.length}</span>
                                )}
                            </div>
                            <label className="flex items-center gap-2 rounded-xl bg-gray-100 dark:bg-white/5 px-3 py-2.5 text-gray-500 dark:text-gray-400">
                                <Search size={17} className="shrink-0" />
                                <input
                                    type="search"
                                    value={conversationSearch}
                                    onChange={(event) => setConversationSearch(event.target.value)}
                                    placeholder={t('inbox.search_conversations')}
                                    aria-label={t('inbox.search_conversations')}
                                    className="w-full bg-transparent text-sm text-brand-navy dark:text-white placeholder:text-gray-500 outline-none"
                                />
                            </label>
                        </div>
                        <div className="overflow-y-auto flex-1 min-h-0 max-h-[45vh] md:max-h-none admin-scroll">
                            {loadingConv ? (
                                <div className="h-40 flex items-center justify-center"><Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={24} /></div>
                            ) : conversations.length === 0 ? (
                                <div className="p-8 text-center">
                                    <InboxIcon size={32} className="mx-auto text-gray-400 dark:text-gray-500 mb-3" />
                                    <p className="text-gray-500 dark:text-gray-400 font-bold text-sm">{t('inbox.no_conversations')}</p>
                                </div>
                            ) : filteredConversations.length === 0 ? (
                                <div className="p-8 text-center">
                                    <Search size={28} className="mx-auto text-gray-400 dark:text-gray-500 mb-3" />
                                    <p className="text-gray-500 dark:text-gray-400 font-bold text-sm">{t('inbox.no_matching_conversations')}</p>
                                </div>
                            ) : (
                                filteredConversations.map((c) => (
                                    <button
                                        key={c.id}
                                        onClick={() => openThread(c, true)}
                                        className={`w-full text-left px-4 py-3 border-b border-gray-200 dark:border-white/5 hover:bg-brand-navy/5 dark:hover:bg-white/5 transition cursor-pointer ${active?.id === c.id ? 'bg-brand-navy/5 dark:bg-white/10' : ''}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className={`h-12 w-12 shrink-0 rounded-full flex items-center justify-center font-black text-lg ${c.unreadCount > 0 ? 'bg-brand-gold/20 text-brand-gold-dark dark:text-brand-gold-light' : 'bg-brand-navy/10 dark:bg-white/10 text-brand-navy dark:text-white'}`}>
                                                {contactName(c.otherUser).trim().charAt(0)}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center justify-between gap-2">
                                                    <span className={`truncate text-sm ${c.unreadCount > 0 ? 'font-black text-brand-navy dark:text-white' : 'font-bold text-brand-navy dark:text-white'}`}>{contactName(c.otherUser)}</span>
                                                    {c.lastMessage.createdAt && (
                                                        <span className={`shrink-0 text-[10px] ${c.unreadCount > 0 ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                                            {fmtConversationTime(c.lastMessage.createdAt)}
                                                        </span>
                                                    )}
                                                </span>
                                                {c.course && (
                                                    <span className="block text-[11px] text-brand-gold-dark dark:text-brand-gold-light font-bold truncate">{pick(c.course, 'title')}</span>
                                                )}
                                                <span className="mt-1 flex items-center justify-between gap-2">
                                                    <span className={`truncate text-xs ${c.unreadCount > 0 ? 'font-bold text-brand-navy dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                                        {c.lastMessage.fromMe && <span className="font-bold">{t('inbox.me')}: </span>}
                                                        {c.lastMessage.content}
                                                    </span>
                                                    {c.unreadCount > 0 && (
                                                        <span className="shrink-0 bg-emerald-600 text-white text-[10px] font-black rounded-full min-w-5 h-5 px-1.5 inline-flex items-center justify-center">
                                                            {c.unreadCount}
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </aside>

                    {/* Thread */}
                    <section className={`flex-1 flex flex-col ${active ? 'flex' : 'hidden md:flex'}`}>
                        {!active ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
                                <MessageSquarePlus size={40} className="text-gray-400 dark:text-gray-600 mb-4" />
                                <p className="text-gray-500 dark:text-gray-400 font-bold">{t('inbox.select_conversation')}</p>
                            </div>
                        ) : (
                            <>
                                <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5 bg-gray-50/80 dark:bg-white/5 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-black text-brand-navy dark:text-white truncate">{contactName(active.otherUser)}</p>
                                        {active.course && (
                                            <p className="text-xs text-brand-gold-dark dark:text-brand-gold-light font-bold truncate">{t('inbox.course')} {pick(active.course, 'title')}</p>
                                        )}
                                    </div>
                                    <button onClick={() => setActive(null)} className="md:hidden text-gray-500 dark:text-gray-400 hover:text-brand-navy dark:hover:text-white"><X size={20} /></button>
                                </div>

                                <div ref={threadBoxRef} className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50/60 dark:bg-brand-navy-dark h-[40vh] md:h-[calc(70vh-130px)] admin-scroll">
                                    {loadingThread ? (
                                        <div className="flex justify-center pt-8"><Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={24} /></div>
                                    ) : thread.length === 0 ? (
                                        <p className="text-center text-gray-500 dark:text-gray-400 text-sm pt-8">{t('inbox.select_conversation')}</p>
                                    ) : (
                                        thread.map((m) => {
                                            const mine = m.senderId === user?.userId;
                                            return (
                                                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                                    <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                                                        mine
                                                            ? 'bg-gradient-to-br from-brand-gold to-brand-gold-dark text-black rounded-br-md'
                                                            : 'bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 text-brand-navy dark:text-white rounded-bl-md'
                                                    }`}>
                                                        <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                                                        <span className={`block text-[10px] mt-1 ${mine ? 'text-black/50' : 'text-gray-400 dark:text-gray-500'}`}>
                                                            {fmtTime(m.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                <div className="p-4 border-t border-gray-200 dark:border-white/5 flex items-center gap-2">
                                    <input
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                                        placeholder={t('inbox.type_message')}
                                        className="flex-1 px-4 py-3 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none transition text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                                    />
                                    <button onClick={send} disabled={sending || !text.trim()} className="bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black p-3 rounded-xl hover:from-brand-gold-light hover:to-brand-gold disabled:opacity-40 transition cursor-pointer">
                                        {sending ? <Loader size={18} className="animate-spin" /> : <Send size={18} />}
                                    </button>
                                </div>
                            </>
                        )}
                    </section>
                </div>

                {/* New message modal */}
                {newOpen && (
                    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setNewOpen(false)}>
                        <div className="bg-brand-navy-dark rounded-3xl shadow-2xl p-6 lg:p-8 w-full max-w-md animate-fade-in-up border border-white/10 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-black text-white">{t('inbox.send_to')}</h3>
                                <button onClick={() => setNewOpen(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                            </div>
                            <div className="space-y-5 max-h-[60vh] overflow-y-auto admin-scroll">
                                {groupLabel().map(([label, items]) => (
                                    <div key={label}>
                                        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">{label}</p>
                                        {items.length === 0 ? (
                                            <p className="text-xs text-gray-500">{t('inbox.no_contacts')}</p>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {items.map((c) => {
                                                    const peerStudent = isStudent && c.role === 'STUDENT';
                                                    const canOpen = !peerStudent || c.requestStatus === 'APPROVED';
                                                    return (
                                                        <div
                                                            key={`${c.id}|${c.openingId ?? ''}`}
                                                            className="px-4 py-3 rounded-xl border border-white/10 bg-brand-navy"
                                                        >
                                                            <button
                                                                onClick={() => canOpen && startContact(c)}
                                                                disabled={!canOpen}
                                                                className={`w-full text-left ${canOpen ? 'cursor-pointer' : 'cursor-default'}`}
                                                            >
                                                                <span className="block font-bold text-white text-sm">{contactName(c)}</span>
                                                                <span className="block text-xs text-gray-400">
                                                                    {t(roleLabel[c.role] ?? 'roles.unknown')}
                                                                    {c.course && <> · {pick(c.course, 'title')}</>}
                                                                </span>
                                                                {peerStudent && c.requestStatus === 'APPROVED' && (
                                                                    <span className="block text-xs text-brand-gold-light mt-1">{t('inbox.open_thread')}</span>
                                                                )}

                                                                {nameSettingsOpen && (
                                                                    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingNameSettings && setNameSettingsOpen(false)}>
                                                                        <div
                                                                            role="dialog"
                                                                            aria-modal="true"
                                                                            aria-labelledby="inbox-name-settings-title"
                                                                            className="bg-white dark:bg-brand-navy-dark rounded-3xl shadow-2xl p-6 sm:p-8 w-full max-w-md border border-gray-200 dark:border-white/10"
                                                                            onClick={(event) => event.stopPropagation()}
                                                                        >
                                                                            <div className="flex items-center justify-between gap-3 mb-5">
                                                                                <h2 id="inbox-name-settings-title" className="text-xl font-black text-brand-navy dark:text-white">{t('inbox.display_name_settings')}</h2>
                                                                                <button onClick={() => setNameSettingsOpen(false)} disabled={savingNameSettings} className="text-gray-500 hover:text-brand-navy dark:hover:text-white disabled:opacity-50" aria-label={t('inbox.close')}>
                                                                                    <X size={20} />
                                                                                </button>
                                                                            </div>
                                                                            {loadingNameSettings ? (
                                                                                <div className="flex justify-center py-10"><Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={24} /></div>
                                                                            ) : (
                                                                                <>
                                                                                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('inbox.display_name_description')}</p>
                                                                                    <label className="flex items-center gap-3 text-sm font-bold text-brand-navy dark:text-white cursor-pointer mb-5">
                                                                                        <input
                                                                                            type="checkbox"
                                                                                            checked={inboxUseOfficialName}
                                                                                            onChange={(event) => setInboxUseOfficialName(event.target.checked)}
                                                                                            className="accent-amber-500"
                                                                                        />
                                                                                        {t('inbox.use_official_name')}
                                                                                    </label>
                                                                                    {!inboxUseOfficialName && (
                                                                                        <div className="mb-6">
                                                                                            <label htmlFor="inbox-display-name" className="block text-sm font-bold text-brand-navy dark:text-white mb-2">{t('inbox.display_name')}</label>
                                                                                            <input
                                                                                                id="inbox-display-name"
                                                                                                type="text"
                                                                                                value={inboxDisplayName}
                                                                                                onChange={(event) => setInboxDisplayName(event.target.value.slice(0, 80))}
                                                                                                maxLength={80}
                                                                                                autoComplete="nickname"
                                                                                                dir="auto"
                                                                                                className="w-full px-4 py-3 bg-white dark:bg-brand-navy border border-gray-300 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none text-brand-navy dark:text-white"
                                                                                            />
                                                                                        </div>
                                                                                    )}
                                                                                    <div className="flex gap-3">
                                                                                        <button onClick={saveNameSettings} disabled={savingNameSettings} className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black py-3 font-bold rounded-xl disabled:opacity-50">
                                                                                            {savingNameSettings ? <Loader size={18} className="animate-spin" /> : <Check size={18} />}
                                                                                            {t('inbox.save_name_settings')}
                                                                                        </button>
                                                                                        <button onClick={() => setNameSettingsOpen(false)} disabled={savingNameSettings} className="px-5 bg-gray-100 dark:bg-white/5 text-brand-navy dark:text-white font-bold rounded-xl disabled:opacity-50">
                                                                                            {t('inbox.cancel')}
                                                                                        </button>
                                                                                    </div>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </button>
                                                            {peerStudent && (
                                                                <div className="mt-2">
                                                                    {c.requestStatus === 'APPROVED' ? null : c.requestStatus === 'PENDING' && c.requestDirection === 'INCOMING' ? (
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <span className="text-xs text-gray-300">{t('inbox.request_incoming')}</span>
                                                                            <div className="flex gap-2">
                                                                                <button onClick={() => respondToRequest(c, true)} className="text-xs font-bold text-emerald-300 hover:underline">{t('inbox.request_approve')}</button>
                                                                                <button onClick={() => respondToRequest(c, false)} className="text-xs font-bold text-red-300 hover:underline">{t('inbox.request_reject')}</button>
                                                                            </div>
                                                                        </div>
                                                                    ) : c.requestStatus === 'PENDING' ? (
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <span className="text-xs text-gray-400">{t('inbox.request_pending')}</span>
                                                                            {c.requestDirection === 'OUTGOING' && (
                                                                                <button onClick={() => cancelRequest(c)} className="text-xs font-bold text-red-300 hover:underline">
                                                                                    {t('inbox.request_cancel')}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <button onClick={() => messageRequest(c)} className="text-xs font-bold text-brand-gold-light hover:underline">
                                                                            {t('inbox.request_message')}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
