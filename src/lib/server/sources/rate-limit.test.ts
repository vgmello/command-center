import { describe, expect, test } from 'bun:test';
import { ConnectionLimits, RateLimiter } from './rate-limit';

/** A clock and a sleep a test drives, so a rate test never races a real one. */
function fakeClock() {
	let now = 0;

	return {
		now: () => now,
		sleep: async (ms: number) => {
			now += ms;
		},
		advance: (ms: number) => {
			now += ms;
		}
	};
}

describe('RateLimiter', () => {
	test('spends the burst immediately, then paces', async () => {
		const clock = fakeClock();
		const limiter = new RateLimiter({ perSecond: 2, burst: 3, now: clock.now, sleep: clock.sleep });

		// The burst is what lets a page of panels load at once rather than over seconds.
		for (let index = 0; index < 3; index++) await limiter.take('cx');
		expect(clock.now()).toBe(0);

		// The fourth waits for a token to appear: half a second at two per second.
		await limiter.take('cx');
		expect(clock.now()).toBeGreaterThanOrEqual(500);
	});

	test('refills over time rather than only on use', async () => {
		const clock = fakeClock();
		const limiter = new RateLimiter({
			perSecond: 10,
			burst: 5,
			now: clock.now,
			sleep: clock.sleep
		});

		for (let index = 0; index < 5; index++) await limiter.take('cx');
		expect(limiter.available('cx')).toBeLessThan(1);

		clock.advance(1000);
		expect(limiter.available('cx')).toBe(5);
	});

	test('never accumulates more than the burst', async () => {
		// An idle hour must not buy an hour's worth of calls in one instant.
		const clock = fakeClock();
		const limiter = new RateLimiter({ perSecond: 5, burst: 5, now: clock.now, sleep: clock.sleep });

		clock.advance(3_600_000);
		expect(limiter.available('cx')).toBe(5);
	});

	test('waits rather than rejecting', async () => {
		// A panel a second late beats a panel that failed, and beats an upstream that
		// starts 429ing everything because we spent the budget in one burst.
		const clock = fakeClock();
		const limiter = new RateLimiter({ perSecond: 1, burst: 1, now: clock.now, sleep: clock.sleep });

		await limiter.take('cx');
		await limiter.take('cx');

		expect(clock.now()).toBeGreaterThan(0);
	});

	test('a very small rate still makes progress', async () => {
		const clock = fakeClock();
		const limiter = new RateLimiter({
			perSecond: 0.1,
			burst: 1,
			now: clock.now,
			sleep: clock.sleep
		});

		await limiter.take('cx');
		await limiter.take('cx');

		expect(clock.now()).toBeGreaterThanOrEqual(10_000);
	});
});

describe('ConnectionLimits', () => {
	test('each connection has its own budget', async () => {
		// Two Coralogix accounts have two quotas; one busy dashboard must not spend the
		// other's.
		const clock = fakeClock();
		const limits = new ConnectionLimits({
			perSecond: 1,
			burst: 1,
			now: clock.now,
			sleep: clock.sleep
		});

		await limits.take('cx-one');
		await limits.take('cx-two');

		// Neither waited: they drew on separate buckets.
		expect(clock.now()).toBe(0);
	});

	test('a connection can be given its own budget', async () => {
		const clock = fakeClock();
		const limits = new ConnectionLimits({
			perSecond: 1,
			burst: 1,
			now: clock.now,
			sleep: clock.sleep
		});

		limits.configure('generous', {
			perSecond: 100,
			burst: 50,
			now: clock.now,
			sleep: clock.sleep
		});

		for (let index = 0; index < 20; index++) await limits.take('generous');
		expect(clock.now()).toBe(0);
	});
});
