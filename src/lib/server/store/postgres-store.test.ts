import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { PostgresSourceStore } from './postgres-store';
import {
	dockerAvailable,
	startPostgres,
	type PostgresContainer
} from './testing/postgres-container';
import type { StoreKey, StoredSample } from './source-store';

/**
 * The store, against a real Postgres.
 *
 * A fake would exercise our own code and prove nothing about the schema, the upsert
 * clauses or `Bun.sql`'s type mapping — which is exactly the part worth checking. The
 * container is started by the test file, so there is no manual step.
 */

const available = await dockerAvailable();
const describeStore = available ? describe : describe.skip;

if (!available) {
	console.warn('[store] Docker unavailable — Postgres store tests skipped.');
}

let container: PostgresContainer;
let store: PostgresSourceStore;

const key = (args = 'env=production'): StoreKey => ({
	connectionId: 'cx',
	capability: 'cloud.regions',
	args
});

function sample(overrides: Partial<StoredSample> = {}): StoredSample {
	return {
		connectionId: 'cx',
		capability: 'apm.metricSeries',
		environment: 'production',
		entity: 'payment-api',
		metric: 'p95',
		bucketAt: new Date('2026-09-05T12:00:00.000Z'),
		value: 640,
		settled: true,
		...overrides
	};
}

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

describeStore('documents', () => {
	test('a written document reads back whole', async () => {
		const payload = { regions: [{ id: 'westeurope', nodes: 12 }] };
		await store.writeDocument(key(), payload, 3600);

		const found = await store.readDocument(key());
		expect(found?.payload).toEqual(payload);
	});

	test('a key that was never written is null, not a throw', async () => {
		expect(await store.readDocument(key('env=nowhere'))).toBeNull();
	});

	test('carries when it was fetched, so a reader can be told its age', async () => {
		await store.writeDocument(key('env=staging'), { a: 1 }, 3600);
		const found = await store.readDocument(key('env=staging'));

		expect(found!.fetchedAt).toBeInstanceOf(Date);
		expect(found!.expiresAt.getTime()).toBeGreaterThan(found!.fetchedAt.getTime());
	});

	test('a second write overwrites rather than failing', async () => {
		// Two instances can fetch the same answer at once. Both are right; the later one
		// is fresher.
		await store.writeDocument(key('env=dev'), { v: 1 }, 3600);
		await store.writeDocument(key('env=dev'), { v: 2 }, 3600);

		expect((await store.readDocument(key('env=dev')))?.payload).toEqual({ v: 2 });
	});

	test('args are part of the identity, so two windows are two documents', async () => {
		await store.writeDocument(key('range=15m'), { window: '15m' }, 3600);
		await store.writeDocument(key('range=24h'), { window: '24h' }, 3600);

		expect((await store.readDocument(key('range=15m')))?.payload).toEqual({ window: '15m' });
		expect((await store.readDocument(key('range=24h')))?.payload).toEqual({ window: '24h' });
	});

	test('a very long args string still keys, because the key is hashed', async () => {
		// A domain search is bounded at 120 characters and a deployment query is a whole
		// object; Postgres refuses a btree entry over about 2700 bytes.
		const long = 'q=' + 'x'.repeat(5000);
		await store.writeDocument(key(long), { ok: true }, 3600);

		expect((await store.readDocument(key(long)))?.payload).toEqual({ ok: true });
	});
});

