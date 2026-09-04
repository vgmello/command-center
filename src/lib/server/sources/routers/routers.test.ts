import { describe, expect, test } from 'bun:test';
import { FixtureCatalogSource } from '../../catalog/fixture-source';
import { createRouters } from './index';
import { createDispatcher } from '../dispatch';
import { SourceCache } from '../cache';
import { SourceRegistry } from '../registry';
import { CapabilityUnavailableError } from '../errors';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import { FixturePlatformSource } from '../../platform/fixture-source';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function build(connections: unknown = FIXTURE_CONNECTIONS) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);
	registry.load(connections, {});

	return createRouters(
		{
			registry,
			dispatcher: createDispatcher(registry),
			cache: new SourceCache()
		},
		{
			platform: new FixturePlatformSource(),
			services: new FixtureCatalogSource()
		}
	);
}

describe('the platform router', () => {
	test('serves catalog methods locally, with no source connected at all', async () => {
		const { platform } = build({ connections: [] });

		// The domain catalog is app-owned: it must not depend on an APM connection.
		expect(
			(
				await platform.queryDomains(scope, {
					search: '',
					status: 'all',
					owner: 'all',
					sort: 'health-score',
					page: 1,
					pageSize: 5
				})
			).domains
		).toHaveLength(5);
		expect(await platform.findDomain(scope, 'payment-domain')).not.toBeNull();

		// Declared, but nothing is watching them — so every domain is `unknown` rather
		// than healthy. Those are different statements, and reporting the second would be
		// the catalog claiming a health it has no way to know.
		const counts = await platform.readDomainStatusCounts(scope);
		expect(counts.healthy).toBe(0);
		expect(counts.unknown).toBeGreaterThan(0);
	});

	test('with an APM source connected, the domains are actually scored', async () => {
		const { platform } = build();
		const counts = await platform.readDomainStatusCounts(scope);

		expect(counts.healthy + counts.degraded + counts.down).toBeGreaterThan(0);
	});

	test('dispatches the APM-backed methods', async () => {
		const { platform } = build();

		expect(await platform.readRates(scope)).toHaveLength(3);
		expect(await platform.listIncidents(scope, 2)).toHaveLength(2);
		expect((await platform.readActivitySummary(scope)).activeIncidents).toBeGreaterThan(0);
		expect(await platform.readDomainVitals(scope, 'payment-domain')).not.toBeNull();
	});

	test('without an APM connection the APM-backed methods are unavailable', async () => {
		const { platform } = build({ connections: [] });

		await expect(platform.readRates(scope)).rejects.toThrow(CapabilityUnavailableError);
		await expect(platform.listIncidents(scope, 2)).rejects.toThrow(CapabilityUnavailableError);
	});
});

describe('the service router', () => {
	test('serves the catalog locally and the readings from APM', async () => {
		const { service } = build();

		expect((await service.listServices(scope)).length).toBeGreaterThan(0);
		expect(await service.findService(scope, 'payment-api')).not.toBeNull();
		expect((await service.readStats(scope, 'payment-api')).length).toBeGreaterThan(0);
		expect((await service.readSloBudget(scope, 'payment-api')).targetPct).toBe(99.9);
	});

	test('listServiceVitals returns the services the catalog declares, and no others', async () => {
		// It used to generate rows to reach a count the domain claimed separately, which
		// is how a header said 24 over a table listing 2. The count is the catalog's now,
		// so the two cannot disagree — and a domain with two declared services has two
		// rows, however many it once claimed.
		const { service } = build({ connections: [] });
		const catalog = new FixtureCatalogSource();
		const platform = new FixturePlatformSource();
		const vitals = (await platform.readDomainVitals(scope, 'payment-domain'))!;

		const declared = await catalog.listServices('payment-domain');
		const rows = await service.listServiceVitals(scope, 'payment-domain', vitals, declared.length);

		expect(rows).toHaveLength(declared.length);
		expect(rows.map((one) => one.slug)).toEqual(declared.map((one) => one.slug));
	});
});

describe('the deployment router', () => {
	test('dispatches every method', async () => {
		const { deployment } = build();

		expect(await deployment.listDeployments(scope, 3)).toHaveLength(3);
		expect((await deployment.readSummary(scope)).total).toBeGreaterThan(0);
		expect(await deployment.readStatusTrend(scope)).toHaveLength(3);
		expect((await deployment.readTrends(scope, 'daily')).frequency.points.length).toBeGreaterThan(
			0
		);
		expect((await deployment.listInsights(scope)).length).toBeGreaterThan(0);
		expect((await deployment.listDeployingDomains(scope)).length).toBeGreaterThan(0);
		expect((await deployment.readDomainBreakdown(scope)).total).toBeGreaterThan(0);
	});

	test('a filtered query still reaches the source and narrows', async () => {
		const { deployment } = build();
		const page = await deployment.queryDeployments(scope, {
			search: '',
			state: 'failed',
			domain: 'all',
			service: 'all',
			environment: 'all',
			window: 'any',
			page: 1,
			pageSize: 50
		});

		expect(page.deployments.every((one) => one.status === 'failed')).toBe(true);
	});

	test('without a deployment connection every method is unavailable', async () => {
		const { deployment } = build({ connections: [] });

		await expect(deployment.readSummary(scope)).rejects.toThrow(CapabilityUnavailableError);
	});
});
