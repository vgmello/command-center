import { describe, expect, test } from 'bun:test';
import {
	ALERT_LIMIT,
	CLUSTER_LIMIT,
	buildInfraStats,
	buildInfrastructureSnapshot,
	describeOverallHealth,
	estateHealth
} from './infrastructure-view';
import { FixtureInfrastructureSource } from './fixture-source';
import type { NodeCounts } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const source = new FixtureInfrastructureSource();

const nodes = (healthy: number, warning: number, down: number): NodeCounts => ({
	healthy,
	warning,
	down
});

describe('estateHealth', () => {
	test('a whole estate is not at risk because one node is rebuilding', () => {
		// The reason this is not `rollUpStatus`: worst-wins would call this "At risk".
		expect(estateHealth(nodes(42, 4, 2)).headline).toBe('Good');
		expect(estateHealth(nodes(42, 4, 2)).tone).toBe('healthy');
	});

	test('enough degraded nodes make it fair', () => {
		expect(estateHealth(nodes(38, 10, 2)).headline).toBe('Fair');
	});

	test('enough dead nodes make it at risk', () => {
		expect(estateHealth(nodes(38, 4, 8)).headline).toBe('At risk');
		expect(estateHealth(nodes(38, 4, 8)).tone).toBe('down');
	});

	test('a perfect estate is good', () => {
		expect(estateHealth(nodes(50, 0, 0)).headline).toBe('Good');
	});

	test('no telemetry is not health', () => {
		expect(estateHealth(nodes(0, 0, 0)).headline).toBe('Unknown');
	});
});

describe('describeOverallHealth', () => {
	test('names the worst thing that is actually true', () => {
		expect(describeOverallHealth(nodes(48, 0, 0))).toBe('No critical issues');
		expect(describeOverallHealth(nodes(44, 4, 0))).toBe('4 nodes degraded');
		expect(describeOverallHealth(nodes(45, 2, 1))).toBe('1 node down');
	});
});

describe('buildInfraStats', () => {
	test('the node tile counts what the donut counts', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);
		const tile = snapshot.stats.find((stat) => stat.id === 'nodes');
		const donutTotal = snapshot.nodes.healthy + snapshot.nodes.warning + snapshot.nodes.down;

		expect(tile?.kind).toBe('ratio');
		if (tile?.kind !== 'ratio') throw new Error('unreachable');
		expect(tile.value).toBe(donutTotal);
	});

	test('the four utilisation tiles are the four panels, not a second reading', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);

		for (const resource of snapshot.resources) {
			const tile = snapshot.stats.find((stat) => stat.id === resource.id);
			expect(tile?.kind).toBe('trend');
			if (tile?.kind !== 'trend') throw new Error('unreachable');
			expect(tile.formatted).toBe(resource.formatted);
			expect(tile.unit).toBe(resource.unit);
		}
	});

	test('every tile names an icon, so the client picks none', () => {
		const stats = buildInfraStats(nodes(42, 4, 2), 52, 6, []);

		expect(stats.every((stat) => (stat.icon ?? '').length > 0)).toBe(true);
	});
});

describe('buildInfrastructureSnapshot', () => {
	test('carries the scope it was assembled for', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope, new Date(0));

		expect(snapshot.environment).toBe('production');
		expect(snapshot.generatedAt).toBe(new Date(0).toISOString());
	});

	test('honours its limits rather than trusting the source to slice', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);

		expect(snapshot.clusters.length).toBeLessThanOrEqual(CLUSTER_LIMIT);
		expect(snapshot.alerts.length).toBeLessThanOrEqual(ALERT_LIMIT);
	});

	test('every region carries coordinates a map can place', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);

		expect(snapshot.regions.length).toBeGreaterThan(0);
		for (const region of snapshot.regions) {
			expect(Math.abs(region.latitude)).toBeLessThanOrEqual(90);
			expect(Math.abs(region.longitude)).toBeLessThanOrEqual(180);
		}
	});

	test('the storage slices account for the whole total', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);
		const shares = snapshot.storage.classes.reduce((sum, one) => sum + one.percentage, 0);

		expect(shares).toBeGreaterThanOrEqual(99);
		expect(shares).toBeLessThanOrEqual(101);
	});

	test('the cost columns add up to the headline', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);
		const drawn = snapshot.cost.categories.reduce(
			(sum, category) => sum + category.daily.reduce((day, value) => day + value, 0),
			0
		);
		const stated = snapshot.cost.categories.reduce((sum, category) => sum + category.amount, 0);

		// A stacked chart whose columns sum to something other than the number printed
		// beside it is worse than no chart.
		expect(drawn).toBeCloseTo(stated, 6);
	});

	test('every category supplies a value for every day, so the columns stay aligned', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);

		for (const category of snapshot.cost.categories) {
			expect(category.daily).toHaveLength(snapshot.cost.labels.length);
		}
	});

	test('the category shares sum to a whole', async () => {
		const snapshot = await buildInfrastructureSnapshot(source, scope);
		const shares = snapshot.cost.categories.reduce((sum, one) => sum + one.percentage, 0);

		expect(shares).toBeGreaterThanOrEqual(99);
		expect(shares).toBeLessThanOrEqual(101);
	});
});
