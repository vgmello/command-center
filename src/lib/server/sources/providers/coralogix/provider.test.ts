import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { coralogixProvider } from './index';
import { buildEstate } from './mock/data';
import { requestLog, startCoralogixMock } from './mock/server';
import { capabilityDrift } from '../../agreement';
import { CAPABILITIES } from '$lib/platform/sources';
import type { ApmProvider } from '../../contracts';
import type { SourceContext } from '../../provider';
import type { EnvironmentId, TimeRangeId } from '$lib/platform/types';

const KEY = 'cxtp-testtesttesttest';
// Anchored at the wall clock, because the provider asks for a window ending "now".
// The values stay seeded and deterministic; only the timestamps move, which is what
// keeps the query's window and the estate's window overlapping.
const NOW = new Date();
const estate = buildEstate({ now: NOW, points: 1500, stepSeconds: 60 });

let mock: ReturnType<typeof startCoralogixMock>;
const log = requestLog();
let client: ApmProvider;

function context(
	slug?: string,
	environment: EnvironmentId = 'production',
	timeRange: TimeRangeId = '1h'
): SourceContext {
	return {
		scope: { environment, timeRange },
		connection: {
			id: 'coralogix-test',
			providerId: 'coralogix',
			kind: 'apm',
			label: 'Coralogix',
			icon: 'activity',
			settings: {}
		},
		binding: slug ? { kind: 'apm', connectionId: 'coralogix-test', externalId: slug } : undefined
	};
}

beforeAll(() => {
	mock = startCoralogixMock({ estate, apiKey: KEY, log });
	client = coralogixProvider.connect({
		baseUrl: mock.url,
		apiKey: KEY,
		serviceLabel: 'service',
		environmentLabel: 'environment',
		domainLabel: 'domain',
		metrics: {
			requests: 'http_server_request_duration_count',
			duration: 'http_server_request_duration_bucket',
			errors: 'http_server_request_duration_count',
			cpu: 'process_cpu_utilization',
			memory: 'process_memory_utilization',
			up: 'up'
		},
		sloTargetPct: 99.9,
		sloWindowDays: 30
	});
});

afterAll(() => {
	mock.stop();
});

describe('the provider definition', () => {
	test('declares only apm capabilities, all of them real', () => {
		for (const capability of coralogixProvider.capabilities) {
			expect(CAPABILITIES).toContain(capability);
			expect(capability.startsWith('apm.')).toBe(true);
		}
	});

	test('agrees with its own client — no capability without its method', () => {
		expect(capabilityDrift(coralogixProvider, client)).toEqual({
			declaredNotImplemented: [],
			implementedNotDeclared: []
		});
	});

	test('does not declare what Coralogix cannot answer', () => {
		const declared = [...coralogixProvider.capabilities];

		// A service map is a different API, and deployment counts are not an APM fact.
		// Insights are NOT on this list: they are derived from the metrics API by stated
		// arithmetic, which is a different thing from an opinion.
		expect(declared).not.toContain('apm.dependencies');
		expect(declared).not.toContain('apm.activity');
	});

	test('refuses settings with no base URL', () => {
		expect(() => coralogixProvider.connect({ apiKey: 'x' })).toThrow();
	});
});

describe('readRequestRate', () => {
	test('returns a populated series for a real service', async () => {
		const series = await client.readRequestRate!(context('payment-api'));

		expect(series.points.length).toBeGreaterThan(1);
		expect(series.max).toBeGreaterThan(0);
	});

	test('the scope actually scopes — staging is quieter than production', async () => {
		const live = await client.readRequestRate!(context('payment-api', 'production'));
		const staging = await client.readRequestRate!(context('payment-api', 'staging'));

		expect(staging.max).toBeLessThan(live.max);
	});

	test('the time range changes the window, not just the label', async () => {
		const short = await client.readRequestRate!(context('payment-api', 'production', '15m'));
		const long = await client.readRequestRate!(context('payment-api', 'production', '7d'));

		// Both target ~24 points, so the tell is the label format, not the count.
		expect(short.points[0].label).toMatch(/^\d{2}:\d{2}$/);
		expect(long.points[0].label).toMatch(/^\d+ \w{3}$/);
	});
});

describe('readServiceStats', () => {
	test('reports rate, latency, errors and instances', async () => {
		const stats = await client.readServiceStats!(context('payment-api'));
		const ids = stats.map((one) => one.id);

		expect(ids).toEqual(['request-rate', 'p95-latency', 'error-rate', 'instances']);
	});

	test('the instance ratio counts what is actually up', async () => {
		const stats = await client.readServiceStats!(context('payment-gateway'));
		const instances = stats.find((one) => one.id === 'instances');

		// The gateway has one seeded dead instance out of three.
		expect(instances?.kind).toBe('ratio');
		if (instances?.kind === 'ratio') {
			expect(instances.total).toBe(3);
			expect(instances.value).toBe(2);
			expect(instances.tone).toBe('degraded');
		}
	});

	test('latency is lower-is-better, so a rise is not read as good news', async () => {
		const stats = await client.readServiceStats!(context('payment-api'));
		const latency = stats.find((one) => one.id === 'p95-latency');

		expect(latency?.kind === 'trend' && latency.polarity).toBe('lower-is-better');
	});
});

