import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { SourceCache } from './cache';
import { ConnectionLimits } from './rate-limit';
import { PostgresSourceStore } from '../store/postgres-store';
import {
	dockerAvailable,
	startPostgres,
	type PostgresContainer
} from '../store/testing/postgres-container';
import type { CacheKey } from './cache';

/**
 * The cache with a real store behind it.
 *
 * The properties worth proving are all about what happens *between* processes — surviving
 * a restart, and eight cold instances making one call rather than eight — and none of
 * them can be demonstrated against a fake.
 */

const available = await dockerAvailable();
const describeStore = available ? describe : describe.skip;

if (!available) {
	console.warn('[cache] Docker unavailable — store-backed cache tests skipped.');
}

let container: PostgresContainer;
let store: PostgresSourceStore;

/** A reference capability: persisted as a whole answer. */
const reference = (args = 'a'): CacheKey => ({
	connectionId: 'cx',
	capability: 'cloud.regions',
	args,
	ttlSeconds: 3600
});

/** A live capability: never persisted. */
const live = (args = 'a'): CacheKey => ({
	connectionId: 'cx',
	capability: 'apm.serviceHealth',
	args,
	ttlSeconds: 30
});

beforeAll(async () => {
	if (!available) return;

	container = await startPostgres();
	store = new PostgresSourceStore(container.url);
	await migrate(store.db, { migrationsFolder: './drizzle' });
}, 120_000);

afterAll(async () => {
	await store?.close();
	await container?.stop();
});

describeStore('surviving the process', () => {
	test('a second instance starting cold reads the first one’s answer', async () => {
		// The whole reason to persist: a deploy must not send every instance's every panel
		// at a rate-limited API at once.
		let calls = 0;
		const load = async () => ({ regions: ++calls });

		const first = new SourceCache({ store, holder: 'instance-a' });
		await first.read(reference('restart'), load);

		// A different cache with an empty memory tier — a restarted process.
		const second = new SourceCache({ store, holder: 'instance-b' });
		const served = await second.read(reference('restart'), load);

		expect(served.data).toEqual({ regions: 1 });
		expect(calls).toBe(1);
	});

	test('a persisted answer carries when it was fetched', async () => {
		const cache = new SourceCache({ store, holder: 'instance-a' });
		await cache.read(reference('age'), async () => ({ v: 1 }));

		const fresh = new SourceCache({ store, holder: 'instance-b' });
		const served = await fresh.read(reference('age'), async () => ({ v: 2 }));

		// So a panel can say "Azure, four minutes ago" rather than implying it is current.
		expect(served.fetchedAt).toBeInstanceOf(Date);
		expect(served.data).toEqual({ v: 1 });
	});

	test('an expired document is refetched rather than served', async () => {
		let calls = 0;
		const load = async () => ({ v: ++calls });
		const key = { ...reference('expiry'), ttlSeconds: -1 };

		await new SourceCache({ store, holder: 'a' }).read(key, load);
		const served = await new SourceCache({ store, holder: 'b' }).read(key, load);

		expect(served.data).toEqual({ v: 2 });
	});

	test('a live capability is never written to the store', async () => {
		// Read back off disk it is already stale; a row per thirty seconds for a number
		// nobody will read again is cost without benefit.
		let calls = 0;
		const load = async () => ({ v: ++calls });

		await new SourceCache({ store, holder: 'a' }).read(live('never'), load);
		const served = await new SourceCache({ store, holder: 'b' }).read(live('never'), load);

		expect(served.data).toEqual({ v: 2 });
		expect(await store.readDocument(live('never'))).toBeNull();
	});
});

describeStore('single-flight across the deployment', () => {
	test('eight cold instances make one upstream call', async () => {
		// A lease is what turns a cold-start wave into one call. Without it this is eight.
		let calls = 0;
		const load = async () => {
			calls++;
			await Bun.sleep(150);
			return { v: calls };
		};

		const instances = Array.from(
			{ length: 8 },
			(_, index) => new SourceCache({ store, holder: `instance-${index}` })
		);

		const served = await Promise.all(instances.map((cache) => cache.read(reference('herd'), load)));

		expect(calls).toBe(1);
		// And every one of them got the answer, rather than some getting nothing.
		for (const one of served) expect(one.data).toEqual({ v: 1 });
	});

	test('a holder that never writes does not block the others forever', async () => {
		// A lease holder can die mid-fetch. Serving a page late beats not serving it.
		let calls = 0;
		const key = reference('abandoned');

		// Someone else holds the lease and will never write the row.
		await store.claim(key, 'ghost-instance', 30);

		const cache = new SourceCache({ store, holder: 'instance-b', leaseSeconds: 1 });
		const served = await cache.read(key, async () => ({ v: ++calls }));

		expect(served.data).toEqual({ v: 1 });
		expect(calls).toBe(1);
	});
});

describeStore('with a limiter', () => {
	test('the budget is not spent on an answer the store already had', async () => {
		// A read served from the store must cost nothing: the limiter is taken as late as
		// possible, after the store and the lease have both had their chance.
		const spent: string[] = [];
		const limits = new ConnectionLimits({ perSecond: 1000, burst: 1000 });
		const counting = {
			take: async (id: string) => {
				spent.push(id);
				await limits.take(id);
			}
		} as ConnectionLimits;

		await new SourceCache({ store, holder: 'a', limits: counting }).read(
			reference('budget'),
			async () => ({ v: 1 })
		);
		expect(spent).toEqual(['cx']);

		await new SourceCache({ store, holder: 'b', limits: counting }).read(
			reference('budget'),
			async () => ({ v: 2 })
		);

		// Still one: the second instance was answered by the store.
		expect(spent).toEqual(['cx']);
	});
});

describeStore('when the store misbehaves', () => {
	test('a store that throws does not fail the read', async () => {
		// Persistence is an optimisation. Losing it must degrade to the behaviour of a
		// deployment with no database, not to an error page.
		const broken = {
			id: 'broken',
			readDocument: async () => {
				throw new Error('down');
			},
			writeDocument: async () => {
				throw new Error('down');
			},
			readSeries: async () => [],
			appendSeries: async () => {},
			claim: async () => {
				throw new Error('down');
			},
			release: async () => {},
			prune: async () => {},
			close: async () => {}
		};

		const cache = new SourceCache({ store: broken, holder: 'a' });
		const served = await cache.read(reference('broken'), async () => ({ v: 1 }));

		expect(served.data).toEqual({ v: 1 });
	});
});
