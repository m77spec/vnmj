const POST_AUTH_REDIRECT_KEY = 'laxalab_post_auth_redirect';

function isInternalPath(path: string): boolean {
    return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

export function getPostAuthRedirect(queryRedirect?: string | null): string {
    const storedRedirect = typeof window !== 'undefined'
        ? window.localStorage.getItem(POST_AUTH_REDIRECT_KEY)
        : null;
    const redirect = queryRedirect || storedRedirect;
    return redirect && isInternalPath(redirect) ? redirect : '/dashboard';
}

export function persistPostAuthRedirect(path: string): void {
    if (typeof window !== 'undefined' && isInternalPath(path)) {
        window.localStorage.setItem(POST_AUTH_REDIRECT_KEY, path);
    }
}

export function clearPostAuthRedirect(): void {
    if (typeof window !== 'undefined') {
        window.localStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    }
}
