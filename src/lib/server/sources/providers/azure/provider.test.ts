import { describe, expect, test } from 'bun:test';
import { azureProvider } from './index';
import {
	clusterIsReady,
	costFrom,
	countNodes,
	powerStateOf,
	regionsOf,
	utilizationFrom,
	type ArmVirtualMachine,
	type CostRow
} from './map';
import { startCostMock } from './mock/cost';
import type { SourceContext } from '../../provider';
import { ownsResource } from '$lib/platform/ownership';

/**
 * The provider, against the emulator where one is running.
 *
 * The mapping tests need nothing booted; the estate tests skip without floci-az, the way
 * the store's tests skip without Docker.
 */

const scope = { environment: 'production' as const, timeRange: '1h' as const };

const context = (): SourceContext => ({
	scope,
	connection: {
		id: 'az',
		providerId: 'azure',
		kind: 'cloud',
		label: 'Azure',
		icon: 'cloud',
		settings: {}
	}
});

describe('mapping', () => {
	test('a power state is found by its prefix, not its position', () => {
		// Azure reports it inside an array that also carries the provisioning state.
		expect(
			powerStateOf({
				id: 'x',
				name: 'x',
				location: 'eastus',
				properties: {
					instanceView: {
						statuses: [{ code: 'ProvisioningState/succeeded' }, { code: 'PowerState/running' }]
					}
				}
			})
		).toBe('running');
	});

	test('a machine with no instance view is unknown, not down', () => {
		// Counting it as down would report an outage that may not exist.
		const machine = { id: 'x', name: 'x', location: 'eastus' };

		expect(powerStateOf(machine)).toBe('unknown');
		expect(countNodes([machine])).toEqual({ healthy: 0, warning: 1, down: 0 });
	});

	test('regions come from where resources are, not from a list of where they could be', () => {
		const at = (location: string, state: string) => ({
			id: location,
			name: location,
			location,
			properties: { instanceView: { statuses: [{ code: `PowerState/${state}` }] } }
		});

		const regions = regionsOf([
			at('eastus', 'running'),
			at('eastus', 'running'),
			at('westeurope', 'running')
		]);

		expect(regions.map((one) => one.id)).toEqual(['eastus', 'westeurope']);
		expect(regions[0].nodeCount).toBe(2);
	});

	test('a location with no coordinates is skipped, never placed at 0,0', () => {
		// world.ts asserts the open ocean is not land, and a region drawn in the Gulf of
		// Guinea is a visible lie about where an estate runs.
		const regions = regionsOf([
			{ id: 'a', name: 'a', location: 'marsnorth', properties: {} },
			{ id: 'b', name: 'b', location: 'eastus', properties: {} }
		]);

		expect(regions.map((one) => one.id)).toEqual(['eastus']);
	});

	test('spend groups by service and forecasts from the run rate', () => {
		const rows: CostRow[] = [
			[10, 20_260_901, 'Virtual Machines', 'USD'],
			[20, 20_260_902, 'Virtual Machines', 'USD'],
			[5, 20_260_901, 'Storage', 'USD']
		];

		const cost = costFrom(rows, new Date('2026-09-02T00:00:00Z'));

		expect(cost.categories.map((one) => one.label)).toEqual(['Virtual Machines', 'Storage']);
		expect(cost.total).toBe(35);
		// Two days at 17.5/day across a thirty-day month.
		expect(Math.round(cost.forecast)).toBe(525);
	});

	test('the month-over-month change is zero rather than invented', () => {
		// A month-to-date query cannot see last month, and a movement nobody measured is
		// worse than no movement.
		const cost = costFrom([[10, 20_260_901, 'x', 'USD']], new Date('2026-09-01T00:00:00Z'));

		expect(cost.changePct).toBe(0);
	});
});

