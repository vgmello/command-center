import { describe, expect, test } from 'bun:test';
import {
	buildCountTiles,
	buildMetrics,
	buildOverview,
	buildSystemStatus,
	toSeries
} from './snapshot';
import type { DeploymentSource, InfrastructureSource, PlatformSource } from './source';
import type { DomainStatusCounts, RateObservation } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

const counts = (
	healthy: number,
	degraded: number,
	down: number,
	unknown = 0
): DomainStatusCounts => ({ healthy, degraded, down, unknown });

/**
 * A source that returns exactly what the test says and records how it was called.
 *
 * The assembler is supposed to depend on the interface and nothing else — building
 * a snapshot from a stub that shares no code with the fixtures is what proves it.
 */
function stubSource(overrides: Partial<PlatformSource> = {}) {
	const calls: string[] = [];

	const source: PlatformSource = {
		id: 'stub',
		async readDomainStatusCounts() {
			calls.push('counts');
			return counts(3, 1, 1);
		},
		async readRates() {
			calls.push('rates');
			return [];
		},
		async queryDomains() {
			calls.push('domains');
			return {
				domains: [],
				page: { page: 1, pageSize: 8, totalItems: 0, totalPages: 1, from: 0, to: 0 }
			};
		},
		async findDomain() {
			calls.push('domain');
			return null;
		},
		async readDomainVitals() {
			calls.push('domain-vitals');
			return null;
		},
		async readDomainDependencies() {
			calls.push('domain-dependencies');
			return { upstream: [], downstream: [], criticalPath: [] };
		},
		async listIncidents(_scope, limit) {
			calls.push(`incidents:${limit}`);
			return [];
		},
		async listOwners() {
			calls.push('owners');
			return [];
		},
		async listRecentChanges(_scope, limit) {
			calls.push(`changes:${limit}`);
			return [];
		},
		async readActivitySummary() {
			calls.push('activity');
			return {
				activeIncidents: 0,
				incidentDomains: 0,
				deploymentsToday: 0,
				deploymentDomains: 0
			};
		},
		...overrides
	};

	const deployments: DeploymentSource = {
		id: 'stub',
		async listDeployments(_scope, limit) {
			calls.push(`deployments:${limit}`);
			return [];
		},
		async queryDeployments() {
			calls.push('deployment-page');
			return {
				deployments: [],
				page: { page: 1, pageSize: 8, totalItems: 0, totalPages: 1, from: 0, to: 0 }
			};
		},
		async readSummary() {
			calls.push('deployment-summary');
			return {
				total: 0,
				domainCount: 0,
				successful: 0,
				inProgress: 0,
				failed: 0,
				meanDurationSeconds: 0,
				changeFailureRatePct: 0,
				meanDurationChangePct: 0,
				changeFailureRateChangePct: 0,
				totalChangePct: 0
			};
		},
		async readDomainBreakdown() {
			calls.push('deployment-breakdown');
			return { total: 0, slices: [] };
		},
		async readStatusTrend() {
			calls.push('deployment-status-trend');
			return [];
		},
		async readTrends() {
			calls.push('deployment-trends');
			const empty = { id: 'x', label: 'x', points: [], min: 0, max: 0 };
			return { frequency: empty, meanDuration: empty };
		},
		async listInsights() {
			calls.push('deployment-insights');
			return [];
		},
		async listDeployingDomains() {
			calls.push('deploying-domains');
			return [];
		}
	};

	const estate: InfrastructureSource = {
		id: 'stub',
		async listGroups() {
			calls.push('infrastructure');
			return [];
		},
		async listRegions() {
			calls.push('regions');
			return [];
		},
		async readNodeCounts() {
			calls.push('node-counts');
			return { healthy: 0, warning: 0, down: 0 };
		},
		async listClusters() {
			calls.push('clusters');
			return [];
		},
		async readUtilization() {
			calls.push('utilization');
			return [];
		},
		async readStorage() {
			calls.push('storage');
			return { totalBytes: 0, classes: [] };
		},
		async listDatabases() {
			calls.push('databases');
			return [];
		},
		async listQueues() {
			calls.push('queues');
			return [];
		},
		async listAlerts() {
			calls.push('infra-alerts');
			return [];
		},
		async readCost() {
			calls.push('cost');
			return {
				labels: [],
				categories: [],
				total: 0,
				totalFormatted: '$0',
				changePct: 0,
				forecast: 0,
				forecastFormatted: '$0',
				forecastChangePct: 0
			};
		}
	};

	return { source, deployments, estate, calls };
}

describe('buildCountTiles', () => {
	test('the status counts add up to the total', () => {
		const [total, ...statuses] = buildCountTiles(counts(18, 4, 3));

		expect(total.value).toBe(25);
		expect(statuses.reduce((sum, tile) => sum + tile.value, 0)).toBe(25);
		expect(statuses.map((tile) => tile.percentage)).toEqual([72, 16, 12]);
	});

	test('every tile names its own icon, so the client picks none', () => {
		expect(buildCountTiles(counts(1, 0, 0)).every((tile) => tile.icon.length > 0)).toBe(true);
	});

	test('the total tile has a caption instead of a percentage', () => {
		const [total] = buildCountTiles(counts(1, 0, 0));
		expect(total.percentage).toBeNull();
		expect(total.caption).toBe('Across platform');
	});

	test('does not divide by zero when nothing is reporting', () => {
		expect(buildCountTiles(counts(0, 0, 0)).every((tile) => tile.value === 0)).toBe(true);
	});
});

