import { describe, expect, test } from 'bun:test';
import { createRouters } from './index';
import { createDispatcher } from '../dispatch';
import { SourceCache } from '../cache';
import { SourceRegistry } from '../registry';
import { CapabilityUnavailableError } from '../errors';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import { FixturePlatformSource, FixtureServiceSource } from '../../platform/fixture-source';
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
			service: new FixtureServiceSource()
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
		expect((await platform.readDomainStatusCounts(scope)).healthy).toBeGreaterThan(0);
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

		expect(platform.readRates(scope)).rejects.toThrow(CapabilityUnavailableError);
		expect(platform.listIncidents(scope, 2)).rejects.toThrow(CapabilityUnavailableError);
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

	test('listServiceVitals stays on the catalog in this increment', async () => {
		// Recorded as a decision: the fixture catalog already produces the readings, and
		// the APM half of this join arrives with the real Coralogix provider.
		const { service } = build({ connections: [] });
		const platform = new FixturePlatformSource();
		const domain = (await platform.findDomain(scope, 'payment-domain'))!;
		const vitals = (await platform.readDomainVitals(scope, 'payment-domain'))!;

		const rows = await service.listServiceVitals(scope, domain.id, vitals, domain.serviceCount);
		expect(rows).toHaveLength(domain.serviceCount);
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

		expect(deployment.readSummary(scope)).rejects.toThrow(CapabilityUnavailableError);
	});
});
