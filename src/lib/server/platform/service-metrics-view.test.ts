import { describe, expect, test } from 'bun:test';
import type {
	LatencyHeatmap,
	MetricInsight,
	ServiceEndpoint,
	SloBudget,
	TimeSeries
} from '$lib/platform/types';
import { METRIC_ENDPOINT_LIMIT, buildServiceMetricsSnapshot } from './service-metrics-view';
import { FixtureServiceSource } from './fixture-source';
import { CapabilityUnavailableError } from '../sources/errors';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const source = new FixtureServiceSource();

const build = (slug: string) => buildServiceMetricsSnapshot(source, scope, slug);

/**
 * Unwraps a panel that the fixture source always answers.
 *
 * Asserting `status === 'ok'` first is what would catch a fixture read silently
 * becoming a gap — the same shape `insightsOf` below uses for the insights panel.
 */
function dataOf<T>(panel: { status: string }): T {
	expect(panel.status).toBe('ok');
	return (panel as { status: 'ok'; data: T }).data;
}

describe('buildServiceMetricsSnapshot', () => {
	test('an unknown slug is null, so the route can answer 404', async () => {
		expect(await build('no-such-service')).toBeNull();
	});

	test('every chart covers the same buckets, so two panels cannot show different minutes', async () => {
		const snapshot = (await build('payment-api'))!;
		const requestRate = dataOf<TimeSeries>(snapshot.requestRate);
		const expected = requestRate.points.map((point) => point.label);

		for (const series of [
			dataOf<TimeSeries>(snapshot.p95Latency),
			dataOf<TimeSeries>(snapshot.errorRate),
			...dataOf<TimeSeries[]>(snapshot.saturation),
			...dataOf<TimeSeries[]>(snapshot.byEndpoint),
			...dataOf<TimeSeries[]>(snapshot.byInstance)
		]) {
			expect(series.points.map((point) => point.label)).toEqual(expected);
		}
	});

	test('the tiles read off the series plotted beneath them', async () => {
		const snapshot = (await build('payment-api'))!;
		const requestRate = dataOf<TimeSeries>(snapshot.requestRate);
		const tile = snapshot.stats.find((stat) => stat.id === 'request-rate');

		expect(tile?.kind).toBe('trend');
		if (tile?.kind !== 'trend') throw new Error('unreachable');
		expect(tile.series.values.at(-1)).toBe(requestRate.points.at(-1)!.value);
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
		const byInstance = dataOf<TimeSeries[]>(snapshot.byInstance);

		expect(byInstance).toHaveLength(snapshot.service.instancesTotal);
		expect(new Set(byInstance.map((one) => one.id)).size).toBe(byInstance.length);
	});

	test('the endpoint bands are one per endpoint in the table', async () => {
		const snapshot = (await build('payment-api'))!;
		const byEndpoint = dataOf<TimeSeries[]>(snapshot.byEndpoint);
		const endpoints = dataOf<ServiceEndpoint[]>(snapshot.endpoints);

		expect(byEndpoint).toHaveLength(endpoints.length);
		expect(endpoints.length).toBeLessThanOrEqual(METRIC_ENDPOINT_LIMIT);
	});

	test('the request shares account for the traffic, near enough to read', async () => {
		const snapshot = (await build('payment-api'))!;
		const endpoints = dataOf<ServiceEndpoint[]>(snapshot.endpoints);
		const shares = endpoints.reduce((sum, one) => sum + one.requestSharePct, 0);

		expect(shares).toBeGreaterThan(60);
		expect(shares).toBeLessThanOrEqual(100);
	});

	test('traffic and latency rank differently, which is why both shares exist', async () => {
		const snapshot = (await build('payment-api'))!;
		const endpoints = dataOf<ServiceEndpoint[]>(snapshot.endpoints);
		const slowest = [...endpoints].sort((a, b) => b.p95LatencyMs - a.p95LatencyMs);
		const busiest = [...endpoints].sort((a, b) => b.requestsPerSecond - a.requestsPerSecond);

		// The health check is the fastest endpoint and among the least called; if these
		// two orders were identical, one share would be enough.
		expect(slowest.map((one) => one.id)).not.toEqual(
			busiest
				.map((one) => one.id)
				.slice()
				.reverse()
		);
	});

	test('a missing SLO costs only the availability tile, not the four the series answered', async () => {
		/*
		 * `apm.slo` and `apm.metricSeries` are different capabilities and gap
		 * independently. A source that plots every series but does not do error budgets
		 * must not lose its request-rate, error-rate, p95-latency and throughput tiles —
		 * those came from a read that answered fine.
		 */
		const noSlo = new (class extends FixtureServiceSource {
			async readSloBudget(): Promise<SloBudget> {
				throw new CapabilityUnavailableError('apm.slo', 'no-connection');
			}
		})();

		const snapshot = (await buildServiceMetricsSnapshot(noSlo, scope, 'payment-api'))!;
		const statIds = snapshot.stats.map((stat) => stat.id);

		expect(statIds).toEqual([
			'availability',
			'request-rate',
			'error-rate',
			'p95-latency',
			'throughput',
			'instances'
		]);

		const requestRate = snapshot.stats.find((stat) => stat.id === 'request-rate');
		expect(requestRate?.kind).toBe('trend');
		if (requestRate?.kind !== 'trend') throw new Error('unreachable');
		// Not "Not reported" — this tile's series answered, so it carries a value.
		expect(requestRate.formatted).not.toBe('Not reported');

		const availability = snapshot.stats.find((stat) => stat.id === 'availability');
		expect(availability?.kind).toBe('note');
		if (availability?.kind !== 'note') throw new Error('unreachable');
		expect(availability.formatted).toBe('Not reported');
		// Names the SLO, not the service — the tiles beside it prove the service is
		// measured just fine.
		expect(availability.caption).toContain('SLO');
		expect(availability.caption).not.toBe('No connected APM source measures this service.');
	});
});

