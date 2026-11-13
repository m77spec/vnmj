import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const SETTINGS_ID = 'singleton';
const SECTION_IDS = ['hero', 'features', 'stats', 'courses', 'about', 'contact', 'cta'];
const STAT_IDS = ['courses', 'instructors', 'enrollments', 'certificates'];
const CONTENT_KEYS = [
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
];

type SettingsRow = {
    draft: Prisma.JsonValue;
    published: Prisma.JsonValue | null;
    updatedAt: Date;
    publishedAt: Date | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class HomepageService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async publicConfig(): Promise<Prisma.JsonValue | null> {
        const row = await this.prisma.homepageSettings.findUnique({
            where: { id: SETTINGS_ID },
            select: { published: true },
        });
        return row?.published ?? null;
    }

    async adminState() {
        const row = await this.prisma.homepageSettings.findUnique({
            where: { id: SETTINGS_ID },
            select: {
                draft: true,
                published: true,
                updatedAt: true,
                publishedAt: true,
            },
        });
        return {
            draft: row?.draft ?? null,
            published: row?.published ?? null,
            updatedAt: row?.updatedAt ?? null,
            publishedAt: row?.publishedAt ?? null,
        };
    }

    async saveDraft(input: unknown, actorId: string) {
        this.validateConfig(input);
        const config = input as Prisma.InputJsonValue;
        const row = await this.prisma.homepageSettings.upsert({
            where: { id: SETTINGS_ID },
            create: {
                id: SETTINGS_ID,
                draft: config,
                updatedById: actorId,
            },
            update: {
                draft: config,
                updatedById: actorId,
            },
            select: { updatedAt: true },
        });
        await this.audit.logAction('Updated homepage draft', undefined, actorId);
        return { saved: true, updatedAt: row.updatedAt };
    }

    async publish(actorId: string) {
        const row = await this.prisma.homepageSettings.findUnique({
            where: { id: SETTINGS_ID },
            select: { draft: true },
        }) as SettingsRow | null;
        if (!row) throw new BadRequestException('Save a homepage draft before publishing');
        this.validateConfig(row.draft);
        const now = new Date();
        await this.prisma.homepageSettings.update({
            where: { id: SETTINGS_ID },
            data: {
                published: row.draft as Prisma.InputJsonValue,
                publishedAt: now,
                publishedById: actorId,
            },
        });
        await this.audit.logAction('Published homepage configuration', undefined, actorId);
        return { published: true, publishedAt: now };
    }

    async discardDraft(actorId: string) {
        const row = await this.prisma.homepageSettings.findUnique({
            where: { id: SETTINGS_ID },
            select: { published: true },
        });
        if (!row?.published) {
            throw new BadRequestException('There is no published homepage to restore');
        }
        await this.prisma.homepageSettings.update({
            where: { id: SETTINGS_ID },
            data: { draft: row.published as Prisma.InputJsonValue, updatedById: actorId },
        });
        await this.audit.logAction('Restored homepage draft from published version', undefined, actorId);
        return { restored: true };
    }

    private validateConfig(value: unknown): asserts value is Record<string, unknown> {
        if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 50_000) {
            throw new BadRequestException('Homepage configuration must be a JSON object under 50 KB');
        }
        if (!Array.isArray(value.sections) || value.sections.length !== SECTION_IDS.length) {
            throw new BadRequestException('Homepage sections are invalid');
        }
        const sectionIds = new Set<string>();
        for (const section of value.sections) {
            if (!isRecord(section) || typeof section.id !== 'string' ||
                !SECTION_IDS.includes(section.id) || sectionIds.has(section.id) ||
                typeof section.visible !== 'boolean') {
                throw new BadRequestException('Homepage section configuration is invalid');
            }
            sectionIds.add(section.id);
        }
        if (sectionIds.size !== SECTION_IDS.length) {
            throw new BadRequestException('All homepage sections must be included');
        }

        if (!isRecord(value.content)) throw new BadRequestException('Homepage content is invalid');
        for (const [key, localized] of Object.entries(value.content)) {
            if (!CONTENT_KEYS.includes(key) || !isRecord(localized)) {
                throw new BadRequestException(`Unsupported homepage content field: ${key}`);
            }
            for (const language of ['ar', 'en']) {
                if (typeof localized[language] !== 'string' || (localized[language] as string).length > 2000) {
                    throw new BadRequestException(`Homepage text ${key}.${language} must be a string under 2000 characters`);
                }
            }
        }

        if (!Array.isArray(value.stats) || value.stats.length !== STAT_IDS.length) {
            throw new BadRequestException('Homepage statistics are invalid');
        }
        const statIds = new Set<string>();
        for (const stat of value.stats) {
            if (!isRecord(stat) || typeof stat.id !== 'string' || !STAT_IDS.includes(stat.id) ||
                statIds.has(stat.id) || !['AUTO', 'MANUAL', 'HIDDEN'].includes(String(stat.mode)) ||
                !Number.isSafeInteger(stat.value) || Number(stat.value) < 0 || Number(stat.value) > 1_000_000_000) {
                throw new BadRequestException('Homepage statistic configuration is invalid');
            }
            statIds.add(stat.id);
        }
        if (statIds.size !== STAT_IDS.length) throw new BadRequestException('All homepage statistics must be included');

        if (!Array.isArray(value.socials) || value.socials.length !== 7) {
            throw new BadRequestException('Homepage social links are invalid');
        }
        const socialIds = new Set<string>();
        for (const social of value.socials) {
            if (!isRecord(social) || typeof social.id !== 'string' || socialIds.has(social.id) ||
                !['youtube', 'instagram', 'telegram', 'x', 'facebook', 'linkedin', 'whatsapp_channel'].includes(social.id) ||
                typeof social.label !== 'string' || social.label.length > 80 ||
                typeof social.handle !== 'string' || social.handle.length > 120 ||
                typeof social.url !== 'string' || social.url.length > 500 ||
                !/^https:\/\/[^\s]+$/i.test(social.url)) {
                throw new BadRequestException('Each social link must have a valid HTTPS URL and short labels');
            }
            socialIds.add(social.id);
        }
    }
}
