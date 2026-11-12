import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role, EnrollmentStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { hasValidUploadedSignature } from '../common/file-signatures';
import { removeStoredUpload, removeUploadedFile } from '../common/upload-storage';
import { PROFILE_KEY, sanitizeInstructorProfile } from '../common/instructor-profile';
import { UserCacheService } from '../common/user-cache.service';
import { CreateUserDto, UpdateUserDto, UpdateMeDto } from './dto/user.dto';

@Injectable()
export class UsersService {
    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private userCache: UserCacheService,
    ) { }

    async findAll() {
        return this.prisma.user.findMany({
            select: { id: true, email: true, role: true, isActive: true, twoFactorEnabled: true, metadata: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findOne(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, role: true, isActive: true, metadata: true, createdAt: true }
        });
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async getDetails(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                role: true,
                isActive: true,
                metadata: true,
                language: true,
                emailVerifiedAt: true,
                twoFactorEnabled: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        if (!user) throw new NotFoundException('User not found');

        const [enrollments, certificates, coursesTaught, openingsTaught] = await Promise.all([
            this.prisma.enrollment.findMany({
                where: { studentId: id },
                include: {
                    course: { select: { id: true, titleAr: true, titleEn: true } },
                    opening: { select: { id: true, nameAr: true, nameEn: true, startDate: true, endDate: true } },
                },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.certificate.findMany({
                where: { studentId: id },
                select: { id: true, verificationCode: true, issuingDate: true, verificationStatus: true, courseId: true },
                orderBy: { issuingDate: 'desc' },
            }),
            this.prisma.course.findMany({
                where: { instructorId: id },
                select: { id: true, titleAr: true, titleEn: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.courseOpening.findMany({
                where: { instructorId: id },
                select: { id: true, nameAr: true, nameEn: true, status: true, startDate: true, endDate: true },
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        return { user, enrollments, certificates, coursesTaught, openingsTaught };
    }

    async getMe(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true, email: true, role: true, isActive: true, metadata: true,
                createdAt: true, updatedAt: true, language: true, emailVerifiedAt: true,
                twoFactorEnabled: true,
            },
        });
        if (!user) throw new NotFoundException('User not found');

        const canSeePending = user.role === Role.FINANCE || user.role === Role.ADMIN;

        const [
            enrollments,
            certificates,
            coursesTaught,
            openingsTaught,
            pendingEnrollments,
            tickets,
            unreadMessages,
            unreadNotifications,
        ] = await Promise.all([
            this.prisma.enrollment.count({ where: { studentId: user.id } }),
            this.prisma.certificate.count({ where: { studentId: user.id } }),
            this.prisma.course.count({ where: { instructorId: user.id } }),
            this.prisma.courseOpening.count({ where: { instructorId: user.id } }),
            canSeePending ? this.prisma.enrollment.count({ where: { status: EnrollmentStatus.PENDING } }) : Promise.resolve(0),
            this.prisma.supportTicket.count({ where: { userId: user.id } }),
            this.prisma.message.count({ where: { recipientId: user.id, readAt: null } }),
            this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
        ]);

        return {
            ...user,
            stats: {
                enrollments,
                certificates,
                coursesTaught,
                openingsTaught,
                pendingEnrollments,
                tickets,
                unreadMessages,
                unreadNotifications,
            },
        };
    }

    /**
     * Profile `metadata` is free-form JSON, so anything a client sends used to be
     * stored verbatim. That let a caller park a `javascript:` string in
     * `avatarUrl` (stored XSS once rendered into an `src`) or an off-site
     * tracking pixel. Only the known profile keys survive, capped, and
     * `avatarUrl` is restricted to a path under our own uploads directory.
     */
    private sanitizeProfileMetadata(input: Record<string, unknown>): Record<string, unknown> {
        // Every key the register form collects. An omitted key is preserved and
        // an empty one clears, which is what PATCH means and what lets the
        // dedicated instructor CV page save only its own fields. The sanitiser
        // used to drop empty strings, which meant a stored value fell back into
        // the merge and could never be deleted: a teacher who erased a wrong job
        // title saved the change and watched the text return. `key in input` is
        // what separates "not mentioned" from "mentioned and emptied".
        const LIMITS: Record<string, number> = {
            fullName: 120,
            nameAr: 120,
            nameEn: 120,
            country: 80,
            city: 80,
            phone: 32,
            bio: 500,
            specialty: 120,
            gender: 16,
            birthDate: 10,
            university: 120,
            studyStatus: 20,
            studyLevel: 80,
            inboxDisplayName: 80,
            // Instructor CV. `jobTitle*` is bilingual because the public
            // profile is served to both locales, and `bioEn` falls back to
            // `bio` when an instructor has not written an English summary.
            jobTitleAr: 120,
            jobTitleEn: 120,
            bioEn: 500,
        };
        const out: Record<string, unknown> = {};

        if (
            'inboxDisplayName' in input
            && input.inboxDisplayName !== null
            && typeof input.inboxDisplayName !== 'string'
        ) {
            throw new BadRequestException('inboxDisplayName must be a string');
        }

        for (const [key, max] of Object.entries(LIMITS)) {
            // Absent means "leave it alone", so a partial PATCH is safe.
            if (!(key in input)) continue;
            const v = input[key];
            if (key === 'gender' && v !== null && v !== '' && v !== 'MALE' && v !== 'FEMALE') {
                throw new BadRequestException('Gender must be MALE or FEMALE');
            }
            // Explicit null, or a string that trims away to nothing, is a clear.
            if (v === null || (typeof v === 'string' && !v.trim())) {
                out[key] = null;
                continue;
            }
            if (typeof v !== 'string') continue;
            out[key] = v.trim().slice(0, max);
        }

        if ('inboxUseOfficialName' in input) {
            if (typeof input.inboxUseOfficialName !== 'boolean') {
                throw new BadRequestException('inboxUseOfficialName must be a boolean');
            }
            out.inboxUseOfficialName = input.inboxUseOfficialName;
        }

        if ('age' in input) {
            const value = input.age;
            if (value === null || value === '') {
                out.age = null;
            } else {
                const age = typeof value === 'number' ? value : Number(String(value).trim());
                if (!Number.isInteger(age) || age < 1 || age > 120) {
                    throw new BadRequestException('Age must be a whole number between 1 and 120');
                }
                out.age = age;
            }
        }

        // Years of experience is a count, not prose. Accept a number or a
        // numeric string (form inputs hand back strings) and clamp it to a
        // believable range, so nobody renders "9999 years of experience".
        const yearsRaw = input.experienceYears;
        if (yearsRaw === '' || yearsRaw === null) {
            // Same absent/empty split, so a teacher can drop the number again.
            out.experienceYears = null;
        } else if (yearsRaw !== undefined) {
            const parsed = typeof yearsRaw === 'number' ? yearsRaw : Number(String(yearsRaw).trim());
            if (Number.isFinite(parsed) && parsed >= 0) {
                out.experienceYears = Math.min(Math.round(parsed), 80);
            }
        }

        // A birth date is a calendar day, so keep only the shape the register
        // DTO accepts. An arbitrary string here would render as a nonsense
        // "date of birth" that no longer parses.
        if (typeof out.birthDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(out.birthDate)) {
            delete out.birthDate;
        }

        const avatar = input.avatarUrl;
        if (typeof avatar === 'string') {
            const trimmed = avatar.trim();
            // Same-origin path only. Rejects absolute URLs, protocol-relative
            // "//evil.com", and javascript:/data: payloads. The character class
            // admits "." so ".." needs its own check or /uploads/../x escapes
            // the uploads directory.
            if (/^\/uploads\/[A-Za-z0-9._\/-]+$/.test(trimmed) && !trimmed.includes('..')) {
                out.avatarUrl = trimmed;
            } else if (trimmed === '') {
                out.avatarUrl = null;
            }
        }

        // The instructor's public profile is namespaced and validated by its own
        // module, because it is a different thing from the account details above
        // and has different rules (structured lists, per-field caps, https-only
        // links). An absent key means "leave the stored profile alone", so the
        // ordinary profile PATCH cannot wipe a CV it knows nothing about.
        if (PROFILE_KEY in input) {
            out[PROFILE_KEY] = sanitizeInstructorProfile(input[PROFILE_KEY]);
        }

        return out;
    }

    /**
     * Stores an uploaded avatar and points metadata.avatarUrl at it.
     *
     * The declared Content-Type is client-controlled, so the magic bytes are
     * verified before the path is trusted. The previous avatar is removed from
     * disk on success so replacing a picture does not leave orphans, but only
     * after the new one is safely recorded: if the write fails the old picture
     * stays and the user is not left with a broken reference.
     */
    async setAvatar(userId: string, file: Express.Multer.File) {
        if (!hasValidUploadedSignature(file)) {
            await removeUploadedFile(file);
            throw new BadRequestException('The uploaded file is not a valid image.');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { metadata: true },
        });
        if (!user) {
            await removeUploadedFile(file);
            throw new NotFoundException('User not found');
        }

        const previous = (user.metadata as Record<string, unknown> | null)?.avatarUrl;
        const publicPath = `/uploads/avatars/${file.filename}`;

        // Goes through the same sanitiser as PATCH /users/me, so an avatar can
        // only ever be a path inside our own uploads directory.
        let updated;
        try {
            updated = await this.prisma.user.update({
                where: { id: userId },
                data: {
                    metadata: this.sanitizeProfileMetadata({
                        ...((user.metadata as Record<string, unknown>) ?? {}),
                        avatarUrl: publicPath,
                    }) as unknown as Prisma.InputJsonObject,
                },
                select: { id: true, metadata: true },
            });
        } catch (err) {
            await removeUploadedFile(file);
            throw err;
        }

        const previousAvatar = typeof previous === 'string'
            ? /^\/uploads\/avatars\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(previous)
            : null;
        const previousAvatarPath = previousAvatar ? `/uploads/avatars/${previousAvatar[1]}` : null;
        if (previousAvatarPath && previousAvatarPath !== publicPath) {
            await removeStoredUpload(previousAvatarPath);
        }

        return { avatarUrl: publicPath, metadata: updated.metadata };
    }

    async updateMe(userId: string, dto: UpdateMeDto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const wantsCredentialChange = Boolean(dto.email) || Boolean(dto.password);
        if (wantsCredentialChange) {
            if (!dto.currentPassword) {
                throw new BadRequestException('currentPassword is required to change email or password');
            }
            const pwMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
            if (!pwMatches) {
                throw new BadRequestException('Current password is incorrect');
            }
        }

        const data: {
            email?: string;
            passwordHash?: string;
            metadata?: Prisma.InputJsonObject;
            language?: string;
            mustChangePassword?: boolean;
            tokenVersion?: { increment: number };
        } = {};

        if (dto.email && dto.email !== user.email) {
            const conflict = await this.prisma.user.findUnique({ where: { email: dto.email } });
            if (conflict) throw new ConflictException('Email already in use');
            data.email = dto.email;
            // Changing email invalidates verification; that is handled by
            // clearing emailVerifiedAt below, not by touching metadata.
        }

        if (dto.password) {
            data.passwordHash = await bcrypt.hash(dto.password, 12);
            // A voluntary change satisfies any forced-change requirement.
            data.mustChangePassword = false;
            // Changing the password ends every other session. Without this an
            // access token minted under the old password kept working until it
            // expired, which is exactly the moment a user changes their password
            // because someone else may have it.
            data.tokenVersion = { increment: 1 };
        }

        if (dto.language) {
            data.language = dto.language;
        }

        if (dto.metadata) {
            const currentMetadata = (user.metadata as Record<string, unknown> | null) ?? {};
            const incomingMetadata = dto.metadata as Record<string, unknown>;
            const merged = {
                ...currentMetadata,
                ...this.sanitizeProfileMetadata(incomingMetadata),
            };
            if (currentMetadata.googleOnboardingPending === true && incomingMetadata.googleOnboardingPending === false) {
                const studyStatus = merged.studyStatus;
                if (
                    typeof merged.fullName !== 'string' || !merged.fullName.trim()
                    || typeof merged.university !== 'string' || !merged.university.trim()
                    || typeof merged.age !== 'number'
                    || !['STUDENT', 'GRADUATE', 'OTHER'].includes(String(studyStatus))
                    || (studyStatus === 'STUDENT' && (typeof merged.studyLevel !== 'string' || !merged.studyLevel.trim()))
                ) {
                    throw new BadRequestException('Complete the required personal and academic information');
                }
                merged.googleOnboardingPending = false;
            }
            data.metadata = merged as unknown as Prisma.InputJsonObject;
        }

        if (dto.email && dto.email !== user.email) {
            await this.prisma.user.update({
                where: { id: userId },
                data: { emailVerifiedAt: null },
            });
        }

        const updated = await this.prisma.user.update({
            where: { id: userId },
            data,
            select: { id: true, email: true, role: true, isActive: true, metadata: true, createdAt: true, updatedAt: true, language: true, emailVerifiedAt: true, twoFactorEnabled: true },
        });

        // Revoke every refresh token as well: the tokenVersion bump stops the
        // access tokens, but without this the holder of a stolen refresh token
        // would simply mint a new one under the new password.
        if (dto.password) {
            await this.prisma.refreshToken.updateMany({
                where: { userId },
                data: { revokedAt: new Date() },
            });
        }

        await this.audit.logAction(`User ${userId} updated their profile${data.email ? ' (email changed)' : ''}${data.passwordHash ? ' (password changed)' : ''}`);

        // Email is part of the cached identity and is what the token carries, and
        // a password change bumps tokenVersion, so both have to be visible on the
        // next request rather than after the cache TTL.
        if (data.email || dto.password) {
            await this.userCache.invalidate(userId);
        }
        return updated;
    }

    async exportMyData(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const [profile, enrollments, certificates, coursesTaught, tickets, messagesSent, messagesReceived, payments, notifications] =
            await Promise.all([
                this.prisma.user.findUnique({
                    where: { id: userId },
                    select: { id: true, email: true, role: true, isActive: true, language: true, emailVerifiedAt: true, createdAt: true, metadata: true },
                }),
                this.prisma.enrollment.findMany({ where: { studentId: userId }, include: { course: { select: { titleAr: true, titleEn: true } }, opening: { select: { id: true, nameAr: true, nameEn: true, price: true, currency: true } } } }),
                this.prisma.certificate.findMany({ where: { studentId: userId }, select: { id: true, verificationCode: true, issuingDate: true, verificationStatus: true } }),
                this.prisma.course.findMany({ where: { instructorId: userId }, select: { id: true, titleAr: true, titleEn: true, createdAt: true } }),
                this.prisma.supportTicket.findMany({ where: { userId }, select: { id: true, subject: true, message: true, status: true, createdAt: true } }),
                this.prisma.message.findMany({ where: { senderId: userId }, select: { content: true, createdAt: true, recipientId: true } }),
                this.prisma.message.findMany({ where: { recipientId: userId }, select: { content: true, createdAt: true, senderId: true } }),
                this.prisma.payment.findMany({ where: { studentId: userId } }),
                this.prisma.notification.findMany({ where: { userId }, select: { type: true, titleEn: true, bodyEn: true, readAt: true, createdAt: true } }),
            ]);

        return {
            exportedAt: new Date().toISOString(),
            profile,
            enrollments,
            certificates,
            coursesTaught,
            supportTickets: tickets,
            messagesSent,
            messagesReceived,
            payments,
            notifications,
        };
    }

    async deleteMyAccount(userId: string, currentPassword: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const pwMatches = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!pwMatches) throw new BadRequestException('Password is incorrect');

        await this.prisma.$transaction([
            this.prisma.refreshToken.deleteMany({ where: { userId } }),
            this.prisma.notification.deleteMany({ where: { userId } }),
            this.prisma.message.deleteMany({ where: { OR: [{ senderId: userId }, { recipientId: userId }] } }),
        ]);

        try {
            await this.prisma.user.delete({ where: { id: userId } });
            await this.audit.logAction(`User ${userId} deleted their own account (GDPR)`);
            return { ok: true, deleted: true };
        } catch {
            // Hard delete blocked by relational integrity — anonymize instead (GDPR erasure equivalent)
            const anonEmail = `deleted-${randomUUID()}@laxalab.local`;
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    email: anonEmail,
                    passwordHash: await bcrypt.hash(randomUUID(), 12),
                    isActive: false,
                    twoFactorEnabled: false,
                    twoFactorSecret: null,
                    emailVerifiedAt: null,
                    metadata: { anonymized: true, anonymizedAt: new Date().toISOString() },
                },
            });
            await this.audit.logAction(`User ${userId} account anonymized (GDPR) because of relational constraints`);
            return { ok: true, deleted: false, anonymized: true };
        }
    }

    async create(dto: CreateUserDto, adminId: string, ip?: string) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing) {
            throw new ConflictException('Email already in use');
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash,
                role: dto.role ?? Role.STUDENT,
                isActive: dto.isActive ?? true,
                ...(dto.metadata ? { metadata: this.sanitizeProfileMetadata(dto.metadata) as Prisma.InputJsonValue } : {}),
                // Admin-provided passwords must be replaced by the user on first login.
                mustChangePassword: dto.mustChangePassword !== false,
            },
            select: { id: true, email: true, role: true, isActive: true, createdAt: true },
        });

        await this.audit.logAction(`ADMIN ${adminId} created user ${user.id} (${user.email}) with role ${user.role}`, ip, adminId);
        return user;
    }

    async update(id: string, dto: UpdateUserDto, adminId: string, ip?: string) {
        const existing = await this.prisma.user.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('User not found');

        if (dto.email && dto.email !== existing.email) {
            const conflict = await this.prisma.user.findUnique({ where: { email: dto.email } });
            if (conflict) throw new ConflictException('Email already in use');
        }

        const data: {
            email?: string;
            passwordHash?: string;
            role?: Role;
            isActive?: boolean;
            mustChangePassword?: boolean;
        } = {};
        if (dto.email) data.email = dto.email;
        if (dto.password) {
            data.passwordHash = await bcrypt.hash(dto.password, 10);
            // When the admin sets a password, force the user to replace it on next login.
            data.mustChangePassword = true;
        }
        if (dto.role) data.role = dto.role;
        if (typeof dto.isActive === 'boolean') data.isActive = dto.isActive;
        if (typeof dto.mustChangePassword === 'boolean') data.mustChangePassword = dto.mustChangePassword;

        const user = await this.prisma.user.update({
            where: { id },
            data,
            select: { id: true, email: true, role: true, isActive: true, mustChangePassword: true, createdAt: true },
        });

        // A forced password change must invalidate existing sessions so the next
        // login actually re-enters the change flow.
        if (dto.password) {
            await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
        }

        // This is the important one. An admin can suspend an account or demote it
        // from ADMIN here, and until now the very next request would have been
        // authorized from a cached copy of the old record -- so a suspension would
        // not have taken effect until the cache expired, and a demotion would
        // have left admin powers live for that long. Delete the entry after the
        // write, so the next request re-reads the truth.
        if (dto.role || typeof dto.isActive === 'boolean' || dto.password) {
            await this.userCache.invalidate(id);
        }

        await this.audit.logAction(`ADMIN ${adminId} updated user ${id} (${user.email})`, ip, adminId);
        return user;
    }

    async updateRole(id: string, newRole: Role, adminId: string, ip?: string) {
        await this.audit.logAction(`ADMIN ${adminId} changed user ${id} role to ${newRole}`, ip, adminId);
        const updated = await this.prisma.user.update({
            where: { id },
            data: { role: newRole },
            select: { id: true, email: true, role: true, isActive: true, createdAt: true },
        });
        // The dedicated PATCH /users/:id/role endpoint. A demotion from ADMIN has
        // to bite immediately, not when the cache happens to expire.
        await this.userCache.invalidate(id);
        return updated;
    }

    async setPublicInstructorVisibility(id: string, visible: boolean, adminId: string, ip?: string) {
        const existing = await this.prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, role: true, metadata: true },
        });
        if (!existing) throw new NotFoundException('User not found');
        if (existing.role !== Role.INSTRUCTOR) {
            throw new BadRequestException('Only instructor accounts can be listed in the public instructors directory');
        }

        const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
        const user = await this.prisma.user.update({
            where: { id },
            data: {
                metadata: { ...metadata, showOnInstructorsPage: visible } as Prisma.InputJsonObject,
            },
            select: { id: true, email: true, role: true, metadata: true },
        });

        await this.audit.logAction(
            `ADMIN ${adminId} ${visible ? 'listed' : 'hid'} instructor ${id} (${existing.email}) ${visible ? 'on' : 'from'} the public instructors page`,
            ip,
            adminId,
        );
        return { id: user.id, showOnInstructorsPage: visible };
    }

    async disableUserTwoFactor(id: string, adminId: string, ip?: string) {
        const existing = await this.prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, twoFactorEnabled: true },
        });
        if (!existing) throw new NotFoundException('User not found');
        if (!existing.twoFactorEnabled) return { ok: true, twoFactorEnabled: false };

        const [user] = await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id },
                data: {
                    twoFactorEnabled: false,
                    twoFactorSecret: null,
                    tokenVersion: { increment: 1 },
                },
                select: { id: true, email: true, twoFactorEnabled: true },
            }),
            this.prisma.refreshToken.updateMany({
                where: { userId: id, revokedAt: null },
                data: { revokedAt: new Date() },
            }),
        ]);

        await this.userCache.invalidate(id);
        await this.audit.logAction(
            `ADMIN ${adminId} disabled two-factor authentication for user ${id} (${existing.email})`,
            ip,
            adminId,
        );
        return { ok: true, twoFactorEnabled: user.twoFactorEnabled };
    }

    async remove(id: string, adminId: string, ip?: string) {
        await this.audit.logAction(`ADMIN ${adminId} deleted user ${id}`, ip, adminId);
        // Drop any cached identity. Without this a deleted account would keep
        // authenticating from cache until the TTL ran out.
        await this.userCache.invalidate(id);
        try {
            return await this.prisma.user.delete({ where: { id } });
        } catch (err) {
            // Several relations deliberately Restrict — a student's enrollments
            // and payments, an instructor's courses and openings — so refusing to
            // delete is correct. Letting the driver's error escape answered an
            // opaque 500, which reads like a server fault and leaves an admin
            // with nothing to act on.
            const refusal = this.describeDanglingReferences(err);
            if (refusal) throw new ConflictException(refusal);
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
                throw new NotFoundException('User not found');
            }
            throw err;
        }
    }

    /**
     * Postgres reports `RESTRICT` violations as SQLSTATE 23001, which the Prisma
     * engine surfaces as an *unknown* request error carrying the constraint name
     * in its message rather than as the documented `P2003`. Both spellings mean
     * the same thing, so both are translated here; catching only `P2003` left the
     * production 500 in place.
     */
    private describeDanglingReferences(err: unknown): object | null {
        const message = err instanceof Error ? err.message : String(err ?? '');
        // The engine prints the Postgres error with Rust's `Debug`, so the inner
        // quotes arrive escaped as `\"Enrollment_studentId_fkey\"`. Match both the
        // escaped and the plain spelling.
        const constraint =
            (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'
                ? (err.meta as any)?.field_name
                : undefined) ??
            message.match(/foreign key constraint \\?"([A-Za-z0-9_]+)\\?"/)?.[1];

        const isRestrictViolation =
            err instanceof Prisma.PrismaClientKnownRequestError
                ? err.code === 'P2003'
                : err instanceof Prisma.PrismaClientUnknownRequestError &&
                  /RESTRICT setting of foreign key|violates foreign key constraint/i.test(message);
        if (!isRestrictViolation) return null;

        const table = constraint?.split('_')[0];
        return {
            message: table
                ? `This user cannot be deleted because ${table} records still reference them.`
                : 'This user cannot be deleted because other records still reference them.',
            code: 'USER_HAS_REFERENCING_RECORDS',
            references: constraint ? [constraint] : [],
            hint: 'Deactivate the account instead, or remove the referenced records first.',
        };
    }
}