describe('utilisation', () => {
	const window = {
		from: new Date('2026-09-15T10:00:00Z'),
		to: new Date('2026-09-15T10:02:00Z'),
		stepSeconds: 60
	};

	const machine = (cpu: number[], bytes: number[]) => [
		{
			name: 'Percentage CPU',
			points: cpu.map((value, i) => ({ at: new Date(window.from.getTime() + i * 60_000), value }))
		},
		{ name: 'Available Memory Bytes', points: [] },
		{
			name: 'Disk Read Bytes',
			points: bytes.map((value, i) => ({ at: new Date(window.from.getTime() + i * 60_000), value }))
		},
		{
			name: 'Network In Total',
			points: bytes.map((value, i) => ({ at: new Date(window.from.getTime() + i * 60_000), value }))
		}
	];

	test('averages across the machines sampled rather than summing them', () => {
		// A sum would make the CPU line rise every time somebody provisioned a VM, which
		// is a chart that reports a purchase as a load spike.
		const [cpu] = utilizationFrom([machine([20, 40], []), machine([40, 80], [])], window);

		expect(cpu.series.points.map((one) => one.value)).toEqual([30, 60]);
		expect(cpu.value).toBe(60);
	});

	test('a counter becomes a rate, and the network one becomes bits', () => {
		// Monitor reports Total *over the interval*. Left alone, a sixty-second bucket
		// would read sixty times the throughput it measured.
		const [, , disk, network] = utilizationFrom([machine([], [600, 600])], window);

		expect(disk.value).toBe(10);
		expect(disk.unit).toBe('B/s');
		expect(network.value).toBe(80);
		expect(network.unit).toBe('bps');
	});

	test('memory is reported as available bytes, the other way up', () => {
		// Azure publishes free bytes, not a used percentage — that needs the VM size's
		// total RAM, which is not a metric. So the reading says what was measured.
		const [, memory] = utilizationFrom([machine([], [])], window);

		expect(memory.unit).toBe('B');
		expect(memory.polarity).toBe('higher-is-better');
	});

	test('change is measured against the start of the window the caption claims', () => {
		const [cpu] = utilizationFrom([machine([50, 60], [])], window);

		expect(cpu.change).toBe(20);
		expect(cpu.direction).toBe('up');
	});

	test('a machine that reported nothing does not drag the average to zero', () => {
		const quiet = [{ name: 'Percentage CPU', points: [] }];
		const [cpu] = utilizationFrom([machine([40, 40], []), quiet], window);

		expect(cpu.series.points.map((one) => one.value)).toEqual([40, 40]);
	});

	test('a percentage is read against 100, not against its own peak', () => {
		// Scaling CPU to its peak makes 42% and 95% look identical.
		const [cpu, , disk] = utilizationFrom([machine([42, 44], [600, 600])], window);

		expect(cpu.axisMax).toBe(100);
		expect(disk.axisMax).toBeGreaterThan(disk.value);
	});
});

describe('clusters', () => {
	test('a cluster is judged on its pools, not on its control plane', () => {
		// floci-az leaves the cluster at "Creating" while it provisions containers, and a
		// real cluster mid-upgrade says the same. The pools are what run workloads.
		expect(
			clusterIsReady({
				id: 'x',
				name: 'x',
				location: 'eastus',
				properties: {
					provisioningState: 'Creating',
					agentPoolProfiles: [{ count: 3, provisioningState: 'Succeeded' }]
				}
			})
		).toBe(true);
	});
});

describe('what it declares', () => {
	test('seven capabilities, and the two it leaves out are not Monitor metrics', () => {
		// Queues are Service Bus, which floci-az will not provision through ARM at all;
		// alerts are Monitor's alerts API rather than its metrics one. Both render as
		// stated gaps, and the gap sweep proves the panels degrade rather than the page.
		expect([...azureProvider.capabilities].sort()).toEqual([
			'cloud.clusters',
			'cloud.cost',
			'cloud.databases',
			'cloud.nodes',
			'cloud.regions',
			'cloud.storage',
			'cloud.utilization'
		]);
	});

	test('the local credential issues the key the local mocks check for', async () => {
		// They check rather than ignore it, so a stub issuing something else 401s every
		// cost and metrics read — which is exactly what it did, silently, until measured.
		const cost = startCostMock();

		try {
			const client = azureProvider.connect({
				costBaseUrl: cost.url,
				subscriptionId: 'sub-1',
				tenantId: 't',
				clientId: 'c',
				clientSecret: 'local-dev-only'
			});

			const breakdown = await client.readCost!(context());
			expect(breakdown.categories.length).toBeGreaterThan(0);
		} finally {
			cost.stop();
		}
	});

	test('a deep link addresses a resource by its whole ARM id', () => {
		const client = azureProvider.connect({
			subscriptionId: 'sub-1',
			tenantId: 'tenant-1',
			clientId: 'c',
			clientSecret: 'local-dev-only'
		});

		const link = client.resourceLink(
			{
				kind: 'cloud',
				connectionId: 'az',
				externalId:
					'/subscriptions/sub-1/resourceGroups/g/providers/Microsoft.Compute/virtualMachines/vm1'
			},
			'metrics'
		);

		expect(link?.href).toContain('portal.azure.com');
		expect(link?.href).toContain('Microsoft.Compute');
		expect(link?.href).toContain('tenant-1');
	});
});

