import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

const INCREMENT_RATE_LIMIT_SCRIPT = `
local totalHits = redis.call('INCR', KEYS[1])
if totalHits == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end

local timeToExpire = redis.call('TTL', KEYS[1])
local timeToBlockExpire = redis.call('TTL', KEYS[2])
local isBlocked = timeToBlockExpire > 0

if not isBlocked and totalHits > tonumber(ARGV[2]) then
    timeToBlockExpire = tonumber(ARGV[3])
    redis.call('SET', KEYS[2], '1', 'EX', timeToBlockExpire)
    isBlocked = true
end

return { totalHits, math.max(0, timeToExpire), isBlocked and 1 or 0, math.max(0, timeToBlockExpire) }
`;

/**
 * Rate-limit counters shared across every replica.
 *
 * The built-in ThrottlerStorageService keeps counters in a `Map`, so they live
 * only inside the process that created them. On Railway the request reaches a
 * replica chosen by the edge, which meant the 300 req/min limit applied per
 * replica: 1200 requests to one public endpoint inside a single 60s window
 * produced zero 429s, because the hits were divided between instances that each
 * believed they had seen a handful of requests. A DDoS gets N times the
 * intended budget, where N is the replica count.
 *
 * Redis makes the counters shared, so the limit means the same thing on every
 * instance and survives a restart or a rolling deploy.
 *
 * A Lua script increments, sets expiry and checks/sets the block in one Redis
 * round trip. Keeping the fixed-window logic atomic avoids per-request ping and
 * multiple sequential Redis operations on the API hot path.
 *
 * If REDIS_URL is unset or Redis is unreachable, this falls back to an in-process
 * Map so a cache outage degrades the rate limit to per-replica rather than
 * taking the API down with it.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
    private readonly logger = new Logger(RedisThrottlerStorage.name);
    private client: Redis | null = null;
    private fallback = new Map<string, { totalHits: number; expiresAt: number; isBlocked: boolean; blockExpiresAt: number }>();

    constructor() {
        const url = process.env.REDIS_URL;
        if (!url) {
            this.logger.warn('REDIS_URL is not set — rate limits will be per-replica (in-memory).');
            return;
        }
        try {
            this.client = new Redis(url, {
                // Do not queue commands while disconnected: a queued INCR that
                // resolves long after the client got its 429 is worse than an
                // honest failure, and an unbounded queue under load is how you
                // turn a Redis blip into an OOM.
                enableOfflineQueue: false,
                maxRetriesPerRequest: 2,
                connectTimeout: 3000,
                // The counter is a security control, not a cache. Persisting it
                // means a Redis restart cannot hand every client a fresh budget.
                lazyConnect: true,
            });
            this.client.on('error', (err) => {
                this.logger.error(`Redis error, falling back to in-memory counters: ${err.message}`);
            });
        } catch (err) {
            this.logger.error(`Could not create Redis client: ${(err as Error).message}`);
            this.client = null;
        }
    }

    async onModuleDestroy(): Promise<void> {
        if (this.client) {
            await this.client.quit().catch(() => undefined);
        }
    }

    async increment(
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string,
    ): Promise<ThrottlerStorageRecord> {
        if (!this.client) return this.incrementLocal(key, ttl, limit, blockDuration, throttlerName);

        const redisKey = `rl:${throttlerName}:${key}`;
        const ttlSeconds = Math.max(1, Math.ceil(ttl / 1000));
        const blockSeconds = Math.max(1, Math.ceil(blockDuration / 1000));

        try {
            const result = await this.client.eval(
                INCREMENT_RATE_LIMIT_SCRIPT,
                2,
                redisKey,
                `${redisKey}:blocked`,
                ttlSeconds,
                limit,
                blockSeconds,
            ) as [number, number, number, number];

            return {
                totalHits: Number(result[0]),
                timeToExpire: Math.max(0, Number(result[1])),
                isBlocked: Number(result[2]) === 1,
                timeToBlockExpire: Math.max(0, Number(result[3])),
            };
        } catch (err) {
            this.logger.warn(`Redis increment failed (${(err as Error).message}); using in-memory counters.`);
            return this.incrementLocal(key, ttl, limit, blockDuration, throttlerName);
        }
    }

    private incrementLocal(
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string,
    ): ThrottlerStorageRecord {
        const now = Date.now();
        // Scope the counter to the throttler as well as the tracker. NestJS can
        // run several throttlers over the same request (a global default plus a
        // stricter one on, say, /auth/login), and they must not spend each
        // other's budget. The Redis key above does the same via `rl:<name>:`.
        const composite = `${throttlerName}:${key}`;
        let entry = this.fallback.get(composite);
        if (!entry) {
            entry = { totalHits: 0, expiresAt: now + ttl, isBlocked: false, blockExpiresAt: 0 };
            this.fallback.set(composite, entry);
        }
        if (entry.expiresAt <= now) {
            entry.expiresAt = now + ttl;
            entry.totalHits = 0;
        }
        if (entry.blockExpiresAt && entry.blockExpiresAt <= now) {
            entry.isBlocked = false;
            entry.blockExpiresAt = 0;
        }
        if (!entry.isBlocked) entry.totalHits += 1;
        if (entry.totalHits > limit && !entry.isBlocked) {
            entry.isBlocked = true;
            entry.blockExpiresAt = now + blockDuration;
        }
        return {
            totalHits: entry.totalHits,
            timeToExpire: Math.max(0, Math.ceil((entry.expiresAt - now) / 1000)),
            isBlocked: entry.isBlocked,
            timeToBlockExpire: Math.max(0, Math.ceil((entry.blockExpiresAt - now) / 1000)),
        };
    }
}
