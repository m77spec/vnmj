"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE_URL, getErrorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n-context';
import { useAuth } from '@/lib/auth-context';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { Loader, Send, MessagesSquare, Users, Inbox, ArrowLeft, Paperclip, FileText, ImageIcon, X } from 'lucide-react';
import { PageHeader } from '@/app/dashboard/admin/components';
import ProtectedRoute from '@/components/ProtectedRoute';

interface ChatRoom {
    id: string;
    name: string;
    nameAr?: string | null;
    nameEn?: string | null;
    createdAt?: string;
    openingId: string | null;
    course?: { id: string; title: string; titleAr?: string | null; titleEn?: string | null } | null;
    lastMessage?: { content: string; attachmentType?: string | null; createdAt: string; fromMe: boolean } | null;
    memberCount: number;
    unreadCount?: number;
}

interface ChatMsg {
    id: string;
    content: string;
    attachmentUrl?: string | null;
    attachmentType?: string | null;
    createdAt: string;
    senderId: string;
    sender?: { id: string; nameAr?: string | null; nameEn?: string | null; role: string } | null;
}

export default function BatchChatsPage() {
    const { t, pick } = useI18n();
    const { user } = useAuth();
    const [rooms, setRooms] = useState<ChatRoom[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
    const [thread, setThread] = useState<ChatMsg[]>([]);
    const [loadingThread, setLoadingThread] = useState(false);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pendingAttachment, setPendingAttachment] = useState<{ url: string; type: string } | null>(null);
    const [mobileShowChat, setMobileShowChat] = useState(false);
    const msgEndRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const socketRef = useRef<Socket | null>(null);

    const loadRooms = useCallback(async () => {
        try {
            const res = await api.get('/chat/rooms');
            setRooms(res.data || []);
        } catch {
            /* silent on polling */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadRooms();
        const timer = setInterval(loadRooms, 10000);
        return () => clearInterval(timer);
    }, [loadRooms]);

    const openThread = useCallback(async (room: ChatRoom) => {
        setActiveRoom(room);
        setMobileShowChat(true);
        setLoadingThread(true);
        try {
            const res = await api.get(`/chat/rooms/${room.id}/thread`);
            setThread((res.data || []).reverse());
        } catch (e) {
            toast.error(getErrorMessage(e) || t('courseChat.load_failed'));
        } finally {
            setLoadingThread(false);
        }
    }, [t]);

    useEffect(() => {
        msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [thread]);

    // Socket.io
    useEffect(() => {
        if (!user || !activeRoom) return;
        const token = typeof window !== 'undefined' ? window.localStorage.getItem('laxalab_token') : null;
        const socket: Socket = io(API_BASE_URL, {
            auth: { token },
            transports: ['websocket', 'polling'],
        });
        socketRef.current = socket;
        socket.on('connect', () => {
            socket.emit('chat:join', { roomId: activeRoom.id });
        });
        socket.on('chat:message', (msg: ChatMsg) => {
            setThread(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
            // Update last message in room list
            setRooms(prev => prev.map(r => {
                if (r.id === activeRoom.id) {
                    return {
                        ...r,
                        lastMessage: { content: msg.content, createdAt: msg.createdAt, fromMe: msg.senderId === user?.userId },
                    };
                }
                return r;
            }));
        });
        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [user, activeRoom]);

    const handleSend = async () => {
        const content = draft.trim();
        const att = pendingAttachment;
        if ((!content && !att) || sending || !activeRoom) return;
        setSending(true);
        try {
            await api.post(`/chat/rooms/${activeRoom.id}/messages`, { content, attachmentUrl: att?.url, attachmentType: att?.type });
            const res = await api.get(`/chat/rooms/${activeRoom.id}/thread`);
            setThread((res.data || []).reverse());
            setRooms(prev => prev.map(r => {
                if (r.id === activeRoom.id) {
                    return { ...r, lastMessage: { content, attachmentType: att?.type ?? null, createdAt: new Date().toISOString(), fromMe: true } };
                }
                return r;
            }));
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

    const renderAttachment = (m: ChatMsg) => {
        if (!m.attachmentUrl) return null;
        const isImage = m.attachmentType?.startsWith('image/');
        return isImage ? (
            <a href={`${API_BASE_URL}${m.attachmentUrl}`} target="_blank" rel="noreferrer" className="block mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${API_BASE_URL}${m.attachmentUrl}`} alt="attachment" className="max-h-48 rounded-xl border border-gray-200 dark:border-white/10" />
            </a>
        ) : (
            <a href={`${API_BASE_URL}${m.attachmentUrl}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-brand-gold-dark dark:text-brand-gold-light underline text-xs">
                <FileText size={13} /> {t('courseChat.view_attachment')}
            </a>
        );
    };

    const renderBubble = (m: ChatMsg) => (
        <div className={`flex ${isMine(m) ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                isMine(m) ? 'bg-gradient-to-br from-brand-gold to-brand-gold-dark text-black rounded-br-md' : 'bg-white dark:bg-brand-navy-dark border border-gray-200 dark:border-white/5 text-brand-navy dark:text-white rounded-bl-md'
            }`}>
                {!isMine(m) && m.sender && (
                            <div className="text-[10px] font-bold text-brand-gold-dark dark:text-brand-gold-light mb-0.5">
                                {pick(m.sender, 'name') || t('courseChat.member')}
                            </div>
                )}
                {m.content && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>}
                {renderAttachment(m)}
                <div className={`text-[9px] mt-1 ${isMine(m) ? 'text-black/50' : 'text-gray-500 dark:text-gray-400'}`}>
                    {new Date(m.createdAt).toLocaleString()}
                </div>
            </div>
        </div>
    );

    return (
        <ProtectedRoute allowedRoles={['STUDENT', 'INSTRUCTOR', 'COURSE_MANAGER', 'ADMIN']}>
        <div className="min-w-0 space-y-5 sm:space-y-6 animate-fade-in">
            <PageHeader
                title={t('batchChats.title')}
                subtitle={t('batchChats.subtitle')}
            />

            <div className="min-w-0 bg-white dark:bg-brand-navy-dark rounded-2xl sm:rounded-3xl shadow-sm border border-gray-200 dark:border-white/5 overflow-hidden flex flex-col md:flex-row min-h-[65vh]">
                {/* Left sidebar — room list */}
                <aside className={`md:w-80 lg:w-96 border-b md:border-b-0 md:border-e border-gray-200 dark:border-white/5 ${mobileShowChat ? 'hidden md:block' : 'block'}`}>
                    <div className="p-4 border-b border-gray-200 dark:border-white/5">
                        <div className="flex items-center gap-2">
                            <MessagesSquare size={18} className="text-brand-gold-dark dark:text-brand-gold-light" />
                            <h3 className="font-black text-brand-navy dark:text-white text-sm">{t('batchChats.rooms_list')}</h3>
                        </div>
                    </div>
                    <div className="overflow-y-auto h-[50vh] md:h-[calc(65vh-57px)] admin-scroll">
                        {loading ? (
                            <div className="h-40 flex items-center justify-center">
                                <Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={24} />
                            </div>
                        ) : rooms.length === 0 ? (
                            <div className="p-8 text-center">
                                <MessagesSquare size={32} className="mx-auto text-gray-400 dark:text-gray-500 mb-3" />
                                <p className="text-gray-500 dark:text-gray-400 font-bold text-sm">{t('batchChats.no_rooms')}</p>
                            </div>
                        ) : (
                            rooms.map(room => {
                                const isActive = activeRoom?.id === room.id;
                                return (
                                    <button
                                        key={room.id}
                                        onClick={() => openThread(room)}
                                        className={`w-full text-left px-4 py-3.5 border-b border-gray-200 dark:border-white/5 hover:bg-brand-navy/5 dark:hover:bg-white/5 transition cursor-pointer ${isActive ? 'bg-brand-navy/5 dark:bg-white/10' : ''}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-black ${
                                                    isActive ? 'bg-brand-gold text-black' : 'bg-gray-100 dark:bg-white/10 text-brand-gold-dark dark:text-brand-gold-light'
                                                }`}>
                                                    <Users size={15} />
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="font-bold text-brand-navy dark:text-white text-sm truncate block">{pick(room, 'name')}</span>
                                                    {room.course && (
                                                        <span className="text-[11px] text-brand-gold-dark dark:text-brand-gold-light font-bold truncate block">{pick(room.course, 'title')}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                {room.lastMessage && (
                                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatTime(room.lastMessage.createdAt)}</span>
                                                )}
                                                {(room.unreadCount ?? 0) > 0 && (
                                                    <span className="bg-brand-gold text-black text-[10px] font-black rounded-full min-w-5 h-5 px-1.5 inline-flex items-center justify-center">
                                                        {room.unreadCount}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {room.lastMessage && (
                                            <p className={`text-xs mt-1.5 truncate ml-12 ${isActive ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                                {room.lastMessage.fromMe && <span className="text-brand-gold-dark dark:text-brand-gold-light">{'You: '}</span>}
                                                {room.lastMessage.content || (room.lastMessage.attachmentType ? '📎' : '')}
                                            </p>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </aside>

                {/* Right panel — chat thread */}
                <section className={`min-w-0 flex-1 flex flex-col ${mobileShowChat ? 'flex' : 'hidden md:flex'}`}>
                    {!activeRoom ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
                            <MessagesSquare size={40} className="text-gray-400 dark:text-gray-600 mb-4" />
                            <p className="text-gray-500 dark:text-gray-400 font-bold">{t('batchChats.select_room')}</p>
                            <p className="text-gray-500 dark:text-gray-500 text-sm mt-1">{t('batchChats.select_room_hint')}</p>
                        </div>
                    ) : (
                        <>
                            {/* Header */}
                            <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-gray-200 dark:border-white/5 bg-gray-50/80 dark:bg-white/5 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <button onClick={() => setMobileShowChat(false)} className="md:hidden text-gray-500 dark:text-gray-400 hover:text-brand-navy dark:hover:text-white">
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-white/10 text-brand-gold-dark dark:text-brand-gold-light flex items-center justify-center shrink-0">
                                        <Users size={15} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-black text-brand-navy dark:text-white truncate">{activeRoom.name}</p>
                                        {activeRoom.course && (
                                            <p className="text-xs text-brand-gold-dark dark:text-brand-gold-light font-bold truncate">{pick(activeRoom.course, 'title')}</p>
                                        )}
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{activeRoom.memberCount} {t('batchChats.members')}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 bg-gray-50/60 dark:bg-brand-navy-dark h-[40vh] md:h-[calc(65vh-130px)] admin-scroll">
                                {loadingThread ? (
                                    <div className="flex justify-center pt-8">
                                        <Loader className="animate-spin text-brand-gold-dark dark:text-brand-gold-light" size={24} />
                                    </div>
                                ) : thread.length === 0 ? (
                                    <div className="text-center pt-8">
                                        <Inbox size={36} className="mx-auto text-gray-400 dark:text-gray-500 mb-3" />
                                        <p className="text-gray-500 dark:text-gray-400 font-bold text-sm">{t('courseChat.no_messages')}</p>
                                    </div>
                                ) : (
                                    thread.map(m => (
                                        <div key={m.id}>{renderBubble(m)}</div>
                                    ))
                                )}
                                <div ref={msgEndRef} />
                            </div>

                            {/* Input */}
                            <div className="p-3 sm:p-4 border-t border-gray-200 dark:border-white/5">
                                {pendingAttachment && (
                                    <div className="mb-2 flex items-center justify-between bg-gray-100/60 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2">
                                        <div className="flex items-center gap-2 text-xs font-bold text-brand-navy dark:text-white">
                                            {pendingAttachment.type.startsWith('image/')
                                                ? <ImageIcon size={14} className="text-brand-gold-dark dark:text-brand-gold-light" />
                                                : <FileText size={14} className="text-brand-gold-dark dark:text-brand-gold-light" />}
                                            <span className="truncate max-w-[220px]">{pendingAttachment.url.split('/').pop()}</span>
                                        </div>
                                        <button onClick={() => setPendingAttachment(null)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition">
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
                                        className="bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 hover:border-brand-gold-dark/60 dark:hover:border-brand-gold-light/50 text-brand-navy dark:text-white p-3 rounded-xl flex items-center justify-center transition disabled:opacity-40"
                                    >
                                        {uploading ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
                                    </button>
                                    <input
                                        value={draft}
                                        onChange={e => setDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                                        placeholder={t('courseChat.placeholder')}
                                        className="flex-1 px-4 py-3 bg-white dark:bg-brand-navy-dark border border-gray-300 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-brand-gold outline-none transition text-brand-navy dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium text-sm"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={sending || (!draft.trim() && !pendingAttachment)}
                                        className="bg-gradient-to-r from-brand-gold to-brand-gold-dark text-black p-3 rounded-xl hover:from-brand-gold-light hover:to-brand-gold disabled:opacity-40 transition cursor-pointer"
                                    >
                                        {sending ? <Loader size={18} className="animate-spin" /> : <Send size={18} />}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
        </ProtectedRoute>
    );
}