describe('the error budget', () => {
	test('the allowance is derived from the target, not stated beside it', async () => {
		const snapshot = (await build('payment-api'))!;
		const slo = dataOf<SloBudget>(snapshot.slo);

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
		const slo = dataOf<SloBudget>(snapshot.slo);

		expect(slo.achievedPct).toBeLessThan(slo.targetPct);
		expect(slo.remainingPct).toBe(0);
		expect(slo.remainingLabel).toBe('0m');
	});
});

describe('the latency heatmap', () => {
	test('every cell lands in a band the legend describes', async () => {
		const snapshot = (await build('payment-api'))!;
		const heatmap = dataOf<LatencyHeatmap>(snapshot.heatmap);

		for (const cell of heatmap.cells) {
			expect(cell.band).toBeGreaterThanOrEqual(0);
			expect(cell.band).toBeLessThan(heatmap.bands.length);
		}
	});

	test('the grid is complete, so no cell renders empty', async () => {
		const snapshot = (await build('payment-api'))!;
		const heatmap = dataOf<LatencyHeatmap>(snapshot.heatmap);

		expect(heatmap.cells).toHaveLength(heatmap.columnLabels.length * heatmap.rowLabels.length);
	});

	test('the distribution is not a straight line, or every row reads the same', async () => {
		const snapshot = (await build('payment-api'))!;
		const heatmap = dataOf<LatencyHeatmap>(snapshot.heatmap);
		const bandsIn = (row: number) =>
			new Set(heatmap.cells.filter((cell) => cell.row === row).map((cell) => cell.band));

		// The fastest row and the slowest must not share a band, or the heatmap is
		// showing one colour and calling it a distribution.
		const top = bandsIn(0);
		const bottom = bandsIn(heatmap.rowLabels.length - 1);
		expect([...top].some((band) => bottom.has(band))).toBe(false);
	});

	test('the slow tail is at the top, which is the direction a reader scans', async () => {
		const snapshot = (await build('payment-api'))!;
		const heatmap = dataOf<LatencyHeatmap>(snapshot.heatmap);
		const bandOf = (row: number) =>
			heatmap.cells.filter((cell) => cell.row === row).reduce((sum, cell) => sum + cell.band, 0);

		// Lower band index is slower, so the top row must total less than the bottom.
		expect(bandOf(0)).toBeLessThan(bandOf(heatmap.rowLabels.length - 1));
	});
});

describe('metric insights', () => {
	/**
	 * The snapshot carries a `Panel`, because a source may decline to offer insights.
	 * Against the fixture source it is always `ok`, and asserting that here is what
	 * would catch it silently becoming a gap.
	 */
	function insightsOf(snapshot: { insights: { status: string } }) {
		expect(snapshot.insights.status).toBe('ok');
		return (snapshot.insights as { status: 'ok'; data: MetricInsight[] }).data;
	}

	test('an anomaly states the range it left', async () => {
		const snapshot = (await build('payment-api'))!;
		const anomaly = insightsOf(snapshot).find((one) => one.id === 'error-rate');

		expect(anomaly?.kind).toBe('anomaly');
		expect(anomaly?.detail).toContain('normal range');
	});

	test('a service inside its normal range raises no error-rate anomaly', async () => {
		const snapshot = (await build('user-profile'))!;

		expect(insightsOf(snapshot).some((one) => one.id === 'error-rate')).toBe(false);
	});

	test('every insight says what it was observed on', async () => {
		const snapshot = (await build('payment-api'))!;

		expect(insightsOf(snapshot).length).toBeGreaterThan(0);
		expect(insightsOf(snapshot).every((one) => one.affects.length > 0)).toBe(true);
	});
});
