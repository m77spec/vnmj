"use client";

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ANALYTICS_CONSENT_EVENT, applyConsent, trackEvent, trackPageView } from '@/lib/analytics';
import { readConsent } from '@/lib/consent';

export default function AnalyticsTracker() {
    const pathname = usePathname();
    const lastTrackedPath = useRef<string | null>(null);

    useEffect(() => {
        if (!pathname) return;

        const trackCurrentPage = () => {
            if (lastTrackedPath.current === pathname) return;
            trackPageView(pathname, document.title);
            if (readConsent()?.analytics) lastTrackedPath.current = pathname;
        };
        const onConsentChange = () => {
            if (!readConsent()?.analytics) lastTrackedPath.current = null;
            trackCurrentPage();
        };
        const onClick = (event: MouseEvent) => {
            if (pathname.startsWith('/dashboard') || pathname.startsWith('/operations')) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const element = target.closest('button, a[href]');
            if (!element) return;
            const label = (element.getAttribute('aria-label') || element.textContent || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 80);
            if (!label) return;
            trackEvent('ui_click', {
                element_type: element.tagName.toLowerCase(),
                element_label: label,
            });
        };

        window.addEventListener(ANALYTICS_CONSENT_EVENT, onConsentChange);
        document.addEventListener('click', onClick, true);
        const saved = readConsent();
        if (saved) applyConsent(saved);
        trackCurrentPage();

        return () => {
            window.removeEventListener(ANALYTICS_CONSENT_EVENT, onConsentChange);
            document.removeEventListener('click', onClick, true);
        };
    }, [pathname]);

    return null;
}
