import { Role } from '@prisma/client';

export function getUserDisplayNames(user: { role: Role; metadata?: unknown }) {
    const metadata = user.metadata && typeof user.metadata === 'object' && !Array.isArray(user.metadata)
        ? user.metadata as Record<string, unknown>
        : {};
    const official = [metadata.nameAr, metadata.nameEn, metadata.fullName]
        .filter((name): name is string => typeof name === 'string' && !!name.trim());
    const alias = typeof metadata.inboxDisplayName === 'string' ? metadata.inboxDisplayName.trim() : '';
    const selected = user.role === Role.STUDENT && metadata.inboxUseOfficialName !== true && alias
        ? alias
        : null;
    const fallback = selected || official[0] || null;

    return {
        nameAr: selected || (typeof metadata.nameAr === 'string' && metadata.nameAr.trim()) || fallback,
        nameEn: selected || (typeof metadata.nameEn === 'string' && metadata.nameEn.trim()) || fallback,
    };
}
