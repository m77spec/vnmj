"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, API_BASE_URL, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import { Loader, Send, MessagesSquare, Users, Inbox, MessageCircle, Paperclip, FileText, ImageIcon, X, ArrowLeft, AlertCircle } from 'lucide-react';

type ChatMode = 'group' | 'direct';

interface ChatRoom {
    id: string;
    name: string;
    nameAr?: string | null;
    nameEn?: string | null;
    openingId: string | null;
    course?: { id: string; title: string } | null;
    lastMessage?: { content: string; createdAt: string; fromMe: boolean } | null;
    memberCount: number;
    unreadCount?: number;
}

interface DirectChat {
    id: string;
    archived: boolean;
    archivedAt?: string | null;
    student: { id: string; email: string };
    instructor: { id: string; email: string };
    lastMessage?: { content: string; attachmentType?: string | null; createdAt: string; fromMe: boolean } | null;
    unreadCount?: number;
}

interface ChatMsg {
    id: string;
    content: string;
    attachmentUrl?: string | null;
    attachmentType?: string | null;
    createdAt: string;
    senderId: string;
    sender?: {
        id: string;
        email?: string;
        nameAr?: string | null;
        nameEn?: string | null;
        role: string;
    } | null;
}

interface CourseChatProps {
    courseId: string;
    variant?: 'group' | 'direct';
}

