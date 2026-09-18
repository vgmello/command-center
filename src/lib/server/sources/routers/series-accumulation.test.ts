import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { SourceCache } from '../cache';
import { createDispatcher } from '../dispatch';
import { SourceRegistry } from '../registry';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import { createServiceRouter } from './service';
import { FixtureCatalogSource } from '../../catalog/fixture-source';
import { PostgresSourceStore } from '../../store/postgres-store';
import {
	dockerAvailable,
	startPostgres,
	type PostgresContainer
} from '../../store/testing/postgres-container';
import { BUCKET_SECONDS, SETTLING_SECONDS } from '../series';
import type { PlatformScope } from '$lib/platform/query';

/**
 * Series accumulate rather than being re-fetched.
 *
 * The property worth proving is about the *second* read: a warm store must ask the source
 * for minutes rather than for the whole window. Nothing about that can be demonstrated
 * without a real store, because it is entirely about what survives between reads.
 */

const available = await dockerAvailable();
const describeSeries = available ? describe : describe.skip;

if (!available) {
	console.warn('[series] Docker unavailable — accumulation tests skipped.');
}

let container: PostgresContainer;
let store: PostgresSourceStore;

const scope: PlatformScope = { environment: 'production', timeRange: '1h' };

/** Every window the provider was asked for, so the gap can be measured. */
const asked: Array<{ from: Date; to: Date } | null> = [];

/**
 * A router whose APM provider records the window it was given.
 *
 * The fixture provider answers whatever it is asked; what matters here is not its numbers
 * but which window each call covered.
 */
function build(withStore: boolean) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);
	registry.load(FIXTURE_CONNECTIONS, {});

	// Record the window, then let the real fixture provider answer.
	for (const connection of registry.connections('apm')) {
		const client = connection.client as Record<string, unknown>;
		const original = client.readMetricSeries as (ctx: unknown) => Promise<unknown>;

		client.readMetricSeries = async (ctx: { window?: { from: Date; to: Date } }) => {
			asked.push(ctx.window ?? null);
			return original(ctx);
		};
	}

	const deps = {
		registry,
		dispatcher: createDispatcher(registry),
		cache: new SourceCache(),
		store: withStore ? store : null
	};

	return createServiceRouter(deps, new FixtureCatalogSource());
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

describeSeries('accumulating a chart', () => {
	test('the first read asks for the whole window', async () => {
		asked.length = 0;
		const router = build(true);

		await router.readMetricSeries(scope, 'payment-api');

		expect(asked.length).toBe(1);
		const window = asked[0]!;
		const minutes = (window.to.getTime() - window.from.getTime()) / 60_000;

		// A cold store has nothing to reuse, so the gap is the range.
		expect(minutes).toBeGreaterThan(50);
	});

	test('the second read asks only for the gap', async () => {
		// The whole point. A one-hour chart refreshed must not re-read an hour of settled
		// history — it must ask for the few minutes that are still provisional.
		asked.length = 0;
		const router = build(true);

		await router.readMetricSeries(scope, 'payment-api');
		const first = asked.length;

		// A fresh router: an empty memory tier, the same store.
		const second = build(true);
		await second.readMetricSeries(scope, 'payment-api');

		expect(asked.length).toBe(first + 1);

		const gap = asked[asked.length - 1]!;
		const minutes = (gap.to.getTime() - gap.from.getTime()) / 60_000;

		expect(minutes).toBeLessThanOrEqual(SETTLING_SECONDS / 60 + 1);
	});

	test('the chart is still whole, drawn from what was stored plus the gap', async () => {
		const router = build(true);
		const answer = await router.readMetricSeries(scope, 'payment-api');

		expect(answer.requestRate.points.length).toBeGreaterThan(1);
		expect(answer.p95Latency.points.length).toBeGreaterThan(1);
		expect(answer.errorRate.points.length).toBeGreaterThan(1);

		// The families survive the round trip through samples.
		expect(answer.saturation.length).toBeGreaterThan(0);
		expect(answer.byEndpoint.length).toBeGreaterThan(0);
		expect(answer.byInstance.length).toBeGreaterThan(0);
	});

	test('every series shares one x-axis, so a stacked chart still stacks', async () => {
		const router = build(true);
		const answer = await router.readMetricSeries(scope, 'payment-api');
		const labels = answer.byEndpoint.map((one) => one.points.map((p) => p.label).join('|'));

		expect(new Set(labels).size).toBe(1);
	});

	test('samples are written at the canonical resolution, not the query’s step', async () => {
		// Storing at whatever step a query asked for is what would make a 15-minute view
		// and a 24-hour view share no rows at all.
		const router = build(true);
		await router.readMetricSeries(scope, 'payment-api');

		const samples = await store.readSeries({
			connectionId: 'fixture-apm',
			capability: 'apm.metricSeries',
			environment: 'production',
			from: new Date(Date.now() - 3_600_000),
			to: new Date()
		});

		expect(samples.length).toBeGreaterThan(0);
		for (const sample of samples) {
			expect(sample.bucketAt.getTime() % (BUCKET_SECONDS * 1000)).toBe(0);
		}
	});

	test('the newest buckets stay provisional, because a late sample may revise them', async () => {
		const router = build(true);
		await router.readMetricSeries(scope, 'payment-api');

		const samples = await store.readSeries({
			connectionId: 'fixture-apm',
			capability: 'apm.metricSeries',
			environment: 'production',
			from: new Date(Date.now() - 3_600_000),
			to: new Date()
		});

		const horizon = Date.now() - SETTLING_SECONDS * 1000;
		const recent = samples.filter((one) => one.bucketAt.getTime() >= horizon);

		expect(recent.length).toBeGreaterThan(0);
		expect(recent.every((one) => !one.settled)).toBe(true);
	});
});

describeSeries('without a store', () => {
	test('falls back to asking for the whole window every time', async () => {
		// A deployment with no database still works; it simply asks more often.
		asked.length = 0;
		const router = build(false);

		await router.readMetricSeries(scope, 'payment-api');
		await router.readMetricSeries(scope, 'payment-api');

		// No window override at all: the provider derives it from the scope, as before.
		expect(asked.filter((one) => one === null).length).toBeGreaterThan(0);
	});
});