describe('owner filtering (pure)', () => {
	const vm = (
		name: string,
		location: string,
		tags?: Record<string, string>
	): ArmVirtualMachine => ({
		id: `/subscriptions/s/resourceGroups/g/providers/Microsoft.Compute/virtualMachines/${name}`,
		name,
		location,
		tags,
		properties: { instanceView: { statuses: [{ code: 'PowerState/running' }] } }
	});
	test("regionsOf over the owned subset lists only the owner's regions", () => {
		const machines = [
			vm('a', 'eastus', { domain: 'payment-domain' }),
			vm('b', 'westeurope'),
			vm('c', 'westus2', { Domain: 'payment-domain' })
		];
		const mine = machines.filter((m) => ownsResource(m.tags, 'domain', 'payment-domain'));
		expect(
			regionsOf(mine)
				.map((r) => r.id)
				.sort()
		).toEqual(['eastus', 'westus2']); // key case-insensitive
		expect(countNodes(mine)).toEqual({ healthy: 2, warning: 0, down: 0 });
	});
});

describe('no tag $filter is sent on ARM lists', () => {
	test('an owner read lists the whole type and filters here', async () => {
		const urls: string[] = [];
		const server = Bun.serve({
			port: 0,
			fetch: (req) => {
				urls.push(req.url);
				return Response.json({ value: [] });
			}
		});
		try {
			const client = azureProvider.connect({
				baseUrl: `http://localhost:${server.port}`,
				subscriptionId: 'sub',
				tenantId: 't',
				clientId: 'c',
				clientSecret: 'local-dev-only'
			});
			await client.listRegions!({
				...context(),
				binding: { kind: 'cloud', connectionId: 'az', externalId: 'payment-domain' }
			});
			expect(urls.length).toBeGreaterThan(0);
			for (const u of urls) expect(new URL(u).searchParams.has('$filter')).toBe(false);
		} finally {
			server.stop(true);
		}
	});
});

const emulator = await (async () => {
	try {
		const response = await fetch('http://localhost:4577/health', {
			signal: AbortSignal.timeout(1200)
		});
		return response.ok;
	} catch {
		return false;
	}
})();

if (!emulator) {
	console.warn('[azure] floci-az not running — estate tests skipped. `bun run db:up` starts it.');
}