describe('listHealthChecks', () => {
	test('a healthy service reports every instance up', async () => {
		const checks = await client.listHealthChecks!(context('payment-api'));
		const liveness = checks.find((one) => one.id === 'liveness');

		expect(liveness?.formatted).toBe('3/3 up');
		expect(liveness?.status).toBe('healthy');
	});

	test('a service with a dead instance is degraded, not down', async () => {
		const checks = await client.listHealthChecks!(context('payment-gateway'));
		const liveness = checks.find((one) => one.id === 'liveness');

		expect(liveness?.formatted).toBe('2/3 up');
		expect(liveness?.status).toBe('degraded');
	});
});

describe('listEndpoints', () => {
	test('ranks by latency and honours the limit', async () => {
		const rows = await client.listEndpoints!(context('payment-api'), 3);

		expect(rows.length).toBe(3);
		for (let index = 1; index < rows.length; index++) {
			expect(rows[index - 1].p95LatencyMs).toBeGreaterThanOrEqual(rows[index].p95LatencyMs);
		}
	});

	test('the slowest endpoint is the 100% share, since shares are of the rows returned', async () => {
		const rows = await client.listEndpoints!(context('payment-api'), 10);
		expect(rows[0].latencySharePct).toBe(100);
	});

	test('request shares sum to about one hundred', async () => {
		const rows = await client.listEndpoints!(context('payment-api'), 10);
		const total = rows.reduce((sum, one) => sum + one.requestSharePct, 0);

		expect(total).toBeGreaterThan(99);
		expect(total).toBeLessThan(101);
	});
});

