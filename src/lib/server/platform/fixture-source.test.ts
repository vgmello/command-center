import { describe, expect, test } from 'bun:test';
import {
	FixtureDeploymentSource,
	FixturePlatformSource,
	FixtureWorkspaceSource
} from './fixture-source';
import { listDomains } from './fixtures';
import { statusFromScore } from '$lib/platform/health';
import { ALL_OWNERS } from '$lib/platform/query';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const source = new FixturePlatformSource();
const deployments = new FixtureDeploymentSource();

describe('the fixture domain set', () => {
	const domains = listDomains();

	test('derives status from score rather than storing it', () => {
		for (const domain of domains) {
			expect(domain.status).toBe(statusFromScore(domain.healthScore));
		}
	});

	test('gives every domain a unique slug', () => {
		expect(new Set(domains.map((domain) => domain.slug)).size).toBe(domains.length);
	});

	test('produces series the sparklines can scale', () => {
		for (const domain of domains) {
			expect(domain.healthTrend.values.length).toBeGreaterThan(1);
			expect(domain.healthTrend.max).toBeGreaterThanOrEqual(domain.healthTrend.min);
		}
	});

	test('is deterministic, so a refresh does not redraw a different history', () => {
		expect(listDomains()[0].healthTrend.values).toEqual(domains[0].healthTrend.values);
	});
});

describe('FixturePlatformSource', () => {
	test('counts agree with the rows it would return', async () => {
		const counts = await source.readDomainStatusCounts(scope);
		const page = await source.queryDomains(scope, {
			search: '',
			status: 'all',
			owner: ALL_OWNERS,
			sort: 'name',
			page: 1,
			pageSize: 1000
		});

		const fromRows = page.domains.filter((domain) => domain.status === 'healthy').length;
		expect(counts.healthy).toBe(fromRows);
		expect(counts.healthy + counts.degraded + counts.down + counts.unknown).toBe(
			page.page.totalItems
		);
	});

	test('honours the incident limit and returns the worst first', async () => {
		const incidents = await source.listIncidents(scope, 3);

		expect(incidents).toHaveLength(3);
		expect(incidents[0].severity).toBe('critical');
	});

	test('honours the deployment limit and returns the newest first', async () => {
		const log = await deployments.listDeployments(scope, 3);
		const times = log.map((deployment) => Date.parse(deployment.deployedAt));

		expect(log).toHaveLength(3);
		expect(times).toEqual([...times].sort((a, b) => b - a));
	});

	test('states the kind and polarity of every rate, since neither is inferable', async () => {
		const rates = await source.readRates(scope);
		const byId = Object.fromEntries(rates.map((rate) => [rate.id, rate]));

		expect(byId['error-rate'].polarity).toBe('lower-is-better');
		expect(byId['request-rate'].polarity).toBe('higher-is-better');
		expect(byId['p95-latency'].kind).toBe('duration-ms');
		expect(rates.every((rate) => rate.samples.length > 1)).toBe(true);
	});

	test('identifies itself, so a page can never quietly be serving invented numbers', () => {
		expect(source.id).toBe('fixture');
		expect(new FixtureWorkspaceSource().id).toBe('fixture');
	});
});
