import ar from './locales/ar.json';
import en from './locales/en.json';

export type LocalizedValue = { ar: string; en: string };
export type HomepageSectionId = 'hero' | 'features' | 'stats' | 'courses' | 'about' | 'contact' | 'cta';
export type HomepageConfig = {
    sections: Array<{ id: HomepageSectionId; visible: boolean }>;
    content: Record<string, LocalizedValue>;
    stats: Array<{
        id: 'courses' | 'instructors' | 'enrollments' | 'certificates';
        mode: 'AUTO' | 'MANUAL' | 'HIDDEN';
        value: number;
    }>;
    socials: Array<{ id: 'youtube' | 'instagram' | 'telegram' | 'x' | 'facebook' | 'linkedin' | 'whatsapp_channel'; label: string; handle: string; url: string }>;
};

const landingKeys = [
    'hero_badge', 'hero_title', 'hero_desc', 'hero_explore', 'hero_instructor',
    'trust_payment', 'trust_instructors', 'trust_anytime',
    'why_heading', 'why_desc',
    'feature_1_title', 'feature_1_desc', 'feature_2_title', 'feature_2_desc', 'feature_3_title', 'feature_3_desc',
    'stats_heading', 'stats_courses', 'stats_instructors', 'stats_enrollments', 'stats_certificates',
    'home_courses_heading', 'home_courses_desc', 'home_courses_view_all',
    'home_about_heading', 'home_about_paragraph_1', 'home_about_paragraph_2', 'home_about_cta',
    'about_value_1_title', 'about_value_1_desc', 'about_value_2_title', 'about_value_2_desc',
    'about_value_3_title', 'about_value_3_desc', 'about_value_4_title', 'about_value_4_desc',
    'home_contact_heading', 'home_contact_desc', 'contact_email_label', 'contact_email',
    'contact_hours_label', 'contact_hours', 'contact_phone_title', 'contact_phone',
    'contact_call_button', 'contact_whatsapp_button', 'contact_social_title',
    'cta_heading', 'cta_desc', 'cta_register', 'cta_browse',
] as const;

const arLanding = ar.landing as Record<string, string>;
const enLanding = en.landing as Record<string, string>;

export const DEFAULT_HOMEPAGE_CONFIG: HomepageConfig = {
    sections: [
        { id: 'hero', visible: true },
        { id: 'features', visible: true },
        { id: 'stats', visible: true },
        { id: 'courses', visible: true },
        { id: 'about', visible: true },
        { id: 'contact', visible: true },
        { id: 'cta', visible: true },
    ],
    content: Object.fromEntries(landingKeys.map((key) => [
        key,
        { ar: arLanding[key] ?? '', en: enLanding[key] ?? '' },
    ])),
    stats: [
        { id: 'courses', mode: 'AUTO', value: 0 },
        { id: 'instructors', mode: 'AUTO', value: 0 },
        { id: 'enrollments', mode: 'AUTO', value: 0 },
        { id: 'certificates', mode: 'AUTO', value: 0 },
    ],
    socials: [
        { id: 'youtube', label: 'YouTube', handle: '@laxalabacademy', url: 'https://www.youtube.com/@laxalabacademy' },
        { id: 'instagram', label: 'Instagram', handle: '@laxalabacademy', url: 'https://www.instagram.com/laxalabacademy' },
        { id: 'telegram', label: 'Telegram', handle: '@laxalabacademy', url: 'https://t.me/laxalabacademy' },
        { id: 'x', label: 'X (Twitter)', handle: '@laxalabacademy', url: 'https://x.com/laxalabacademy' },
        { id: 'facebook', label: 'Facebook', handle: 'laxalabacademy', url: 'https://facebook.com/laxalabacademy' },
        { id: 'linkedin', label: 'LinkedIn', handle: 'Laxalab Academy', url: 'https://www.linkedin.com/company/laxalab-academy/' },
        { id: 'whatsapp_channel', label: 'WhatsApp Channel', handle: 'Laxalab Academy', url: 'https://whatsapp.com/channel/0029VbD1bFgCsU9Tqtwwrk0R' },
    ],
};

