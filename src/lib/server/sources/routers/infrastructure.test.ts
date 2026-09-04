import { describe, expect, test } from 'bun:test';
import { createInfrastructureRouter } from './infrastructure';
import { createDispatcher } from '../dispatch';
import { SourceCache } from '../cache';
import { SourceRegistry } from '../registry';
import { CapabilityUnavailableError } from '../errors';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function build(connections: unknown = FIXTURE_CONNECTIONS) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);
	registry.load(connections, {});

	return {
		registry,
		source: createInfrastructureRouter({
			registry,
			dispatcher: createDispatcher(registry),
			cache: new SourceCache()
		})
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

		expect(source.listRegions(scope)).rejects.toThrow(CapabilityUnavailableError);
		expect(source.readCost(scope)).rejects.toThrow(CapabilityUnavailableError);
	});

	test('repeated reads inside the TTL reach the provider once', async () => {
		const { registry, source } = build();
		const client = registry.connection('fixture-cloud')!.client as {
			listRegions: () => Promise<unknown[]>;
		};
		let calls = 0;
		const original = client.listRegions.bind(client);
		client.listRegions = async () => {
			calls++;
			return original();
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
});