describe.if(emulator)('against floci-az', () => {
	const client = azureProvider.connect({
		baseUrl: 'http://localhost:4577',
		costBaseUrl: 'http://localhost:4593',
		monitorBaseUrl: 'http://localhost:4594',
		subscriptionId: '00000000-0000-0000-0000-000000000001',
		tenantId: '00000000-0000-0000-0000-000000000002',
		clientId: 'local',
		clientSecret: 'local-dev-only'
	});

	test('counts the seeded estate', async () => {
		const counts = await client.readNodeCounts!(context());

		expect(counts.healthy + counts.warning + counts.down).toBeGreaterThan(0);
	});

	test('reports the regions it is actually running in', async () => {
		const regions = await client.listRegions!(context());

		expect(regions.length).toBeGreaterThanOrEqual(3);
		for (const region of regions) {
			expect(Number.isFinite(region.latitude)).toBe(true);
			expect(region.nodeCount).toBeGreaterThan(0);
		}
	});

	test('every Monitor-backed capability answers with the estate it reads', async () => {
		// The four that the Monitor mock unblocks, against the seeded estate rather than
		// against a hand-written response: a cluster's CPU, the machines' utilisation, the
		// storage accounts' bytes and the flexible servers' connections.
		const [clusters, resources, storage, databases] = await Promise.all([
			client.listClusters!(context(), 20),
			client.readUtilization!(context()),
			client.readStorage!(context()),
			client.listDatabases!(context(), 20)
		]);

		expect(clusters.length).toBeGreaterThan(0);
		for (const cluster of clusters) {
			// "Creating" control planes across the board would report every seeded cluster
			// degraded, which is the bug `clusterIsReady` exists to avoid.
			expect(cluster.status).toBe('healthy');
			expect(cluster.cpuPct).toBeGreaterThan(0);
		}

		expect(resources.map((one) => one.id)).toEqual(['cpu', 'memory', 'disk', 'network']);
		for (const resource of resources) {
			expect(Number.isFinite(resource.value)).toBe(true);
			expect(resource.series.points.length).toBeGreaterThan(0);
		}

		expect(storage.classes.length).toBeGreaterThan(0);
		expect(storage.totalBytes).toBe(storage.classes.reduce((sum, one) => sum + one.bytes, 0));

		expect(databases.length).toBeGreaterThan(0);
		for (const database of databases) {
			expect(database.engine).toContain('PostgreSQL');
			// A ratio whose numerator can exceed its denominator is a ratio nobody can read.
			expect(database.connections).toBeLessThanOrEqual(database.connectionLimit);
		}
	});

	test('the region node counts add up to the estate', async () => {
		const [regions, counts] = await Promise.all([
			client.listRegions!(context()),
			client.readNodeCounts!(context())
		]);

		const total = regions.reduce((sum, one) => sum + one.nodeCount, 0);
		expect(total).toBe(counts.healthy + counts.warning + counts.down);
	});

	const H = { authorization: 'Bearer local-dev-key', 'content-type': 'application/json' };
	const VM =
		'/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cc-eastus/providers/Microsoft.Compute/virtualMachines/cc-eastus-node-1';
	const patch = (tags: Record<string, string>) =>
		fetch(`http://localhost:4577${VM}?api-version=2023-03-01`, {
			method: 'PATCH',
			headers: H,
			body: JSON.stringify({ tags })
		});
	test("a tagged VM appears in its owner's regions and nowhere else", async () => {
		const before = (
			(await (
				await fetch(`http://localhost:4577${VM}?api-version=2023-03-01`, { headers: H })
			).json()) as { tags?: Record<string, string> }
		).tags;

		// A fresh connection, not the block's shared `client`: the estate window is
		// memoised for 30s per connection, and the tests above already warmed `client`'s
		// cache with the pre-patch, untagged estate. A fresh connection's cache starts
		// cold, so this exercises the real 30s-fresh path rather than the shared one the
		// suite's own ordering happened to make stale.
		const freshClient = azureProvider.connect({
			baseUrl: 'http://localhost:4577',
			costBaseUrl: 'http://localhost:4593',
			monitorBaseUrl: 'http://localhost:4594',
			subscriptionId: '00000000-0000-0000-0000-000000000001',
			tenantId: '00000000-0000-0000-0000-000000000002',
			clientId: 'local',
			clientSecret: 'local-dev-only'
		});

		await patch({ domain: 'zz-test-domain' });
		try {
			const mine = await freshClient.listRegions!({
				...context(),
				binding: { kind: 'cloud', connectionId: 'azure-local', externalId: 'zz-test-domain' }
			});
			expect(mine.map((r) => [r.id, r.nodeCount])).toEqual([['eastus', 1]]);
			const other = await freshClient.listRegions!({
				...context(),
				binding: { kind: 'cloud', connectionId: 'azure-local', externalId: 'zz-other' }
			});
			expect(other).toEqual([]);
		} finally {
			await patch(before ?? {});
		}
	});
});