describeStore('series', () => {
	const window = {
		connectionId: 'cx',
		capability: 'apm.metricSeries' as const,
		environment: 'production',
		from: new Date('2026-09-05T11:00:00.000Z'),
		to: new Date('2026-09-05T13:00:00.000Z')
	};

	test('samples read back inside their window, in order', async () => {
		await store.appendSeries([
			sample({ bucketAt: new Date('2026-09-05T12:02:00.000Z'), value: 2 }),
			sample({ bucketAt: new Date('2026-09-05T12:01:00.000Z'), value: 1 })
		]);

		const rows = await store.readSeries(window);
		const values = rows.map((one) => one.value);

		expect(values).toContain(1);
		expect(values).toContain(2);
		// Ordered by bucket, so a caller never has to sort what a chart draws.
		const times = rows.map((one) => one.bucketAt.getTime());
		expect([...times].sort((a, b) => a - b)).toEqual(times);
	});

	test('a sample outside the window is not returned', async () => {
		await store.appendSeries([
			sample({ bucketAt: new Date('2026-09-04T00:00:00.000Z'), value: 999 })
		]);

		const rows = await store.readSeries(window);
		expect(rows.map((one) => one.value)).not.toContain(999);
	});

	test('re-writing a provisional bucket corrects it', async () => {
		// A backfilled sample revises a bucket that had not settled yet.
		const at = new Date('2026-09-05T12:30:00.000Z');
		await store.appendSeries([sample({ bucketAt: at, value: 100, settled: false })]);
		await store.appendSeries([sample({ bucketAt: at, value: 175, settled: true })]);

		const rows = await store.readSeries(window);
		const corrected = rows.find((one) => one.bucketAt.getTime() === at.getTime());

		expect(corrected?.value).toBe(175);
		expect(corrected?.settled).toBe(true);
	});

	test('entities are separate series at the same instant', async () => {
		const at = new Date('2026-09-05T12:40:00.000Z');
		await store.appendSeries([
			sample({ bucketAt: at, entity: 'payment-api', value: 10 }),
			sample({ bucketAt: at, entity: 'auth-service', value: 20 })
		]);

		const rows = await store.readSeries({ ...window, entities: ['auth-service'] });
		expect(rows.every((one) => one.entity === 'auth-service')).toBe(true);
		expect(rows.some((one) => one.value === 20)).toBe(true);
	});

	test('metrics are separate series too', async () => {
		const at = new Date('2026-09-05T12:50:00.000Z');
		await store.appendSeries([
			sample({ bucketAt: at, metric: 'p95', value: 600 }),
			sample({ bucketAt: at, metric: 'error_rate', value: 0.4 })
		]);

		const rows = (await store.readSeries(window)).filter(
			(one) => one.bucketAt.getTime() === at.getTime()
		);

		expect(new Set(rows.map((one) => one.metric)).size).toBe(2);
	});

	test('a large append survives the parameter cap', async () => {
		// Postgres caps a statement's parameters; a wide window across many entities runs
		// to thousands of rows, so the write is chunked.
		const many = Array.from({ length: 1200 }, (_, index) =>
			sample({
				entity: `svc-${index % 40}`,
				bucketAt: new Date(window.from.getTime() + index * 1000),
				value: index
			})
		);

		await store.appendSeries(many);
		const rows = await store.readSeries(window);

		expect(rows.length).toBeGreaterThan(1000);
	});

	test('an empty append is a no-op rather than a bad statement', async () => {
		await store.appendSeries([]);
		expect(true).toBe(true);
	});
});

describeStore('leases', () => {
	test('one holder wins and the other is refused', async () => {
		// The whole point: eight instances starting cold must issue one call, not eight.
		const contested = key('lease=1');

		expect(await store.claim(contested, 'instance-a', 30)).toBe(true);
		expect(await store.claim(contested, 'instance-b', 30)).toBe(false);
	});

	test('an expired lease can be taken by someone else', async () => {
		const contested = key('lease=2');

		// Held for no time at all, so it is already expired when the next caller asks.
		expect(await store.claim(contested, 'instance-a', 0)).toBe(true);
		await Bun.sleep(50);
		expect(await store.claim(contested, 'instance-b', 30)).toBe(true);
	});

	test('the holder may renew its own lease', async () => {
		const contested = key('lease=3');

		expect(await store.claim(contested, 'instance-a', 0)).toBe(true);
		await Bun.sleep(50);
		expect(await store.claim(contested, 'instance-a', 30)).toBe(true);
	});
});

describeStore('prune', () => {
	test('drops expired documents and keeps live ones', async () => {
		await store.writeDocument(key('prune=expired'), { a: 1 }, -10);
		await store.writeDocument(key('prune=live'), { a: 2 }, 3600);

		await store.prune(new Date(), 24);

		expect(await store.readDocument(key('prune=expired'))).toBeNull();
		expect(await store.readDocument(key('prune=live'))).not.toBeNull();
	});

	test('drops samples past their retention', async () => {
		const old = new Date(Date.now() - 72 * 3_600_000);
		await store.appendSeries([sample({ bucketAt: old, entity: 'ancient', value: 1 })]);

		await store.prune(new Date(), 24);

		const rows = await store.readSeries({
			connectionId: 'cx',
			capability: 'apm.metricSeries',
			environment: 'production',
			from: new Date(old.getTime() - 3600_000),
			to: new Date()
		});

		expect(rows.some((one) => one.entity === 'ancient')).toBe(false);
	});
});
