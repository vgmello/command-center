import { describe, expect, test } from 'bun:test';
import { createInfrastructureRouter } from './infrastructure';
import { createDispatcher } from '../dispatch';
import { SourceCache } from '../cache';
import { SourceRegistry } from '../registry';
import { CapabilityUnavailableError } from '../errors';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import { FixtureCatalogSource } from '../../catalog/fixture-source';
import type { PlatformScope } from '$lib/platform/query';
import type { NodeCounts } from '$lib/platform/types';
import type { SourceContext } from '../provider';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function build(connections: unknown = FIXTURE_CONNECTIONS) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);
	registry.load(connections, {});

	return {
		registry,
		source: createInfrastructureRouter(
			{
				registry,
				dispatcher: createDispatcher(registry),
				cache: new SourceCache()
			},
			new FixtureCatalogSource()
		)
	};
}

describe('the infrastructure router', () => {
	test('serves every source-backed method from the connected cloud source', async () => {
		const { source } = build();

		expect((await source.listRegions(scope)).length).toBeGreaterThan(0);
		expect((await source.readNodeCounts(scope)).healthy).toBeGreaterThan(0);
		expect(await source.listClusters(scope, 3)).toHaveLength(3);
		expect(await source.readUtilization(scope)).toHaveLength(4);
		expect((await source.readStorage(scope)).totalBytes).toBeGreaterThan(0);
		expect(await source.listDatabases(scope, 2)).toHaveLength(2);
		expect(await source.listQueues(scope, 2)).toHaveLength(2);
		expect(await source.listAlerts(scope, 2)).toHaveLength(2);
		expect((await source.readCost(scope)).categories.length).toBeGreaterThan(0);
	});

	test('listGroups is composed from other capabilities rather than dispatched', async () => {
		const groups = await build().source.listGroups(scope);

		expect(groups.map((one) => one.id).sort()).toEqual([
			'clusters',
			'databases',
			'nodes',
			'queues'
		]);
	});

	test('the node group counts exactly what readNodeCounts counts', async () => {
		const { source } = build();
		const counts = await source.readNodeCounts(scope);
		const groups = await source.listGroups(scope);

		expect(groups.find((one) => one.id === 'nodes')?.count).toBe(
			counts.healthy + counts.warning + counts.down
		);
	});

	test('with no cloud connection every method is unavailable rather than empty', async () => {
		const { source } = build({ connections: [] });

		await expect(source.listRegions(scope)).rejects.toThrow(CapabilityUnavailableError);
		await expect(source.readCost(scope)).rejects.toThrow(CapabilityUnavailableError);
	});

	test('repeated reads inside the TTL reach the provider once', async () => {
		const { registry, source } = build();
		const client = registry.connection('fixture-cloud')!.client as {
			listRegions: (ctx: SourceContext) => Promise<unknown[]>;
		};
		let calls = 0;
		const original = client.listRegions.bind(client);
		client.listRegions = async (ctx) => {
			calls++;
			return original(ctx);
		};

		await source.listRegions(scope);
		await source.listRegions(scope);
		expect(calls).toBe(1);
	});

	test('different limits are cached separately', async () => {
		const { source } = build();

		expect(await source.listClusters(scope, 2)).toHaveLength(2);
		expect(await source.listClusters(scope, 4)).toHaveLength(4);
	});

	test('different environments are cached separately', async () => {
		const { registry, source } = build();
		const client = registry.connection('fixture-cloud')!.client as {
			readNodeCounts: (ctx: SourceContext) => Promise<NodeCounts>;
		};
		let calls = 0;
		const original = client.readNodeCounts.bind(client);
		client.readNodeCounts = async (ctx) => {
			calls++;
			return { ...(await original(ctx)), healthy: calls };
		};

		const production = await source.readNodeCounts({ environment: 'production', timeRange: '15m' });
		const staging = await source.readNodeCounts({ environment: 'staging', timeRange: '15m' });

		expect(calls).toBe(2);
		expect(production).not.toEqual(staging);
	});

	test('different time ranges are cached separately', async () => {
		const { registry, source } = build();
		const client = registry.connection('fixture-cloud')!.client as {
			readNodeCounts: (ctx: SourceContext) => Promise<NodeCounts>;
		};
		let calls = 0;
		const original = client.readNodeCounts.bind(client);
		client.readNodeCounts = async (ctx) => {
			calls++;
			return { ...(await original(ctx)), healthy: calls };
		};

		const fifteenMinutes = await source.readNodeCounts({
			environment: 'production',
			timeRange: '15m'
		});
		const twentyFourHours = await source.readNodeCounts({
			environment: 'production',
			timeRange: '24h'
		});

		expect(calls).toBe(2);
		expect(fifteenMinutes).not.toEqual(twentyFourHours);
	});
});

describe('owner-scoped reads', () => {
	test('a bound domain gets exactly its own resources', async () => {
		const { source } = build();
		expect((await source.listRegions(scope, 'payment-domain')).map((r) => r.id)).toEqual([
			'eu-west-1'
		]);
		expect(
			(await source.listClusters(scope, 100, 'payment-domain')).map((c) => c.id).sort()
		).toEqual(['prod-eu-west-1-a', 'prod-eu-west-1-b']);
	});
	test('a domain with NO declared cloud binding is no-binding — the bindingFor fallback must not count', async () => {
		const { source } = build();
		await expect(source.readNodeCounts(scope, 'tax-domain')).rejects.toMatchObject({
			reason: 'no-binding'
		});
	});
	test('an unknown slug is no-binding too', async () => {
		const { source } = build();
		await expect(source.listRegions(scope, 'no-such-domain')).rejects.toMatchObject({
			reason: 'no-binding'
		});
	});
	test('the estate path is untouched', async () => {
		const { source } = build();
		expect((await source.listRegions(scope)).map((r) => r.id)).toHaveLength(5);
	});
	test('owner-scoped queues and alerts are refused, not silently unfiltered', async () => {
		const { source } = build();

		await expect(source.listAlerts(scope, 10, 'payment-domain')).rejects.toMatchObject({
			reason: 'not-implemented'
		});
		await expect(source.listQueues(scope, 10, 'payment-domain')).rejects.toMatchObject({
			reason: 'not-implemented'
		});

		// The estate path (no owner) still works for both.
		expect(await source.listQueues(scope, 2)).toHaveLength(2);
		expect(await source.listAlerts(scope, 2)).toHaveLength(2);
	});
});
