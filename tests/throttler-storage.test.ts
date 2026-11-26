import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RedisThrottlerStorage } from '../src/common/redis-throttler.storage';

// These tests cover the in-process fallback unless a test explicitly supplies a
// fake Redis client; they must not depend on a developer's REDIS_URL.
delete process.env.REDIS_URL;

/**
 * The rate limiter has to actually stop traffic.
 *
 * The configured limit was 300 req/min, and it never once fired: 1200 requests
 * to a single public endpoint inside one 60s window came back 200/200. The
 * counters lived in a Map inside each process, and Railway routes each request
 * to one of several replicas, so every replica saw a fraction of the traffic and
 * no replica ever reached its own limit. Measured on the deployed service,
 * sequential requests returned `x-ratelimit-remaining: 299` over and over -- the
 * count resetting per request is the fingerprint of a per-replica store.
 *
 * These cover the in-process path, which is what runs when REDIS_URL is absent,
 * so that fallback is known to enforce rather than merely to compile. The Redis
 * path shares this contract; what differs is that its counters survive a restart
 * and are visible to every replica.
 */

const TTL = 60_000;
const LIMIT = 5;
const BLOCK = 60_000;

describe('RedisThrottlerStorage', () => {
    test('Redis path uses one atomic script call and maps the returned limit state', async () => {
        const previousUrl = process.env.REDIS_URL;
        process.env.REDIS_URL = 'redis://127.0.0.1:6379';
        const storage = new RedisThrottlerStorage();
        const originalClient = (storage as any).client;
        const calls: unknown[][] = [];
        (storage as any).client = {
            eval: async (...args: unknown[]) => {
                calls.push(args);
                return [6, 42, 1, 60];
            },
            quit: async () => 'OK',
        };

        try {
            const record = await storage.increment('client-a', TTL, LIMIT, BLOCK, 'default');

            assert.deepEqual(record, {
                totalHits: 6,
                timeToExpire: 42,
                isBlocked: true,
                timeToBlockExpire: 60,
            });
            assert.equal(calls.length, 1, 'a request must need one Redis round trip');
            assert.equal(calls[0][1], 2, 'the Lua script uses counter and block keys');
            assert.equal(calls[0][2], 'rl:default:client-a');
            assert.equal(calls[0][3], 'rl:default:client-a:blocked');
            assert.equal(calls[0][4], 60);
            assert.equal(calls[0][5], LIMIT);
        } finally {
            (storage as any).client = null;
            originalClient.disconnect();
            if (previousUrl === undefined) delete process.env.REDIS_URL;
            else process.env.REDIS_URL = previousUrl;
        }
    });

    test('blocks once the limit is exceeded, and reports why', async () => {
        const storage = new RedisThrottlerStorage();
        const key = 'client-a';

        for (let i = 1; i <= LIMIT; i++) {
            const record = await storage.increment(key, TTL, LIMIT, BLOCK, 'default');
            assert.equal(record.isBlocked, false, `hit ${i} must not be blocked`);
            assert.equal(record.totalHits, i);
        }

        const blocked = await storage.increment(key, TTL, LIMIT, BLOCK, 'default');
        assert.equal(blocked.isBlocked, true, 'the request past the limit must be blocked');
        assert.ok(blocked.timeToBlockExpire > 0, 'a blocked caller must be told how long to wait');
    });

    test('counts down the time left in the window instead of reporting 0', async () => {
        const storage = new RedisThrottlerStorage();
        const record = await storage.increment('client-b', TTL, LIMIT, BLOCK, 'default');
        assert.ok(record.timeToExpire > 0, 'timeToExpire must be in the future');
        assert.ok(record.timeToExpire <= 60, `timeToExpire should be within the window, got ${record.timeToExpire}`);
    });

    test('keys are independent, so one noisy client cannot throttle another', async () => {
        const storage = new RedisThrottlerStorage();

        for (let i = 0; i < LIMIT + 3; i++) {
            await storage.increment('noisy', TTL, LIMIT, BLOCK, 'default');
        }
        assert.equal((await storage.increment('noisy', TTL, LIMIT, BLOCK, 'default')).isBlocked, true);

        const quiet = await storage.increment('quiet', TTL, LIMIT, BLOCK, 'default');
        assert.equal(quiet.isBlocked, false, 'an unrelated client must be unaffected');
        assert.equal(quiet.totalHits, 1);
    });

    test('throttler names do not share a counter', async () => {
        const storage = new RedisThrottlerStorage();
        for (let i = 0; i < LIMIT + 2; i++) {
            await storage.increment('same-key', TTL, LIMIT, BLOCK, 'short');
        }
        const other = await storage.increment('same-key', TTL, LIMIT, BLOCK, 'long');
        assert.equal(other.isBlocked, false, 'a second throttler needs its own budget');
        assert.equal(other.totalHits, 1);
    });

    test('the window slides: an expired window lets the client through again', async () => {
        const storage = new RedisThrottlerStorage();
        // Both the window and the block must be short here. A 60s block is
        // meant to outlast a 1ms window -- that is what blockDuration is for --
        // so reusing BLOCK would assert the opposite of the intended behaviour.
        const tinyWindow = 5;
        const tinyBlock = 5;

        for (let i = 0; i < LIMIT + 1; i++) {
            await storage.increment('recovering', tinyWindow, LIMIT, tinyBlock, 'default');
        }
        await new Promise((r) => setTimeout(r, 30));

        const after = await storage.increment('recovering', tinyWindow, LIMIT, tinyBlock, 'default');
        assert.equal(after.isBlocked, false, 'the window must expire, not block forever');
        assert.equal(after.totalHits, 1, 'hits must reset with the window');
    });

    test('a block outlasts its window, then releases', async () => {
        const storage = new RedisThrottlerStorage();
        // Window shorter than the block: the counter resets while the caller is
        // still blocked, and clearing the window must not let them back in early.
        const tinyBlock = 30;
        for (let i = 0; i < LIMIT + 1; i++) {
            await storage.increment('stubborn', 5, LIMIT, tinyBlock, 'default');
        }
        const stillBlocked = await storage.increment('stubborn', 5, LIMIT, tinyBlock, 'default');
        assert.equal(stillBlocked.isBlocked, true, 'the block must survive the window rolling over');

        await new Promise((r) => setTimeout(r, 60));
        const released = await storage.increment('stubborn', 5, LIMIT, tinyBlock, 'default');
        assert.equal(released.isBlocked, false, 'once the block expires the client is served again');
        assert.equal(released.totalHits, 1, 'and its counter starts from the new window');
    });
});