export default function CourseChat({ courseId, variant }: CourseChatProps) {
    const { t, pick } = useI18n();
    const { user } = useAuth();
    const [mode, setMode] = useState<ChatMode>(variant ?? 'group');
    const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
    const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
    const [thread, setThread] = useState<ChatMsg[]>([]);
    const [directChat, setDirectChat] = useState<DirectChat | null>(null);
    const [directThread, setDirectThread] = useState<ChatMsg[]>([]);
    const [loading, setLoading] = useState(true);
    const [roomsError, setRoomsError] = useState<string | null>(null);
    const [directLoading, setDirectLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [draft, setDraft] = useState('');
    const [pendingAttachment, setPendingAttachment] = useState<{ url: string; type: string } | null>(null);
    const msgEndRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const socketRef = useRef<Socket | null>(null);
    const directChatId = directChat?.id ?? null;

    const isStaff = user?.role === 'INSTRUCTOR' || user?.role === 'ADMIN' || user?.role === 'COURSE_MANAGER';

    // For instructors: WhatsApp-style student list
    const [courseDirectChats, setCourseDirectChats] = useState<DirectChat[]>([]);
    const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
    // Mobile: show sidebar or chat
    const [mobileShowChat, setMobileShowChat] = useState(false);

    // Load the rooms. `CourseChat` is mounted only while the chat tab is
    // selected, so switching away and back re-runs this: a student approved on
    // another device picks up their cohort room here, because the server
    // materialises membership on this call.
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await api.get('/chat/rooms');
                const all: ChatRoom[] = res.data || [];
                const mine = all.filter(r => r.course?.id === courseId);
                if (!active) return;
                setRoomsError(null);
                setRooms(mine);
                // Drop a selected room that is no longer in the list, or the
                // thread pane would sit empty against a room we may not read.
                setActiveRoomId(prev => (prev && mine.some(r => r.id === prev) ? prev : mine[0]?.id ?? null));
            } catch (err) {
                if (!active) return;
                // A failed listing is NOT an empty one. This used to set `[]`,
                // which rendered "no chat room yet" — the same panel a genuine
                // empty allow-list produces — so a server outage reached the
                // user as a missing feature and the 500 only ever showed up in
                // the browser console.
                setRooms([]);
                setRoomsError(getErrorMessage(err) || t('courseChat.load_failed'));
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [courseId, t]);

    // Load group thread when active room changes
    useEffect(() => {
        if (!activeRoomId) return;
        let active = true;
        (async () => {
            try {
                const res = await api.get(`/chat/rooms/${activeRoomId}/thread`);
                if (active) setThread((res.data || []).reverse());
            } catch {
                if (active) toast.error(t('courseChat.load_failed'));
            }
        })();
        return () => { active = false; };
    }, [activeRoomId, t]);

    // Load direct chats for instructor OR create student's single chat
    useEffect(() => {
        if (mode !== 'direct') return;
        let active = true;
        (async () => {
            setDirectLoading(true);
            try {
                if (isStaff) {
                    const listRes = await api.get(`/chat/direct/course/${courseId}`);
                    if (!active) return;
                    const chats: DirectChat[] = listRes.data || [];
                    setCourseDirectChats(chats);
                    if (chats.length === 1) {
                        setSelectedStudentId(chats[0].student.id);
                        setDirectChat(chats[0]);
                        const threadRes = await api.get(`/chat/direct/${chats[0].id}/thread`);
                        if (!active) return;
                        setDirectThread((threadRes.data.messages || []).reverse());
                    }
                } else {
                    const openRes = await api.post(`/chat/direct/course/${courseId}`);
                    if (!active) return;
                    setDirectChat(openRes.data);
                    const threadRes = await api.get(`/chat/direct/${openRes.data.id}/thread`);
                    if (!active) return;
                    setDirectThread((threadRes.data.messages || []).reverse());
                }
            } catch (e) {
                if (active) toast.error(getErrorMessage(e) || t('courseChat.direct_load_failed'));
            } finally {
                if (active) setDirectLoading(false);
            }
        })();
        return () => { active = false; };
    }, [mode, courseId, t, isStaff]);

    // Select a student chat (instructor)
    const selectStudentChat = useCallback(async (chat: DirectChat) => {
        setSelectedStudentId(chat.student.id);
        setDirectChat(chat);
        setDirectLoading(true);
        setMobileShowChat(true);
        try {
            const threadRes = await api.get(`/chat/direct/${chat.id}/thread`);
            setDirectThread((threadRes.data.messages || []).reverse());
        } catch (e) {
            toast.error(getErrorMessage(e) || t('courseChat.direct_load_failed'));
        } finally {
            setDirectLoading(false);
        }
    }, [t]);

    // Scroll to bottom on new messages
    useEffect(() => {
        msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [thread, directThread]);

    // WebSocket connection
    useEffect(() => {
        if (!user) return;
        const token = typeof window !== 'undefined' ? window.localStorage.getItem('laxalab_token') : null;
        const socket: Socket = io(API_BASE_URL, {
            auth: { token },
            transports: ['websocket', 'polling'],
        });
        socketRef.current = socket;
        const roomId = mode === 'group' ? activeRoomId : null;
        const chatId = mode === 'direct' ? directChatId : null;
        socket.on('connect', () => {
            if (roomId) socket.emit('chat:join', { roomId });
            if (chatId) socket.emit('direct:join', { chatId });
        });
        socket.on('chat:message', (msg: ChatMsg) => {
            setThread(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        });
        socket.on('direct:message', (msg: ChatMsg) => {
            setDirectThread(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
            // Update last message in student list for instructors
            setCourseDirectChats(prev => prev.map(c => {
                if (c.id === directChatId) {
                    return {
                        ...c,
                        lastMessage: { content: msg.content, attachmentType: msg.attachmentType, createdAt: msg.createdAt, fromMe: msg.senderId === user?.userId },
                        unreadCount: msg.senderId !== user?.userId ? (c.unreadCount ?? 0) + 1 : c.unreadCount,
                    };
                }
                return c;
            }));
        });
        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [mode, activeRoomId, directChatId, user]);

    const handleSend = async () => {
        const content = draft.trim();
        const att = pendingAttachment;
        if ((!content && !att) || sending) return;
        setSending(true);
        try {
            if (mode === 'group' && activeRoomId) {
                await api.post(`/chat/rooms/${activeRoomId}/messages`, { content, attachmentUrl: att?.url, attachmentType: att?.type });
                const res = await api.get(`/chat/rooms/${activeRoomId}/thread`);
                setThread((res.data || []).reverse());
            } else if (mode === 'direct' && directChatId) {
                await api.post(`/chat/direct/${directChatId}/messages`, { content, attachmentUrl: att?.url, attachmentType: att?.type });
                const res = await api.get(`/chat/direct/${directChatId}/thread`);
                setDirectThread((res.data.messages || []).reverse());
                // Optimistically update last message in list
                setCourseDirectChats(prev => prev.map(c => {
                    if (c.id === directChatId) {
                        return { ...c, lastMessage: { content, attachmentType: att?.type ?? null, createdAt: new Date().toISOString(), fromMe: true } };
                    }
                    return c;
                }));
            }
            setDraft('');
            setPendingAttachment(null);
        } catch (e) {
            toast.error(getErrorMessage(e) || t('courseChat.send_failed'));
        } finally {
            setSending(false);
        }
    };

    const handleFile = async (file: File) => {
        if (uploading) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post('/chat/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            setPendingAttachment({ url: res.data.url, type: res.data.mimetype });
        } catch (e) {
            toast.error(getErrorMessage(e) || t('courseChat.upload_failed'));
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const isMine = (m: ChatMsg) => m.senderId === user?.userId;

    const renderAttachment = (m: ChatMsg) => {
        if (!m.attachmentUrl) return null;
        const isImage = m.attachmentType?.startsWith('image/');
        return isImage ? (
            <a href={`${API_BASE_URL}${m.attachmentUrl}`} target="_blank" rel="noreferrer" className="block mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={`${API_BASE_URL}${m.attachmentUrl}`}
                    alt="attachment"
                    className="max-h-48 max-w-full h-auto object-contain rounded-xl border border-brand-mist"
                />
            </a>
        ) : (
            <a
                href={`${API_BASE_URL}${m.attachmentUrl}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-accent underline text-xs"
            >
                <FileText size={13} /> {t('courseChat.view_attachment')}
            </a>
        );
    };

    const renderBubble = (m: ChatMsg) => (
        <div className={`flex ${isMine(m) ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                isMine(m) ? 'bg-surface text-ink rounded-br-md' : 'bg-surface-raised border border-brand-mist text-ink-muted rounded-bl-md'
            }`}>
                {!isMine(m) && (
                    <div className="text-[10px] font-bold text-accent mb-0.5">
                        {mode === 'group'
                            ? (m.sender ? pick(m.sender, 'name') : undefined) || t('courseChat.member')
                            : (m.sender?.email || (m.sender ? pick(m.sender, 'name') : undefined) || '')}
                    </div>
                )}
                {m.content && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>}
                {renderAttachment(m)}
                <div className={`text-[9px] mt-1 ${isMine(m) ? 'text-ink' : 'text-ink-subtle'}`}>
                    {new Date(m.createdAt).toLocaleString()}
                </div>
            </div>
        </div>
    );

    const renderThreadPanel = (messages: ChatMsg[], emptyKey: string) => (
        <>
            <div className="bg-surface-sunken border border-brand-mist rounded-2xl p-4 h-[60vh] max-h-[420px] min-h-[300px] overflow-y-auto flex flex-col gap-3">
                {messages.length === 0 && (
                    <div className="m-auto text-center text-ink-muted">
                        <Inbox size={36} className="mx-auto mb-2 text-accent" />
                        <p className="font-bold">{t(emptyKey)}</p>
                    </div>
                )}
                {messages.map(m => (
                    <div key={m.id}>{renderBubble(m)}</div>
                ))}
                <div ref={msgEndRef} />
            </div>

            <div className="mt-4">
                {pendingAttachment && (
                    <div className="mb-2 flex items-center justify-between bg-ink/[0.04] border border-brand-mist rounded-xl px-3 py-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-ink">
                            {pendingAttachment.type.startsWith('image/')
                                ? <ImageIcon size={14} className="text-accent" />
                                : <FileText size={14} className="text-accent" />}
                            <span className="truncate max-w-[220px]">{pendingAttachment.url.split('/').pop()}</span>
                        </div>
                        <button onClick={() => setPendingAttachment(null)} className="text-ink-subtle hover:text-red-500 transition">
                            <X size={14} />
                        </button>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                    />
                    <button
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                        title={t('courseChat.attach')}
                        className="bg-surface-raised border border-brand-mist hover:border-brand-gold text-ink p-3 rounded-xl flex items-center justify-center transition disabled:opacity-40 shrink-0"
                    >
                        {uploading ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
                    </button>
                    <input
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                        placeholder={t('courseChat.placeholder')}
                        className="flex-1 min-w-0 bg-surface-raised border border-brand-mist rounded-xl px-4 py-3 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                    />
                    <button
                        onClick={handleSend}
                        disabled={sending || (!draft.trim() && !pendingAttachment)}
                        className="bg-surface hover:bg-brand-charcoal text-ink disabled:opacity-40 px-5 py-3 rounded-xl flex items-center gap-2 font-bold text-sm transition shrink-0"
                    >
                        <Send size={16} /> <span className="hidden sm:inline">{t('courseChat.send')}</span>
                    </button>
                </div>
            </div>
        </>
    );

    const formatTime = (dateStr?: string) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return t('courseChat.yesterday');
        if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const getInitials = (email: string) => {
        const name = email.split('@')[0];
        return name.substring(0, 2).toUpperCase();
    };

    // WhatsApp-style direct chat for instructors
    const renderInstructorDirectChat = () => {
        if (directLoading && courseDirectChats.length === 0) {
            return (
                <div className="h-[60vh] max-h-[520px] min-h-[300px] flex items-center justify-center text-ink">
                    <Loader className="animate-spin" size={32} />
                </div>
            );
        }

        if (courseDirectChats.length === 0) {
            return (
                <div className="h-[60vh] max-h-[520px] min-h-[300px] flex flex-col items-center justify-center text-center text-ink-subtle">
                    <MessageCircle size={40} className="mb-3 text-accent" />
                    <p className="font-bold">{t('courseChat.no_students')}</p>
                    <p className="text-sm mt-1">{t('courseChat.no_students_hint')}</p>
                </div>
            );
        }

        return (
            <div className="flex border border-brand-mist rounded-2xl overflow-hidden h-[60vh] max-h-[520px] min-h-[300px] bg-surface-raised">
                {/* Left sidebar — student list */}
                <div className={`w-full md:w-80 lg:w-96 border-r border-brand-mist flex flex-col shrink-0 ${mobileShowChat ? 'hidden md:flex' : 'flex'}`}>
                    <div className="px-4 py-3 border-b border-brand-mist bg-surface-sunken/80">
                        <div className="flex items-center gap-2">
                            <MessageCircle size={18} className="text-accent" />
                            <h3 className="font-black text-ink text-sm">{t('courseChat.students_list')}</h3>
                            <span className="ml-auto text-[11px] text-ink-subtle font-bold">{courseDirectChats.length}</span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {courseDirectChats.map(chat => {
                            const isActive = selectedStudentId === chat.student.id;
                            return (
                                <button
                                    key={chat.id}
                                    onClick={() => selectStudentChat(chat)}
                                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition border-b border-brand-mist/50 ${
                                        isActive ? 'bg-surface' : 'hover:bg-surface-sunken'
                                    }`}
                                >
                                    {/* Avatar */}
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-xs font-black ${
                                        isActive ? 'bg-surface text-ink' : 'bg-brand-gold/15 text-accent dark:text-brand-gold-light'
                                    }`}>
                                        {getInitials(chat.student.email)}
                                    </div>
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={`font-bold text-sm truncate ${isActive ? 'text-ink' : 'text-gray-800'}`}>
                                                {chat.student.email.split('@')[0]}
                                            </span>
                                            <span className="text-[10px] text-ink-subtle shrink-0 font-semibold">
                                                {formatTime(chat.lastMessage?.createdAt)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 mt-0.5">
                                            <p className="text-xs text-ink-subtle truncate">
                                                {chat.lastMessage
                                                    ? (chat.lastMessage.fromMe ? '✓ ' : '') + (chat.lastMessage.content || (chat.lastMessage.attachmentType ? '📎' : t('courseChat.no_messages')))
                                                    : t('courseChat.start_conversation')
                                                }
                                            </p>
                                            {(chat.unreadCount ?? 0) > 0 && (
                                                <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-brand-gold text-ink-on-gold flex items-center justify-center shrink-0">
                                                    {chat.unreadCount}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Right panel — chat thread */}
                <div className={`flex-1 flex flex-col min-w-0 ${mobileShowChat ? 'flex' : 'hidden md:flex'}`}>
                    {directChat ? (
                        <>
                            {/* Chat header */}
                            <div className="px-4 py-3 border-b border-brand-mist bg-surface-sunken/80 flex items-center gap-3">
                                <button
                                    onClick={() => setMobileShowChat(false)}
                                    className="md:hidden text-gold-ink p-1"
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                <div className="w-9 h-9 rounded-full bg-brand-gold/15 text-gold-ink dark:text-brand-gold-light flex items-center justify-center text-xs font-black">
                                    {getInitials(directChat.student.email)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm text-gold-ink truncate">{directChat.student.email}</p>
                                    <p className="text-[11px] text-gold-ink">{t('courseChat.direct_with_suffix')}</p>
                                </div>
                            </div>
                            {/* Messages */}
                            <div className="flex-1 bg-surface-sunken/50 p-4 overflow-y-auto flex flex-col gap-3">
                                {directLoading ? (
                                    <div className="m-auto text-ink">
                                        <Loader className="animate-spin" size={28} />
                                    </div>
                                ) : directThread.length === 0 ? (
                                    <div className="m-auto text-center text-ink-subtle">
                                        <Inbox size={36} className="mx-auto mb-2 text-accent" />
                                        <p className="font-bold">{t('courseChat.direct_no_messages')}</p>
                                    </div>
                    ) : roomsError ? (
                        <div className="h-64 flex flex-col items-center justify-center text-center text-ink-subtle">
                            <AlertCircle size={40} className="mb-3 text-danger" />
                            <p className="font-bold text-danger">{t('courseChat.load_failed')}</p>
                            {roomsError !== t('courseChat.load_failed') && (
                                <p className="text-sm mt-1">{roomsError}</p>
                            )}
                        </div>
                    ) : (
                                    directThread.map(m => (
                                        <div key={m.id}>{renderBubble(m)}</div>
                                    ))
                                )}
                                <div ref={msgEndRef} />
                            </div>
                            {/* Input */}
                            <div className="px-4 py-3 border-t border-brand-mist bg-surface-raised">
                                {pendingAttachment && (
                                    <div className="mb-2 flex items-center justify-between bg-ink/[0.04] border border-brand-mist rounded-xl px-3 py-2">
                                        <div className="flex items-center gap-2 text-xs font-bold text-ink">
                                            {pendingAttachment.type.startsWith('image/')
                                                ? <ImageIcon size={14} className="text-accent" />
                                                : <FileText size={14} className="text-accent" />}
                                            <span className="truncate max-w-[220px]">{pendingAttachment.url.split('/').pop()}</span>
                                        </div>
                                        <button onClick={() => setPendingAttachment(null)} className="text-ink-subtle hover:text-red-500 transition">
                                            <X size={14} />
                                        </button>
                                    </div>
                                )}
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/*,.pdf"
                                        className="hidden"
                                        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                                    />
                                    <button
                                        onClick={() => fileRef.current?.click()}
                                        disabled={uploading}
                                        title={t('courseChat.attach')}
                                        className="bg-surface-raised border border-brand-mist hover:border-brand-gold text-ink p-3 rounded-xl flex items-center justify-center transition disabled:opacity-40 shrink-0"
                                    >
                                        {uploading ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
                                    </button>
                                    <input
                                        value={draft}
                                        onChange={e => setDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                                        placeholder={t('courseChat.placeholder')}
                                        className="flex-1 min-w-0 bg-surface-sunken border border-brand-mist rounded-xl px-4 py-3 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={sending || (!draft.trim() && !pendingAttachment)}
                                        className="bg-surface hover:bg-brand-charcoal text-ink disabled:opacity-40 px-5 py-3 rounded-xl flex items-center gap-2 font-bold text-sm transition shrink-0"
                                    >
                                        <Send size={16} />
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-ink-subtle">
                            <div className="text-center">
                                <MessageCircle size={40} className="mx-auto mb-3 text-accent" />
                                <p className="font-bold">{t('courseChat.select_student_hint')}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Track switcher */}
            {!variant && (
                <div className="flex gap-2 border-b border-brand-mist pb-3">
                    <button
                        onClick={() => setMode('group')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition ${
                            mode === 'group' ? 'bg-surface text-ink' : 'text-ink-subtle hover:bg-ink/[0.04]'
                        }`}
                    >
                        <MessagesSquare size={16} /> {t('courseChat.tab_group')}
                    </button>
                    <button
                        onClick={() => setMode('direct')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition ${
                            mode === 'direct' ? 'bg-surface text-ink' : 'text-ink-subtle hover:bg-ink/[0.04]'
                        }`}
                    >
                        <MessageCircle size={16} /> {t('courseChat.tab_direct')}
                    </button>
                </div>
            )}

            {mode === 'group' && (
                <>
                    {loading ? (
                        <div className="h-64 flex items-center justify-center text-ink">
                            <Loader className="animate-spin" size={32} />
                        </div>
                    ) : rooms && rooms.length > 0 ? (
                        <div className="grid md:grid-cols-3 gap-6">
                            <div className="md:col-span-1 space-y-2">
                                <h3 className="font-black text-ink flex items-center gap-2 mb-3">
                                    <MessagesSquare size={18} className="text-accent" /> {t('courseChat.rooms')}
                                </h3>
                                {rooms.map(room => (
                                    <button
                                        key={room.id}
                                        onClick={() => setActiveRoomId(room.id)}
                                        className={`w-full text-left p-4 rounded-xl border transition ${
                                            activeRoomId === room.id
                                                ? 'bg-surface text-ink border-brand-navy shadow-md'
                                                : 'bg-surface-raised text-ink-muted border-brand-mist hover:bg-ink/[0.04]'
                                        }`}
                                    >
                                        <div className="font-bold text-sm flex items-center gap-2">
                                            <span className="truncate">{pick(room, 'name')}</span>
                                            {(room.unreadCount ?? 0) > 0 && (
                                                <span className={`ml-auto min-w-[20px] px-1.5 py-0.5 rounded-full text-[10px] font-bold text-center ${
                                                    activeRoomId === room.id ? 'bg-brand-gold text-ink-on-gold' : 'bg-brand-gold text-ink-on-gold'
                                                }`}>
                                                    {room.unreadCount}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] opacity-70 mt-1 flex items-center gap-1.5">
                                            <Users size={12} /> {room.memberCount}
                                        </div>
                                        {room.lastMessage && (
                                            <p className={`text-xs mt-1.5 truncate ${activeRoomId === room.id ? 'text-ink-muted' : 'text-ink-subtle'}`}>
                                                {room.lastMessage.content}
                                            </p>
                                        )}
                                    </button>
                                ))}
                            </div>

                            <div className="md:col-span-2">{renderThreadPanel(thread, 'courseChat.no_messages')}</div>
                        </div>
                    ) : (
                        <div className="h-64 flex flex-col items-center justify-center text-center text-ink-subtle">
                            <MessagesSquare size={40} className="mb-3 text-accent" />
                            <p className="font-bold">{t('courseChat.empty')}</p>
                            <p className="text-sm mt-1">{t('courseChat.empty_hint')}</p>
                        </div>
                    )}
                </>
            )}

            {mode === 'direct' && (
                <>
                    {isStaff ? (
                        renderInstructorDirectChat()
                    ) : (
                        <>
                            {directLoading && !directChat ? (
                                <div className="h-64 flex items-center justify-center text-ink">
                                    <Loader className="animate-spin" size={32} />
                                </div>
                            ) : directChat ? (
                                <div>
                                    {renderThreadPanel(directThread, 'courseChat.direct_no_messages')}
                                </div>
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center text-center text-ink-subtle">
                                    <MessageCircle size={40} className="mb-3 text-accent" />
                                    <p className="font-bold">{t('courseChat.direct_empty')}</p>
                                    <p className="text-sm mt-1">{t('courseChat.direct_empty_hint')}</p>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
