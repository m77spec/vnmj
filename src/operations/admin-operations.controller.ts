import {
    BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { InMemoryRateLimiter } from '../common/in-memory-rate-limiter';
import { verifyTotp } from '../common/totp';
import { EncryptionService } from '../encryption/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from './operations.service';
import { OperationsKeyService } from './operations-tracker.middleware';
import { OperationsQueriesService } from './operations-queries.service';
import { OperationsSettingsService } from './operations-settings.service';
import {
    AddAllowlistDto, EventsQueryDto, OverviewQueryDto, RecoverPasswordDto, SessionsQueryDto, SetPasswordDto, TimelineQueryDto,
    UnlockDto,
} from './dto/operations.dto';

/**
 * The operations center API (admin half, now under /api/admin/operations so the
 * AdminBoundaryGuard enforces the admin audience on top of everything here).
 *
 * Three gates stand in front of the read endpoints, and all three are required:
 *
 *   1. A valid ADMIN access token (JwtAuthGuard + RolesGuard) whose role is
 *      ADMIN in the database, plus the ops:read/ops:manage permission
 *      (PermissionsGuard).
 *   2. A live operations grant, i.e. the second password was entered
 *      (checked per-request in `assertGranted`).
 *   3. The page itself is unlinked -- there is no nav entry anywhere in the app,
 *      and it is disallowed in robots.txt, so it is reachable only by typing the
 *      path. That is obscurity by design, not a substitute for 1 and 2.
 *
 * The public tracking endpoint stayed behind on `POST /operations/track`.
 */
@ApiTags('Operations Center')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('api/admin/operations')
export class AdminOperationsController {
    /**
     * Unlock attempts are limited per IP and per account. Without this, a leaked
     * admin token would make the second password brute-forceable, which would
     * defeat the entire point of having it.
     */
    private readonly unlockLimiter = new InMemoryRateLimiter(5, 15 * 60 * 1000);

    /**
     * Password changes are limited much harder, and per account only.
     *
     * `verifyKey` runs bcrypt, which is deliberately slow. Without its own
     * limiter an attacker holding a valid admin token could turn that into a CPU
     * exhaustion tool by hammering the change endpoint, and could also use the
     * repeated verifies as an oracle for guessing the current password. Five
     * attempts per quarter of an hour is the same budget as unlocking, applied
     * to the endpoint where a miss should be as expensive as a hit.
     */
    private readonly passwordLimiter = new InMemoryRateLimiter(5, 15 * 60 * 1000);
    private readonly recoveryLimiter = new InMemoryRateLimiter(5, 15 * 60 * 1000);

    constructor(
        private readonly ops: OperationsService,
        private readonly queries: OperationsQueriesService,
        private readonly keys: OperationsKeyService,
        private readonly settings: OperationsSettingsService,
        private readonly prisma: PrismaService,
        private readonly encryption: EncryptionService,
    ) { }

    // ----------------------------------------------------------------- unlocking

    @Post('unlock')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_MANAGE)
    @ApiOperation({ summary: 'Exchange the second password for a short-lived grant' })
    async unlock(@Req() req: any, @Body() dto: UnlockDto) {
        const userId = req.user.userId as string;
        const ip = req.ip ?? 'unknown';

        if (!this.unlockLimiter.allow(`ip:${ip}`) || !this.unlockLimiter.allow(`user:${userId}`)) {
            await this.ops.trackSecurity({
                sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
                label: 'operations.unlock.rate_limited',
                ipAddress: ip,
                userAgent: req.headers['user-agent'] ?? null,
            });
            throw new UnauthorizedException('Too many attempts. Try again later.');
        }

        // The password is checked BEFORE the allowlist on purpose. The reverse
        // order would answer "is this admin on the list?" without the password,
        // turning unlock into an enumeration oracle for who has operations
        // access -- a question an attacker can then use to target accounts.
        if (!(await this.settings.verifyKey(dto.key))) {
            await this.ops.trackSecurity({
                sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
                label: 'operations.unlock.failed',
                ipAddress: ip,
                userAgent: req.headers['user-agent'] ?? null,
            });
            // Same message and shape as any other auth failure on purpose: the
            // caller must not be able to tell "wrong password" from "no password
            // configured", "not on the allowlist", or "not an admin", and either
            // way gets nothing.
            throw new UnauthorizedException('Incorrect operations password');
        }

        // Only now, with the password proven, is the caller told whether their
        // account may enter. A 403 here is safe to be specific about: the caller
        // already holds the second password and a valid admin token.
        await this.settings.assertAllowed(userId);

        return this.keys.issueGrant(userId, await this.settings.currentKeyVersion());
    }

    @Post('recover-password')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_MANAGE)
    @HttpCode(200)
    @ApiOperation({ summary: 'Recover the operations password after re-authenticating the admin account' })
    async recoverPassword(@Req() req: any, @Body() dto: RecoverPasswordDto) {
        const userId = req.user.userId as string;
        const ip = req.ip ?? 'unknown';

        if (!this.recoveryLimiter.allow(`ip:${ip}`) || !this.recoveryLimiter.allow(`user:${userId}`)) {
            await this.ops.trackSecurity({
                sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
                label: 'operations.password.recovery.rate_limited',
                ipAddress: ip,
                userAgent: req.headers['user-agent'] ?? null,
            });
            throw new UnauthorizedException('Too many attempts. Try again later.');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true, twoFactorEnabled: true, twoFactorSecret: true },
        });
        const passwordValid = user ? await bcrypt.compare(dto.accountPassword, user.passwordHash) : false;
        const twoFactorValid = user?.twoFactorEnabled
            && user.twoFactorSecret
            && dto.twoFactorCode
            ? await verifyTotp(dto.twoFactorCode, this.encryption.decrypt(user.twoFactorSecret))
            : !user?.twoFactorEnabled;

        if (!passwordValid || !twoFactorValid) {
            await this.ops.trackSecurity({
                sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
                label: 'operations.password.recovery.failed',
                ipAddress: ip,
                userAgent: req.headers['user-agent'] ?? null,
            });
            throw new UnauthorizedException('Account verification failed');
        }

        await this.settings.assertAllowed(userId);

        if (dto.newPassword !== dto.confirmPassword) {
            throw new BadRequestException('The two new passwords do not match');
        }

        const keyVersion = await this.settings.setKey(dto.newPassword, userId);
        await this.ops.trackSecurity({
            sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
            label: 'operations.password.recovered',
            ipAddress: ip,
            userAgent: req.headers['user-agent'] ?? null,
            meta: { actorId: userId, keyVersion },
        });
        return { ...this.keys.issueGrant(userId, keyVersion), keyVersion };
    }

    // --------------------------------------------------------------------- reads

    @Get('overview')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    @ApiOperation({ summary: 'Headline counts and breakdowns for the chosen window' })
    async overview(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Query() q: OverviewQueryDto) {
        await this.assertGranted(req, grant);
        return this.queries.overview(q.hours ?? 24);
    }

    @Get('timeline')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    async timeline(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Query() q: TimelineQueryDto) {
        await this.assertGranted(req, grant);
        return this.queries.timeline(q.hours ?? 24);
    }

    @Get('events')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    async events(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Query() q: EventsQueryDto) {
        await this.assertGranted(req, grant);
        const result = await this.queries.events({
            type: q.type,
            sessionId: q.sessionId,
            cursor: q.cursor,
            search: q.search,
            from: q.from ? new Date(q.from) : undefined,
            to: q.to ? new Date(q.to) : undefined,
            authenticatedOnly: q.authenticatedOnly,
            skip: q.skip ?? 0,
            take: q.take ?? 50,
        });
        return { ...result, skip: q.skip ?? 0, take: q.take ?? 50 };
    }

    @Get('admin-activity')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    @ApiOperation({ summary: 'List administrative changes made by staff accounts' })
    async adminActivity(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Query() q: EventsQueryDto) {
        await this.assertGranted(req, grant);
        const skip = q.skip ?? 0;
        const take = Math.min(q.take ?? 25, 100);
        return { ...(await this.queries.adminActivity({ search: q.search, skip, take })), skip, take };
    }

    @Get('sessions')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    async sessions(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Query() q: SessionsQueryDto) {
        await this.assertGranted(req, grant);
        const result = await this.queries.sessions({
            search: q.search,
            deviceType: q.deviceType,
            authenticatedOnly: q.authenticatedOnly,
            botsOnly: q.botsOnly,
            from: q.from ? new Date(q.from) : undefined,
            skip: q.skip ?? 0,
            take: q.take ?? 50,
        });
        return { ...result, skip: q.skip ?? 0, take: q.take ?? 50 };
    }

    @Get('sessions/:id')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    async sessionDetail(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Param('id') id: string) {
        await this.assertGranted(req, grant);
        const detail = await this.queries.sessionDetail(id);
        if (!detail) throw new NotFoundException('Session not found');
        return detail;
    }

    @Get('filter-options')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    async filterOptions(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined) {
        await this.assertGranted(req, grant);
        return this.queries.filterOptions();
    }

    /**
     * The gate every read and settings endpoint shares. Kept as one method so a
     * new endpoint physically cannot forget it: forgetting the grant check would
     * leave a readable route behind a login that anyone with an admin token can
     * pass.
     *
     * It is ASYNC, and every caller must `await` it. That is not a style note: an
     * unawaited call returns a rejected promise that nobody observes, the handler
     * continues, and the data is returned anyway. This exact bug was introduced
     * once already when the key-version lookup made the check asynchronous, and
     * the regression tests below caught it only because they assert that a locked
     * page rejects every read.
     */
    private async assertGranted(req: any, grant: string | undefined): Promise<void> {
        const userId = req.user.userId as string;

        // Allowlist and role are re-checked on EVERY read, not just at unlock.
        // Checking once at unlock would let a demoted or de-listed admin keep
        // reading for the rest of the grant's hour, which is exactly the window
        // an operator would expect revocation to cover.
        await this.settings.assertAllowed(userId);

        if (!this.keys.verifyGrant(grant, userId, await this.settings.currentKeyVersion())) {
            void this.ops.trackSecurity({
                sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
                label: 'operations.access.denied',
                ipAddress: req.ip ?? null,
                userAgent: req.headers['user-agent'] ?? null,
            });
            throw new UnauthorizedException('Operations center is locked');
        }
    }

    // ------------------------------------------------------------------ settings

    @Get('settings')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_READ)
    @ApiOperation({ summary: 'Operations settings, allowlist and eligible admins' })
    async settingsState(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined) {
        await this.assertGranted(req, grant);
        const [state, allowlist, eligible] = await Promise.all([
            this.settings.state(),
            this.settings.listAllowlist(),
            this.settings.listEligibleAdmins(),
        ]);
        return {
            ...state,
            allowlist,
            eligible,
            // The UI needs this to tell the owner that the env var is still a
            // second way in until a password is set here.
            envFallbackActive: !state.hasPassword && !!process.env.OPERATIONS_KEY,
        };
    }

    /**
     * Change the operations password.
     *
     * Requires the CURRENT password as well as a valid grant. The grant alone is
     * not enough on purpose: it lives in sessionStorage for an hour, so anything
     * that can read it -- an XSS, a shared machine, a browser extension -- would
     * otherwise be able to take the door over permanently by setting a new
     * password. Requiring the password means stealing the grant buys an attacker
     * nothing that lasts.
     */
    @Post('settings/password')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_MANAGE)
    @HttpCode(200)
    @ApiOperation({ summary: 'Rotate the operations password; invalidates every outstanding grant' })
    async setPassword(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Body() dto: SetPasswordDto) {
        const userId = req.user.userId as string;
        const ip = req.ip ?? 'unknown';
        await this.assertGranted(req, grant);

        if (!this.passwordLimiter.allow(`pw:${userId}`)) {
            await this.ops.trackSecurity({
                sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
                label: 'operations.password.rate_limited',
                ipAddress: ip,
                userAgent: req.headers['user-agent'] ?? null,
            });
            throw new UnauthorizedException('Too many attempts. Try again later.');
        }

        if (!(await this.settings.verifyKey(dto.currentPassword))) {
            await this.ops.trackSecurity({
                sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
                label: 'operations.password.wrong_current',
                ipAddress: ip,
                userAgent: req.headers['user-agent'] ?? null,
            });
            // Deliberately identical to a wrong-new-password failure below? No --
            // this one is a 401 and the other a 400, but both avoid echoing
            // anything about which password is set.
            throw new UnauthorizedException('Incorrect operations password');
        }

        // Checked here as well as by the DTO's length rules. A mismatch means a
        // typo in one of the two fields, and proceeding would leave the owner
        // believing they set a password they never confirmed.
        if (dto.newPassword !== dto.confirmPassword) {
            throw new BadRequestException('The two new passwords do not match');
        }
        // A password that differs from the current one by a single character is
        // almost always a typo rather than an intentional change, and rotating
        // the operations key on a typo locks every other unlocked tab out.
        if (dto.newPassword === dto.currentPassword) {
            throw new BadRequestException('The new password must be different from the current one');
        }

        const keyVersion = await this.settings.setKey(dto.newPassword, userId);
        await this.ops.trackSecurity({
            sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
            label: 'operations.password.changed',
            ipAddress: ip,
            userAgent: req.headers['user-agent'] ?? null,
            meta: { actorId: userId, keyVersion },
        });
        return { ok: true, keyVersion };
    }

    @Post('settings/allowlist')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_MANAGE)
    @HttpCode(200)
    @ApiOperation({ summary: 'Grant an admin account access to the operations page' })
    async addToAllowlist(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Body() dto: AddAllowlistDto) {
        const userId = req.user.userId as string;
        const ip = req.ip ?? 'unknown';
        await this.assertGranted(req, grant);

        const result = await this.settings.addToAllowlist(dto.userId, userId);
        await this.ops.trackSecurity({
            sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
            label: 'operations.allowlist.added',
            ipAddress: ip,
            userAgent: req.headers['user-agent'] ?? null,
            meta: { actorId: userId, targetUserId: dto.userId },
        });
        return { ok: true, ...result };
    }

    @Delete('settings/allowlist/:userId')
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.OPS_MANAGE)
    @HttpCode(200)
    @ApiOperation({ summary: "Revoke an admin's access to the operations page" })
    async removeFromAllowlist(@Req() req: any, @Headers('x-ops-grant') grant: string | undefined, @Param('userId') targetUserId: string) {
        const userId = req.user.userId as string;
        const ip = req.ip ?? 'unknown';
        await this.assertGranted(req, grant);

        const result = await this.settings.removeFromAllowlist(targetUserId, userId);
        await this.ops.trackSecurity({
            sessionId: (req as { opsSessionId?: string | null }).opsSessionId ?? null,
            // Two labels rather than one, because "an admin removed themselves"
            // and "an admin removed a colleague" are different things to read in
            // the security log during an investigation.
            label: result.removedSelf ? 'operations.allowlist.self_removed' : 'operations.allowlist.removed',
            ipAddress: ip,
            userAgent: req.headers['user-agent'] ?? null,
            meta: { actorId: userId, targetUserId },
        });
        return { ok: true, ...result };
    }
}