describe('buildMetrics', () => {
	const observation = (over: Partial<RateObservation>): RateObservation => ({
		id: 'm',
		label: 'M',
		value: 1,
		kind: 'rate',
		unit: 'req/s',
		samples: [1, 2, 3],
		change: 1,
		polarity: 'neutral',
		...over
	});

	test('formats each kind in its own unit', () => {
		const [rate, percent, duration] = buildMetrics(
			[
				observation({ kind: 'rate', value: 18_700, unit: 'req/s' }),
				observation({ kind: 'percent', value: 1.38, unit: '' }),
				observation({ kind: 'duration-ms', value: 412, unit: 'ms' })
			],
			'15m'
		);

		expect([rate.formatted, rate.unit]).toEqual(['18.7k', 'req/s']);
		expect([percent.formatted, percent.unit]).toEqual(['1.38%', '']);
		expect([duration.formatted, duration.unit]).toEqual(['412', 'ms']);
	});

	test('reads direction from the sign of the change', () => {
		const [up, down, flat] = buildMetrics(
			[observation({ change: 3 }), observation({ change: -3 }), observation({ change: 0 })],
			'15m'
		);

		expect([up.direction, down.direction, flat.direction]).toEqual(['up', 'down', 'flat']);
	});

	test("a duration's change is in its own unit, a rate's is a percentage", () => {
		const [rate, duration] = buildMetrics(
			[
				observation({ kind: 'rate', change: 8.4 }),
				observation({ kind: 'duration-ms', unit: 'ms', change: -28 })
			],
			'15m'
		);

		expect(rate.changeFormatted).toBe('↑ 8.4%');
		expect(duration.changeFormatted).toBe('↓ 28ms');
	});

	test('carries polarity through untouched, since only the source knows it', () => {
		const [metric] = buildMetrics([observation({ polarity: 'lower-is-better' })], '15m');
		expect(metric.polarity).toBe('lower-is-better');
	});

	test('labels the comparison window with the compact range id', () => {
		expect(buildMetrics([observation({})], '1h')[0].comparedToLabel).toBe('vs 1h ago');
	});
});

describe('toSeries', () => {
	test('precomputes the bounds the sparklines scale against', () => {
		expect(toSeries([3, 9, 5])).toEqual({ values: [3, 9, 5], min: 3, max: 9 });
	});

	test('an empty series does not produce Infinity bounds', () => {
		expect(toSeries([])).toEqual({ values: [], min: 0, max: 0 });
	});
});

describe('buildSystemStatus', () => {
	test('an outage outranks a degradation', () => {
		expect(buildSystemStatus(counts(1, 1, 1)).status).toBe('down');
	});

	test('reports all clear only when nothing is wrong', () => {
		const status = buildSystemStatus(counts(5, 0, 0));
		expect(status.label).toBe('All Systems');
		expect(status.detail).toBe('Operational');
	});

	test('pluralises the detail line', () => {
		expect(buildSystemStatus(counts(1, 1, 0)).detail).toBe('1 domain degraded');
		expect(buildSystemStatus(counts(1, 2, 0)).detail).toBe('2 domains degraded');
	});
});

describe('buildOverview', () => {
	test('assembles from the interface alone, with no knowledge of the fixtures', async () => {
		const { source, deployments, estate } = stubSource();
		const snapshot = await buildOverview(
			source,
			deployments,
			estate,
			scope,
			new Date('2026-09-03T12:00:00.000Z')
		);

		expect(snapshot.counts[0].value).toBe(5);
		expect(snapshot.distribution.total).toBe(5);
		expect(snapshot.generatedAt).toBe('2026-09-03T12:00:00.000Z');
		expect(snapshot.environment).toBe('production');
		expect(snapshot.timeRange).toBe('15m');
	});

	test('the tiles and the donut are built from the same counts', async () => {
		const { source, deployments, estate } = stubSource();
		const snapshot = await buildOverview(source, deployments, estate, scope);

		const healthyTile = snapshot.counts.find((tile) => tile.id === 'healthy');
		const healthySlice = snapshot.distribution.slices.find((slice) => slice.status === 'healthy');

		expect(healthyTile?.value).toBe(healthySlice?.count);
		expect(snapshot.distribution.total).toBe(snapshot.counts[0].value);
	});

	test('asks the source for the panel limits rather than trimming afterwards', async () => {
		const { source, deployments, estate, calls } = stubSource();
		await buildOverview(source, deployments, estate, scope);

		expect(calls).toContain('incidents:5');
		expect(calls).toContain('deployments:5');
	});

	test('does not fetch the domain table; that is a separate query', async () => {
		const { source, deployments, estate, calls } = stubSource();
		await buildOverview(source, deployments, estate, scope);

		expect(calls).not.toContain('domains');
	});

	test('propagates a source failure instead of serving a half-built page', async () => {
		const { source, deployments, estate } = stubSource({
			async readRates() {
				throw new Error('metrics backend unreachable');
			}
		});

		expect(buildOverview(source, deployments, estate, scope)).rejects.toThrow(
			'metrics backend unreachable'
		);
	});
});
