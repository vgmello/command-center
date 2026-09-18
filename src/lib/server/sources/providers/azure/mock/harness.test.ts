import { describe, expect, test } from 'bun:test';

/**
 * What floci-az actually does, pinned.
 *
 * The spec assumed it serves ARM, Monitor and Entra. Most of that held; two things did
 * not, and both change what the provider can be built against — so they are asserted here
 * rather than left in a comment for someone to rediscover against a real subscription.
 *
 * Skipped when the emulator is not running, the way the store's tests skip without Docker:
 * a checkout must stay runnable with no setup.
 */

const BASE = Bun.env.AZURE_BASE_URL ?? 'http://localhost:4577';
const SUBSCRIPTION = Bun.env.AZURE_SUBSCRIPTION_ID ?? '00000000-0000-0000-0000-000000000001';
const scope = `${BASE}/subscriptions/${SUBSCRIPTION}`;

async function reachable(): Promise<boolean> {
	try {
		const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
		return response.ok;
	} catch {
		return false;
	}
}

const available = await reachable();
const describeAzure = available ? describe : describe.skip;

if (!available) {
	console.warn('[floci-az] not running — harness assertions skipped. `bun run db:up` starts it.');
}

async function list(path: string, apiVersion: string): Promise<{ value: unknown[] }> {
	const response = await fetch(`${scope}${path}?api-version=${apiVersion}`);
	return response.json() as Promise<{ value: unknown[] }>;
}

describeAzure('the local Azure', () => {
	test('serves ARM, which is what the provider is built against', async () => {
		const groups = await list('/resourcegroups', '2021-04-01');

		// Seeded by `bun run seed:azure`. The emulator starts empty, so a run against an
		// unseeded one draws a blank estate — correct, and a test of nothing.
		expect(groups.value.length).toBeGreaterThan(0);
	});

	test('does not serve /locations, so regions come from the resources themselves', async () => {
		// The plan assumed listing subscription locations. It 404s, so `cloud.regions` has
		// to be derived from the distinct `location` of the resources that exist — which is
		// arguably better anyway: it reports where the estate *is*, not where it could be.
		const response = await fetch(`${scope}/locations?api-version=2020-01-01`);

		expect(response.status).toBe(404);
	});

	test('the seeded estate spans several locations, so the map has points to draw', async () => {
		const machines = await list('/providers/Microsoft.Compute/virtualMachines', '2023-03-01');
		const locations = new Set(machines.value.map((one) => (one as { location: string }).location));

		expect(locations.size).toBeGreaterThanOrEqual(3);
	});

	test('validates per resource type rather than storing whatever it is handed', async () => {
		// Worth knowing, and the reason the seed carries an administratorLogin: a body that
		// passes here has a real chance of passing against ARM, which makes the harness
		// worth more than a store that accepts anything.
		const response = await fetch(
			`${scope}/resourceGroups/cc-westeurope/providers/Microsoft.DBforPostgreSQL/flexibleServers/cc-invalid?api-version=2023-03-01-preview`,
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ location: 'westeurope', properties: { version: '16' } })
			}
		);

		expect(response.status).toBe(400);
	});

	test('refuses to provision Service Bus, so queues have no local backing', async () => {
		// Not a version mismatch — every version tried 404s, while unrelated types like
		// Microsoft.Cache/redis create fine. So messaging is special-cased, and
		// `cloud.queues` is a stated gap locally rather than something to fake.
		const response = await fetch(
			`${scope}/resourceGroups/cc-westeurope/providers/Microsoft.ServiceBus/namespaces/probe?api-version=2021-11-01`,
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ location: 'westeurope', sku: { name: 'Standard' } })
			}
		);

		expect(response.status).toBe(404);
	});
});
