import { describe, expect, test } from 'bun:test';
import { azureProvider } from './index';
import { costFrom, countNodes, powerStateOf, regionsOf, type CostRow } from './map';
import type { SourceContext } from '../../provider';

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

describe('what it declares', () => {
	test('three capabilities, because the rest are Monitor readings', () => {
		// floci-az answers "Unsupported Microsoft.Compute path" for a metrics request, and a
		// provider that invented a CPU percentage would be worse than one that says it
		// cannot. The gap sweep already proves the panels degrade rather than the page.
		expect([...azureProvider.capabilities].sort()).toEqual([
			'cloud.cost',
			'cloud.nodes',
			'cloud.regions'
		]);
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

	test('the region node counts add up to the estate', async () => {
		const [regions, counts] = await Promise.all([
			client.listRegions!(context()),
			client.readNodeCounts!(context())
		]);

		const total = regions.reduce((sum, one) => sum + one.nodeCount, 0);
		expect(total).toBe(counts.healthy + counts.warning + counts.down);
	});
});
