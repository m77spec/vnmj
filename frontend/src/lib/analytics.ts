import { readConsent, type ConsentPrefs } from './consent';

declare global {
    interface Window {
        dataLayer?: unknown[];
        gtag?: (...args: unknown[]) => void;
    }
}

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
export const ANALYTICS_CONSENT_EVENT = 'laxalab:analytics-consent';

export function isAnalyticsApproved(): boolean {
    return readConsent()?.analytics ?? false;
}

export function isMarketingApproved(): boolean {
    return readConsent()?.marketing ?? false;
}

function ensureGtag() {
    if (!window.dataLayer) window.dataLayer = [];
    if (!window.gtag) {
        window.gtag = (...args: unknown[]) => {
            window.dataLayer!.push(args);
        };
    }
    return window.gtag!;
}

function loadGA4() {
    if (!GA4_ID || !/^G-[A-Z0-9]+$/i.test(GA4_ID) || document.getElementById('laxalab-ga4')) return;
    ensureGtag();
    const script = document.createElement('script');
    script.id = 'laxalab-ga4';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID!)}`;
    document.head.appendChild(script);
    ensureGtag()('js', new Date());
    ensureGtag()('config', GA4_ID, {
        send_page_view: false,
        anonymize_ip: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
    });
}

function loadGTM() {
    if (!GTM_ID || document.getElementById('laxalab-gtm')) return;
    const script = document.createElement('script');
    script.id = 'laxalab-gtm';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
    document.head.appendChild(script);
}

/**
 * Called after the user saves their preferences. Loads the relevant tags
 * only for the categories the user approved.
 */
export function applyConsent(prefs: ConsentPrefs): void {
    if (typeof window === 'undefined') return;
    if (prefs.analytics) {
        loadGA4();
        if (window.gtag) {
            window.gtag('consent', 'update', {
                analytics_storage: 'granted',
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
            });
        }
    } else if (window.gtag) {
        window.gtag('consent', 'update', {
            analytics_storage: 'denied',
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
        });
    }
    if (prefs.marketing) loadGTM();
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

export function trackEvent(eventName: string, params?: Record<string, unknown>): void {
    if (typeof window === 'undefined' || !GA4_ID || !/^G-[A-Z0-9]+$/i.test(GA4_ID) || !isAnalyticsApproved()) return;
    ensureGtag()('event', eventName, {
        ...params,
        page_location: `${window.location.origin}${window.location.pathname}`,
    });
}

export function trackPageView(pathname: string, title: string): void {
    if (!pathname || typeof window === 'undefined' || !isAnalyticsApproved()) return;
    trackEvent('page_view', {
        page_title: title,
        page_location: `${window.location.origin}${pathname}`,
        page_path: pathname,
    });
}