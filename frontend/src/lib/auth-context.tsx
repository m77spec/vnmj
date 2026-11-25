"use client";

import React, { createContext, useContext, useEffect, ReactNode, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { trackEvent } from './analytics';

export type Role = 'STUDENT' | 'INSTRUCTOR' | 'COURSE_MANAGER' | 'FINANCE' | 'ADMIN';

export interface User {
    userId: string;
    email: string;
    role: Role;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    login: (token: string, user: User, refreshToken?: string, method?: 'password' | 'google' | 'two_factor') => void;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'laxalab_token';
const REFRESH_KEY = 'laxalab_refresh';
const USER_KEY = 'laxalab_user';

let cachedToken: string | null = null;
let cachedTokenRaw: string | null = null;
function getSnapshotToken(): string | null {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw !== cachedTokenRaw) {
        cachedTokenRaw = raw;
        cachedToken = raw;
    }
    return cachedToken;
}
function getServerSnapshotToken(): string | null {
    return null;
}

let cachedUser: User | null = null;
let cachedUserRaw: string | null = null;
function getSnapshotUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    if (raw !== cachedUserRaw) {
        cachedUserRaw = raw;
        try {
            cachedUser = raw ? (JSON.parse(raw) as User) : null;
        } catch {
            cachedUser = null;
        }
    }
    return cachedUser;
}
function getServerSnapshotUser(): User | null {
    return null;
}

let authListeners: (() => void)[] = [];
function emitAuthChange() {
    for (const listener of authListeners) {
        listener();
    }
}
function subscribeAuth(listener: () => void) {
    authListeners.push(listener);
    return () => {
        authListeners = authListeners.filter((l) => l !== listener);
    };
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const token = useSyncExternalStore(subscribeAuth, getSnapshotToken, getServerSnapshotToken);
    const user = useSyncExternalStore(subscribeAuth, getSnapshotUser, getServerSnapshotUser);

    // Cross-tab sync: re-read when another tab changes auth state
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === TOKEN_KEY || e.key === USER_KEY) {
                emitAuthChange();
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const login = (newToken: string, newUser: User, refreshToken?: string, method: 'password' | 'google' | 'two_factor' = 'password') => {
        localStorage.setItem(TOKEN_KEY, newToken);
        if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
        localStorage.setItem(USER_KEY, JSON.stringify(newUser));
        trackEvent('login', { method });
        emitAuthChange();
    };

    const logout = () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
        emitAuthChange();
        router.push('/login');
    };

    return (
        <AuthContext.Provider value={{
            user,
            token,
            isAuthenticated: !!token,
            login,
            logout
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};