import { describe, expect, test } from 'bun:test';
import { RECENT_CHANGE_LIMIT, buildDomainCountTiles, buildDomainsSnapshot } from './domains-view';
import { FixturePlatformSource } from './fixture-source';
import type { ActivitySummary, DomainStatusCounts } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

const counts = (healthy: number, degraded: number, down: number): DomainStatusCounts => ({
	healthy,
	degraded,
	down,
	unknown: 0
});

const activity = (overrides: Partial<ActivitySummary> = {}): ActivitySummary => ({
	activeIncidents: 7,
	incidentDomains: 5,
	deploymentsToday: 29,
	deploymentDomains: 6,
	...overrides
});

describe('buildDomainCountTiles', () => {
	test('extends the overview tiles rather than restating them', () => {
		const tiles = buildDomainCountTiles(counts(18, 5, 2), activity());

		expect(tiles.map((tile) => tile.id)).toEqual([
			'total',
			'healthy',
			'degraded',
			'down',
			'active-incidents',
			'deployments-today'
		]);
	});

	test('the activity tiles caption their domain span instead of a percentage', () => {
		const [incidents, deployments] = buildDomainCountTiles(counts(18, 5, 2), activity()).slice(-2);

		expect(incidents.caption).toBe('Across 5 domains');
		expect(deployments.caption).toBe('Across 6 domains');
		// A share of the domain total would be a denominator neither number is measured against.
		expect(incidents.percentage).toBeNull();
		expect(deployments.percentage).toBeNull();
	});

	test('singular reads correctly, because one domain is the common case at 3am', () => {
		const [incidents] = buildDomainCountTiles(
			counts(24, 0, 1),
			activity({ activeIncidents: 1, incidentDomains: 1 })
		).slice(-2);

		expect(incidents.caption).toBe('Across 1 domain');
	});

	test('the incident tile goes quiet when there is nothing to report', () => {
		const [incidents] = buildDomainCountTiles(
			counts(25, 0, 0),
			activity({ activeIncidents: 0, incidentDomains: 0 })
		).slice(-2);

		expect(incidents.status).toBe('healthy');
	});

	test('every tile names its own icon, so the client picks none', () => {
		expect(
			buildDomainCountTiles(counts(1, 0, 0), activity()).every((tile) => tile.icon.length > 0)
		).toBe(true);
	});
});

describe('buildDomainsSnapshot', () => {
	test('carries the scope it was assembled for', async () => {
		const snapshot = await buildDomainsSnapshot(new FixturePlatformSource(), scope, new Date(0));

		expect(snapshot.environment).toBe('production');
		expect(snapshot.timeRange).toBe('15m');
		expect(snapshot.generatedAt).toBe(new Date(0).toISOString());
	});

	test('the donut and the total tile agree', async () => {
		const snapshot = await buildDomainsSnapshot(new FixturePlatformSource(), scope);
		const total = snapshot.counts.find((tile) => tile.id === 'total');

		expect(total).toBeDefined();
		expect(snapshot.distribution.total).toBe(total!.value);
	});

	test('honours the change limit rather than trusting the source to slice', async () => {
		const snapshot = await buildDomainsSnapshot(new FixturePlatformSource(), scope);

		expect(snapshot.changes.length).toBeLessThanOrEqual(RECENT_CHANGE_LIMIT);
	});

	test('sends the owner options, so the filter is not declared by the client', async () => {
		const snapshot = await buildDomainsSnapshot(new FixturePlatformSource(), scope);

		expect(snapshot.owners.length).toBeGreaterThan(0);
		expect(snapshot.owners.every((owner) => owner.domainCount > 0)).toBe(true);
	});
});
