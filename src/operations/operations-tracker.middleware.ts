import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { OperationsService } from './operations.service';

/** Stamped on the request by `resolveSession` so the finish hook can reuse it. */
export interface TrackedRequest extends Request {
    opsSessionId?: string | null;
    opsStartedAt?: number;
}

/**
 * The second password, exchanged for a short-lived signed grant.
 *
 * WHY A GRANT TOKEN RATHER THAN THE KEY ON EVERY CALL
 * The page polls this data, so re-sending the password on each poll would put it
 * in a dozen request bodies and any browser history or proxy log that captured
 * them. Unlocking once mints a token scoped to the operations API; it is signed
 * with the app's own secret and carries its own expiry, so it can be revoked by
 * not renewing it and it cannot be replayed as an access token because it is
 * verified on a claim the JWT strategy never sets.
 */
@Injectable()
export class OperationsKeyService {
    /** Deliberately short: a forgotten unlocked tab should not stay open all day. */
    private static readonly GRANT_TTL_SECONDS = 60 * 60;

    constructor(private readonly ops: OperationsService) { }

    /**
     * Mint a grant after a correct second password.
     *
     * `kv` pins the grant to the password version in force right now. Rotating
     * the password bumps that version, so every grant issued under the old one
     * stops verifying -- without any server-side session store to revoke from.
     */
    issueGrant(userId: string, keyVersion: number): { grant: string; expiresAt: string } {
        const grant = jwt.sign({ sub: userId, opsGrant: true, kv: keyVersion }, process.env.JWT_SECRET!, {
            algorithm: 'HS256',
            expiresIn: OperationsKeyService.GRANT_TTL_SECONDS,
        });
        return { grant, expiresAt: new Date(Date.now() + OperationsKeyService.GRANT_TTL_SECONDS * 1000).toISOString() };
    }

    /**
     * True when the header holds a live grant for `userId` at `keyVersion`.
     *
     * A grant whose `kv` does not match is rejected even though its signature
     * and expiry are perfect. That is the difference between "the password was
     * rotated" and "the password was rotated and the old session died with it".
     */
    verifyGrant(header: string | undefined, userId: string, keyVersion: number): boolean {
        if (!header) return false;
        const raw = header.startsWith('Bearer ') ? header.slice(7) : header;
        try {
            const payload = jwt.verify(raw, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as Record<string, unknown>;
            // The claim check is what separates this from an access token: the
            // JWT strategy signs `{sub, email, role, tv}` and never `opsGrant`,
            // so an admin's normal bearer token cannot open this API.
            if (payload.opsGrant !== true || payload.sub !== userId) return false;
            // A grant minted before versioning existed carries no `kv`. Refusing
            // it is the safe reading: after a deploy everyone re-unlocks, which is
            // the correct outcome for a credential that just changed.
            return payload.kv === keyVersion;
        } catch {
            return false;
        }
    }
}

/**
 * Records every request into the operations center.
 *
 * Runs for anonymous traffic too -- that is the point. It resolves the visitor
 * cookie before the guards run so an unauthenticated page load still produces a
 * session row, and it reads the JWT itself (rather than relying on `req.user`)
 * purely to label the session with a user id when one is present. That label is
 * for display; authorization is entirely the guards' job.
 */
@Injectable()
export class OperationsTrackerMiddleware implements NestMiddleware {
    constructor(private readonly ops: OperationsService) { }

    async use(req: TrackedRequest, res: Response, next: NextFunction): Promise<void> {
        const startedAt = Date.now();
        req.opsStartedAt = startedAt;

        const userId = this.readUserId(req);
        const resolved = await this.ops.resolveSession(req, { userId });
        req.opsSessionId = resolved?.sessionId ?? null;

        // The cookie itself is written by resolveSession, which is the only
        // place that decides whether a new visitor id was minted. Doing it here
        // too would emit a second Set-Cookie for the same request.
        res.on('finish', () => {
            // Fire and forget. The response has already been sent, so a failure
            // here cannot affect what the caller received.
            //
            // `req.user` is populated by now on guarded routes, so prefer it: it
            // is the guard-verified identity. The verified token peek above only
            // fills the gap for routes with no guard at all.
            void this.ops.trackRequest(req, res, startedAt, req.opsSessionId ?? null);
        });

        next();
    }

    /**
     * Read the user id out of the bearer token, verifying the signature.
     *
     * WHY THE SIGNATURE MATTERS HERE
     * This runs before the guards, so it cannot be the authorization decision --
     * it is not, and the guards still apply. But the value it produces is written
     * onto the session row that the operations UI shows as "who did this". If it
     * were an unverified `sub`, anyone could put a victim's id in a self-signed
     * token and have their activity filed under that account, which is precisely
     * the sort of thing an audit log exists to prevent.
     *
     * `jwt.verify` with HS256 is a local HMAC over the token: no database read
     * and no network, so it is affordable on every request. If `JWT_SECRET` is
     * unset verification throws and the session is simply treated as anonymous,
     * which is the safe direction to fail in.
     */
    private readUserId(req: Request): string | null {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return null;
        const secret = process.env.JWT_SECRET;
        if (!secret) return null;
        try {
            const payload = jwt.verify(header.slice(7), secret, { algorithms: ['HS256'] }) as Record<string, unknown>;
            return typeof payload?.sub === 'string' ? payload.sub : null;
        } catch {
            return null;
        }
    }
}
