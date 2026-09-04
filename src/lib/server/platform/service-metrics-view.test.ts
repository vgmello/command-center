import { describe, expect, test } from 'bun:test';
import { METRIC_ENDPOINT_LIMIT, buildServiceMetricsSnapshot } from './service-metrics-view';
import { FixtureServiceSource } from './fixture-source';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const source = new FixtureServiceSource();

const build = (slug: string) => buildServiceMetricsSnapshot(source, scope, slug);

describe('buildServiceMetricsSnapshot', () => {
	test('an unknown slug is null, so the route can answer 404', async () => {
		expect(await build('no-such-service')).toBeNull();
	});

	test('every chart covers the same buckets, so two panels cannot show different minutes', async () => {
		const snapshot = (await build('payment-api'))!;
		const expected = snapshot.requestRate.points.map((point) => point.label);

		for (const series of [
			snapshot.p95Latency,
			snapshot.errorRate,
			...snapshot.saturation,
			...snapshot.byEndpoint,
			...snapshot.byInstance
		]) {
			expect(series.points.map((point) => point.label)).toEqual(expected);
		}
	});

	test('the tiles read off the series plotted beneath them', async () => {
		const snapshot = (await build('payment-api'))!;
		const tile = snapshot.stats.find((stat) => stat.id === 'request-rate');

		expect(tile?.kind).toBe('trend');
		if (tile?.kind !== 'trend') throw new Error('unreachable');
		expect(tile.series.values.at(-1)).toBe(snapshot.requestRate.points.at(-1)!.value);
	});

	test('and those readings match the ones the overview tab shows', async () => {
		const snapshot = (await build('payment-api'))!;
		const overview = await source.readStats(scope, 'payment-api');

		// A reader switching tabs must not watch P95 change for no reason. Both tabs
		// report the service's stated figures; the metrics series is pinned to them.
		for (const id of ['request-rate', 'error-rate', 'p95-latency']) {
			const here = snapshot.stats.find((stat) => stat.id === id);
			const there = overview.find((stat) => stat.id === id);

			expect(here?.kind, id).toBe('trend');
			expect(there?.kind, id).toBe('trend');
			if (here?.kind !== 'trend' || there?.kind !== 'trend') throw new Error('unreachable');
			expect(here.formatted, id).toBe(there.formatted);
			expect(here.unit, id).toBe(there.unit);
		}
	});

	test('the instance chart has one line per instance the service reports', async () => {
		const snapshot = (await build('payment-api'))!;

		expect(snapshot.byInstance).toHaveLength(snapshot.service.instancesTotal);
		expect(new Set(snapshot.byInstance.map((one) => one.id)).size).toBe(snapshot.byInstance.length);
	});

	test('the endpoint bands are one per endpoint in the table', async () => {
		const snapshot = (await build('payment-api'))!;

		expect(snapshot.byEndpoint).toHaveLength(snapshot.endpoints.length);
		expect(snapshot.endpoints.length).toBeLessThanOrEqual(METRIC_ENDPOINT_LIMIT);
	});

	test('the request shares account for the traffic, near enough to read', async () => {
		const snapshot = (await build('payment-api'))!;
		const shares = snapshot.endpoints.reduce((sum, one) => sum + one.requestSharePct, 0);

		expect(shares).toBeGreaterThan(60);
		expect(shares).toBeLessThanOrEqual(100);
	});

	test('traffic and latency rank differently, which is why both shares exist', async () => {
		const snapshot = (await build('payment-api'))!;
		const slowest = [...snapshot.endpoints].sort((a, b) => b.p95LatencyMs - a.p95LatencyMs);
		const busiest = [...snapshot.endpoints].sort(
			(a, b) => b.requestsPerSecond - a.requestsPerSecond
		);

		// The health check is the fastest endpoint and among the least called; if these
		// two orders were identical, one share would be enough.
		expect(slowest.map((one) => one.id)).not.toEqual(
			busiest
				.map((one) => one.id)
				.slice()
				.reverse()
		);
	});
});

describe('the error budget', () => {
	test('the allowance is derived from the target, not stated beside it', async () => {
		const snapshot = (await build('payment-api'))!;
		const { slo } = snapshot;

		/*
		 * The arithmetic, not a format: a 99.90% target over 30 days allows 43.2 minutes
		 * of downtime, and achieving 99.95% spends half of it. That is the whole reason
		 * the allowance is derived — a hand-written "21h 36m" beside a 99.9% target is a
		 * number no window and no target produce.
		 */
		expect(slo.achievedPct).toBe(99.95);
		expect(slo.targetPct).toBe(99.9);
		expect(slo.remainingPct).toBeCloseTo(50, 0);
		expect(slo.remainingLabel).toBe('21m');
	});

	test('a service under its target has burned the budget, not gone negative', async () => {
		const snapshot = (await build('notification-worker'))!;

		expect(snapshot.slo.achievedPct).toBeLessThan(snapshot.slo.targetPct);
		expect(snapshot.slo.remainingPct).toBe(0);
		expect(snapshot.slo.remainingLabel).toBe('0m');
	});
});

describe('the latency heatmap', () => {
	test('every cell lands in a band the legend describes', async () => {
		const snapshot = (await build('payment-api'))!;

		for (const cell of snapshot.heatmap.cells) {
			expect(cell.band).toBeGreaterThanOrEqual(0);
			expect(cell.band).toBeLessThan(snapshot.heatmap.bands.length);
		}
	});

	test('the grid is complete, so no cell renders empty', async () => {
		const { heatmap } = (await build('payment-api'))!;

		expect(heatmap.cells).toHaveLength(heatmap.columnLabels.length * heatmap.rowLabels.length);
	});

	test('the distribution is not a straight line, or every row reads the same', async () => {
		const { heatmap } = (await build('payment-api'))!;
		const bandsIn = (row: number) =>
			new Set(heatmap.cells.filter((cell) => cell.row === row).map((cell) => cell.band));

		// The fastest row and the slowest must not share a band, or the heatmap is
		// showing one colour and calling it a distribution.
		const top = bandsIn(0);
		const bottom = bandsIn(heatmap.rowLabels.length - 1);
		expect([...top].some((band) => bottom.has(band))).toBe(false);
	});

	test('the slow tail is at the top, which is the direction a reader scans', async () => {
		const { heatmap } = (await build('payment-api'))!;
		const bandOf = (row: number) =>
			heatmap.cells.filter((cell) => cell.row === row).reduce((sum, cell) => sum + cell.band, 0);

		// Lower band index is slower, so the top row must total less than the bottom.
		expect(bandOf(0)).toBeLessThan(bandOf(heatmap.rowLabels.length - 1));
	});
});

describe('metric insights', () => {
	test('an anomaly states the range it left', async () => {
		const snapshot = (await build('payment-api'))!;
		const anomaly = snapshot.insights.find((one) => one.id === 'error-rate');

		expect(anomaly?.kind).toBe('anomaly');
		expect(anomaly?.detail).toContain('normal range');
	});

	test('a service inside its normal range raises no error-rate anomaly', async () => {
		const snapshot = (await build('user-profile'))!;

		expect(snapshot.insights.some((one) => one.id === 'error-rate')).toBe(false);
	});

	test('every insight says what it was observed on', async () => {
		const snapshot = (await build('payment-api'))!;

		expect(snapshot.insights.length).toBeGreaterThan(0);
		expect(snapshot.insights.every((one) => one.affects.length > 0)).toBe(true);
	});
});