describe('readMetricSeries', () => {
	test('returns every series the metrics tab draws', async () => {
		const metrics = await client.readMetricSeries!(context('payment-api'));

		expect(metrics.requestRate.points.length).toBeGreaterThan(1);
		expect(metrics.p95Latency.points.length).toBeGreaterThan(1);
		expect(metrics.errorRate.points.length).toBeGreaterThan(1);
		expect(metrics.saturation.length).toBe(2);
		expect(metrics.byEndpoint.length).toBeGreaterThan(1);
		expect(metrics.byInstance.length).toBe(3);
	});

	test('the stacked series share an x-axis, so they can be stacked', async () => {
		const metrics = await client.readMetricSeries!(context('payment-api'));
		const labels = metrics.byEndpoint.map((one) => one.points.map((p) => p.label).join('|'));

		expect(new Set(labels).size).toBe(1);
	});

	test('saturation is a percentage, so cpu and memory share one axis', async () => {
		const metrics = await client.readMetricSeries!(context('payment-api'));

		for (const series of metrics.saturation) {
			expect(series.max).toBeLessThanOrEqual(100);
			expect(series.min).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('readSloBudget', () => {
	test('reports an achieved figure and a budget derived from it', async () => {
		const slo = await client.readSloBudget!(context('payment-api'));

		expect(slo.targetPct).toBe(99.9);
		expect(slo.achievedPct).toBeGreaterThan(0);
		expect(slo.achievedPct).toBeLessThanOrEqual(100);
		expect(slo.remainingPct).toBeGreaterThanOrEqual(0);
		expect(slo.remainingPct).toBeLessThanOrEqual(100);
	});

	test('the label is derived from the minutes, so the two cannot disagree', async () => {
		const slo = await client.readSloBudget!(context('payment-api'));
		const hours = Math.floor(slo.remainingMinutes / 60);
		const minutes = slo.remainingMinutes % 60;

		expect(slo.remainingLabel).toBe(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
	});

	test('the window it names is the window it measured', async () => {
		const slo = await client.readSloBudget!(context('payment-api'));

		expect(slo.label).toContain('30d');
		expect(slo.burnWindowLabel).toBe('Last 30 days');
	});
});

describe('readLatencyHeatmap', () => {
	test('every cell has a band that exists in the legend', async () => {
		const heatmap = await client.readLatencyHeatmap!(context('payment-api'));

		expect(heatmap.cells.length).toBeGreaterThan(0);
		for (const cell of heatmap.cells) {
			expect(heatmap.bands[cell.band]).toBeDefined();
		}
	});

	test('the grid is complete — every row has every column', async () => {
		const heatmap = await client.readLatencyHeatmap!(context('payment-api'));

		// A row short of columns is how the fixture heatmap once ended up with eight
		// blank cells per row, so it is asserted rather than assumed.
		expect(heatmap.cells.length).toBe(heatmap.rowLabels.length * heatmap.columnLabels.length);
	});

	test('rows are the instances', async () => {
		const heatmap = await client.readLatencyHeatmap!(context('payment-api'));
		expect(heatmap.rowLabels.length).toBe(3);
	});
});

describe('readDomainVitals', () => {
	test('reports the domain’s series and service counts', async () => {
		const vitals = await client.readDomainVitals!(context('payments'));

		expect(vitals).not.toBeNull();
		expect(vitals!.requestRate.points.length).toBeGreaterThan(1);
		const counts = vitals!.serviceCounts;
		expect(counts.healthy + counts.degraded + counts.down).toBe(3);
		// The gateway's dead instance makes exactly one service degraded.
		expect(counts.degraded).toBe(1);
	});

	test('a domain the account has never seen is null, not an empty panel', async () => {
		// Zeroes under a real heading would read as "this domain is idle".
		expect(await client.readDomainVitals!(context('no-such-domain'))).toBeNull();
	});

	test('no binding at all is null rather than the whole account', async () => {
		expect(await client.readDomainVitals!(context())).toBeNull();
	});
});

describe('readRates', () => {
	test('reports the three headline rates with their samples', async () => {
		const rates = await client.readRates!(context());

		expect(rates.map((one) => one.id)).toEqual(['request-rate', 'p95-latency', 'error-rate']);
		for (const rate of rates) expect(rate.samples.length).toBeGreaterThan(1);
	});

	test('each carries the unit its number is actually in', async () => {
		const rates = await client.readRates!(context());

		expect(rates.find((one) => one.id === 'p95-latency')?.unit).toBe('ms');
		expect(rates.find((one) => one.id === 'error-rate')?.kind).toBe('percent');
	});
});

describe('listIncidents', () => {
	test('reads events out of DataPrime and maps them', async () => {
		const incidents = await client.listIncidents!(context(), 10);

		expect(incidents.length).toBeGreaterThan(0);
		for (const incident of incidents) {
			expect(incident.title.length).toBeGreaterThan(0);
			expect(['critical', 'warning', 'info']).toContain(incident.severity);
			expect(['open', 'acknowledged', 'resolved']).toContain(incident.state);
			expect(Number.isNaN(Date.parse(incident.openedAt))).toBe(false);
		}
	});

	test('drops the informational noise, keeping what is actionable', async () => {
		const incidents = await client.listIncidents!(context(), 10);
		const titles = incidents.map((one) => one.title);

		expect(titles).toContain('Elevated 5xx on /v1/charge');
		expect(titles).not.toContain('Search index rebuilt');
	});

	test('honours the limit', async () => {
		expect((await client.listIncidents!(context(), 1)).length).toBe(1);
	});
});

describe('resourceLink', () => {
	test('points into the configured account', () => {
		const link = coralogixProvider
			.connect({ baseUrl: 'https://api.eu2.coralogix.com', apiKey: KEY })
			.resourceLink({ kind: 'apm', connectionId: 'c', externalId: 'payment-api' }, 'overview');

		expect(link?.label).toBe('Show in Coralogix');
		expect(link?.href).toContain('payment-api');
	});

	test('no binding means no link', () => {
		expect(client.resourceLink(undefined, 'overview')).toBeNull();
	});
});

describe('scoping, proved against the mock’s own filters', () => {
	test('incidents are scoped to the environment, not the whole account', async () => {
		// The mock honours the filter clause, so a staging scope must not return the
		// production alerts — an on-call engineer chasing someone else's problem is the
		// failure this prevents.
		const production = await client.listIncidents!(context(undefined, 'production'), 10);
		const staging = await client.listIncidents!(context(undefined, 'staging'), 10);

		expect(production.length).toBeGreaterThan(0);
		expect(staging.length).toBe(0);
	});
});

describe('insights derived from the metrics API', () => {
	test('declares both, because both are arithmetic rather than opinion', () => {
		const declared = [...coralogixProvider.capabilities];

		expect(declared).toContain('apm.insights');
		expect(declared).toContain('apm.platformInsights');
	});

	test('a service inside its normal range raises nothing', async () => {
		const insights = await client.listMetricInsights!(context('catalogue-api'));

		// Filler findings are how a panel trains people to stop reading it.
		for (const insight of insights) {
			expect(['critical', 'warning']).toContain(insight.severity);
		}
	});

	test('every finding states its number, its baseline and why it was flagged', async () => {
		const insights = await client.listMetricInsights!(context('payment-gateway'));

		for (const insight of insights) {
			expect(insight.detail).toMatch(/mean of/);
			expect(insight.detail).toMatch(/σ|previously steady/);
			expect(insight.affects).toBe('payment-gateway');
			expect(Number.isNaN(Date.parse(insight.startedAt))).toBe(false);
		}
	});

	test('no binding means no per-service finding, rather than the whole account', async () => {
		expect(await client.listMetricInsights!(context())).toEqual([]);
	});

	test('the fleet view compares services against each other', async () => {
		const insights = await client.listPlatformInsights!(context());

		// It must be able to answer without a binding — that is the whole point of it.
		for (const insight of insights) {
			expect(insight.id.startsWith('fleet-')).toBe(true);
			expect(insight.detail.length).toBeGreaterThan(0);
		}
	});

	test('the fleet query asks for every service at once, not one at a time', async () => {
		// Two range queries — error rate and latency, each grouped by service. Asking per
		// service would be N round trips to answer a question about the fleet, and the
		// readings would come from slightly different moments.
		log.reset();
		await client.listPlatformInsights!(context());

		expect(log.counts.get('/metrics/api/v1/query_range')).toBe(2);
		expect(log.total()).toBe(2);
	});
});
