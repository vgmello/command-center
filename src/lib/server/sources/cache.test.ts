import { describe, expect, test } from 'bun:test';
import { DEFAULT_TTL_SECONDS, SourceCache } from './cache';
import { CAPABILITIES } from '$lib/platform/sources';

const key = (args = '', ttlSeconds = 60) => ({
	connectionId: 'a',
	capability: 'cloud.nodes' as const,
	args,
	ttlSeconds
});

describe('DEFAULT_TTL_SECONDS', () => {
	test('every capability has a TTL, so none inherits an accidental default', () => {
		for (const capability of CAPABILITIES) {
			expect(DEFAULT_TTL_SECONDS[capability], capability).toBeGreaterThan(0);
		}
	});

	test('slow-moving data is cached longer than fast-moving data', () => {
		expect(DEFAULT_TTL_SECONDS['cloud.regions']).toBeGreaterThan(
			DEFAULT_TTL_SECONDS['cloud.utilization']
		);
		expect(DEFAULT_TTL_SECONDS['cloud.cost']).toBeGreaterThan(
			DEFAULT_TTL_SECONDS['cloud.utilization']
		);
	});
});

describe('SourceCache', () => {
	test('serves a cached value within its TTL', async () => {
		let calls = 0;
		const cache = new SourceCache();
		const load = async () => ++calls;

		expect((await cache.read(key(), load)).data).toBe(1);
		expect((await cache.read(key(), load)).data).toBe(1);
		expect(calls).toBe(1);
	});

	test('reloads once the TTL has passed', async () => {
		let now = 0;
		let calls = 0;
		const cache = new SourceCache({ now: () => now });
		const load = async () => ++calls;

		await cache.read(key('', 60), load);
		now = 61_000;
		expect((await cache.read(key('', 60), load)).data).toBe(2);
	});

	test('different arguments are different entries', async () => {
		let calls = 0;
		const cache = new SourceCache();
		const load = async () => ++calls;

		await cache.read(key('limit=5'), load);
		await cache.read(key('limit=9'), load);
		expect(calls).toBe(2);
	});

	test('different connectionId/args pairs do not collide even if they space-join identically', async () => {
		let calls = 0;
		const cache = new SourceCache();
		const load = async () => ++calls;

		// A collision in the old space-joined format requires the pair to straddle the
		// capability, which sits between id and args: "id capability args"
		// connectionId='a', args='b cloud.nodes c' -> "a cloud.nodes b cloud.nodes c"
		// connectionId='a cloud.nodes b', args='c' -> "a cloud.nodes b cloud.nodes c" (collision!)
		// JSON format prevents this: ["a", "cloud.nodes", "b cloud.nodes c"] vs
		// ["a cloud.nodes b", "cloud.nodes", "c"] are distinct.
		const result1 = await cache.read(
			{
				connectionId: 'a',
				capability: 'cloud.nodes' as const,
				args: 'b cloud.nodes c',
				ttlSeconds: 60
			},
			load
		);
		const result2 = await cache.read(
			{
				connectionId: 'a cloud.nodes b',
				capability: 'cloud.nodes' as const,
				args: 'c',
				ttlSeconds: 60
			},
			load
		);

		expect(calls).toBe(2);
		expect(result1.data).toBe(1);
		expect(result2.data).toBe(2);
	});

	test('concurrent identical reads share one call', async () => {
		let calls = 0;
		const cache = new SourceCache();
		const load = async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 10));
			return calls;
		};

		// Seven panels needing one capability must issue one API call, not seven.
		const results = await Promise.all(Array.from({ length: 7 }, () => cache.read(key(), load)));

		expect(calls).toBe(1);
		expect(results.every((one) => one.data === 1)).toBe(true);
	});

	test('a failed load does not poison the key for later callers', async () => {
		let attempt = 0;
		const cache = new SourceCache();
		const load = async () => {
			if (++attempt === 1) throw new Error('flaky');
			return attempt;
		};

		await expect(cache.read(key(), load)).rejects.toThrow('flaky');
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect((await cache.read(key(), load)).data).toBe(2);
	});

	test('a load that overruns its deadline fails rather than hanging the page', async () => {
		const cache = new SourceCache({ deadlineMs: 20 });

		await expect(
			cache.read(key(), () => new Promise((resolve) => setTimeout(() => resolve(1), 200)))
		).rejects.toThrow(/deadline/i);
	});

	test('a failure after a success serves the stale value, marked stale', async () => {
		let now = 0;
		let attempt = 0;
		const cache = new SourceCache({ now: () => now });
		const load = async () => {
			if (++attempt === 1) return 'fresh';
			throw new Error('down');
		};

		await cache.read(key('', 60), load);
		now = 61_000;

		expect(await cache.read(key('', 60), load)).toEqual({
			data: 'fresh',
			stale: true
		});
	});

	test('a failure with nothing cached still throws', async () => {
		const cache = new SourceCache();

		await expect(
			cache.read(key(), async () => {
				throw new Error('down');
			})
		).rejects.toThrow('down');
	});
});
