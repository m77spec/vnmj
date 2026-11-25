import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { I18nProvider } from '@/lib/i18n-context';
import { ThemeProvider } from '@/lib/theme-context';
import { Toaster } from 'react-hot-toast';
import { SITE_URL } from '@/lib/deployment-urls';
import CookieBanner from '@/components/CookieBanner';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import JsonLd from '@/components/JsonLd';
import GlobalBackButton from '@/components/GlobalBackButton';
import OperationsTracker from '@/components/OperationsTracker';
import StepUpProvider from '@/components/StepUpProvider';

const tajawal = localFont({
  src: [
    { path: '../fonts/tajawal-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/tajawal-700.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/tajawal-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-tajawal',
  display: 'swap',
});

const manrope = localFont({
  src: [
    { path: '../fonts/manrope-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/manrope-700.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/manrope-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Laxalab', template: '%s | Laxalab' },
  description: 'Laxalab — Professional online learning, certification and career development in Arabic and English.',
  alternates: {
    canonical: '/ar',
    languages: {
      'ar': '/ar',
      'en': '/en',
      'x-default': '/ar',
    },
  },
  openGraph: {
    title: 'Laxalab',
    description: 'Professional online learning, certification and career development in Arabic and English.',
    type: 'website',
    locale: 'ar_AR',
    url: SITE_URL,
    siteName: 'Laxalab',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1120',
};

async function getLocale(): Promise<'ar' | 'en'> {
  try {
    const store = await cookies();
    const value = store.get('laxalab_locale_v2')?.value;
    if (value === 'en' || value === 'ar') return value;
  } catch {
    // cookies() unavailable during static generation
  }
  return 'ar';
}

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Laxalab',
  url: SITE_URL,
  description: 'Professional online learning, certification and career development.',
  sameAs: [],
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Laxalab',
  url: SITE_URL,
  inLanguage: ['ar', 'en'],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <head>
        <JsonLd data={organizationJsonLd} />
        <JsonLd data={websiteJsonLd} />
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('laxalab_theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}",
          }}
        />
      </head>
      <body className={`${tajawal.variable} ${manrope.variable} font-sans min-h-screen bg-brand-white text-brand-charcoal`}>
        <ThemeProvider>
          <I18nProvider locale={locale}>
            <AuthProvider>
              <Toaster position="top-right" />
              {/* Serves the 403 step-up challenge: a fresh authenticator code
                  for refunds/certificates/payment-gateway actions. */}
              <StepUpProvider />
              {children}
              <AnalyticsTracker />
              {/* Mounted app-wide: the operations center records every visitor,
                  signed in or not, so this cannot live inside an admin tree. */}
              <OperationsTracker />
              <GlobalBackButton />
              <CookieBanner />
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}