export const HOMEPAGE_FIELD_GROUPS = [
    { id: 'hero', titleAr: 'الواجهة الرئيسية', titleEn: 'Hero section', keys: ['hero_badge', 'hero_title', 'hero_desc', 'hero_explore', 'hero_instructor', 'trust_payment', 'trust_instructors', 'trust_anytime'] },
    { id: 'features', titleAr: 'مميزات المنصة', titleEn: 'Platform features', keys: ['why_heading', 'why_desc', 'feature_1_title', 'feature_1_desc', 'feature_2_title', 'feature_2_desc', 'feature_3_title', 'feature_3_desc'] },
    { id: 'stats', titleAr: 'الإحصائيات', titleEn: 'Statistics', keys: ['stats_heading', 'stats_courses', 'stats_instructors', 'stats_enrollments', 'stats_certificates'] },
    { id: 'courses', titleAr: 'الدورات المميزة', titleEn: 'Featured courses', keys: ['home_courses_heading', 'home_courses_desc', 'home_courses_view_all'] },
    { id: 'about', titleAr: 'عن المنصة', titleEn: 'About the platform', keys: ['home_about_heading', 'home_about_paragraph_1', 'home_about_paragraph_2', 'home_about_cta', 'about_value_1_title', 'about_value_1_desc', 'about_value_2_title', 'about_value_2_desc', 'about_value_3_title', 'about_value_3_desc', 'about_value_4_title', 'about_value_4_desc'] },
    { id: 'contact', titleAr: 'التواصل', titleEn: 'Contact details', keys: ['home_contact_heading', 'home_contact_desc', 'contact_email_label', 'contact_email', 'contact_hours_label', 'contact_hours', 'contact_phone_title', 'contact_phone', 'contact_call_button', 'contact_whatsapp_button', 'contact_social_title'] },
    { id: 'cta', titleAr: 'الدعوة للتسجيل', titleEn: 'Registration call to action', keys: ['cta_heading', 'cta_desc', 'cta_register', 'cta_browse'] },
] as const;

export function mergeHomepageConfig(value: unknown): HomepageConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(DEFAULT_HOMEPAGE_CONFIG);
    const incoming = value as Partial<HomepageConfig>;
    const defaultSections = DEFAULT_HOMEPAGE_CONFIG.sections;
    const incomingSections = Array.isArray(incoming.sections) ? incoming.sections : [];
    const sections = defaultSections.map((defaultItem) => ({
        ...defaultItem,
        ...(incomingSections.find((item) => item?.id === defaultItem.id) ?? {}),
    }));
    sections.sort((left, right) => {
        const leftIndex = incomingSections.findIndex((item) => item?.id === left.id);
        const rightIndex = incomingSections.findIndex((item) => item?.id === right.id);
        return (leftIndex < 0 ? defaultSections.findIndex((item) => item.id === left.id) : leftIndex)
            - (rightIndex < 0 ? defaultSections.findIndex((item) => item.id === right.id) : rightIndex);
    });
    const content = { ...DEFAULT_HOMEPAGE_CONFIG.content };
    if (incoming.content && typeof incoming.content === 'object') {
        for (const key of Object.keys(content)) {
            const item = incoming.content[key];
            if (item && typeof item.ar === 'string' && typeof item.en === 'string') {
                content[key] = { ar: item.ar, en: item.en };
            }
        }
    }
    const stats = DEFAULT_HOMEPAGE_CONFIG.stats.map((defaultItem) => {
        const item = incoming.stats?.find((candidate) => candidate?.id === defaultItem.id);
        return item && ['AUTO', 'MANUAL', 'HIDDEN'].includes(item.mode) && Number.isSafeInteger(item.value) && item.value >= 0
            ? { ...defaultItem, mode: item.mode, value: item.value }
            : defaultItem;
    });
    const socials = DEFAULT_HOMEPAGE_CONFIG.socials.map((defaultItem) => {
        const item = incoming.socials?.find((candidate) => candidate?.id === defaultItem.id);
        return item && typeof item.label === 'string' && typeof item.handle === 'string' && /^https:\/\/[^\s]+$/i.test(item.url)
            ? { ...defaultItem, label: item.label, handle: item.handle, url: item.url }
            : defaultItem;
    });
    return { sections, content, stats, socials };
}

export function localizedHomepageText(config: HomepageConfig, key: string, locale: string) {
    const item = config.content[key];
    return item?.[locale === 'ar' ? 'ar' : 'en'] ?? '';
}
