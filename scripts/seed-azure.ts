/**
 * Provision an estate into floci-az.
 *
 * The emulator starts empty. Without this, an end-to-end run against it reads a
 * subscription with no resource groups and draws a blank infrastructure page — which is
 * technically correct and tests nothing.
 *
 * ARM PUTs are idempotent, so this is safe to re-run; it is how you reset after poking at
 * the emulator by hand. Deterministic throughout, for the reason every fixture here is:
 * an estate that changed on each seed could not be asserted against.
 *
 *   bun run db:up          # starts floci-az alongside Postgres
 *   bun run seed:azure
 *
 * Regions mirror the fixture estate's shape rather than its names — these are real Azure
 * locations, because the provider maps a location name to coordinates and a made-up one
 * has nowhere to be drawn.
 */

import { OWNER_TAG_KEY, seedOwnerOf } from '../src/lib/platform/ownership';

const baseUrl = Bun.env.AZURE_BASE_URL ?? 'http://localhost:4577';
const subscriptionId = Bun.env.AZURE_SUBSCRIPTION_ID ?? '00000000-0000-0000-0000-000000000001';

/** `[location, resource group, healthy nodes, warning nodes, down nodes]`. */
const REGIONS: Array<[string, string, number, number, number]> = [
	['westeurope', 'cc-westeurope', 11, 1, 0],
	['northeurope', 'cc-northeurope', 10, 0, 0],
	['eastus', 'cc-eastus', 12, 1, 1],
	['westus2', 'cc-westus2', 8, 0, 0],
	['southeastasia', 'cc-southeastasia', 3, 1, 0]
];

const scope = `${baseUrl}/subscriptions/${subscriptionId}`;

async function put(path: string, body: unknown, apiVersion: string): Promise<void> {
	const response = await fetch(`${scope}${path}?api-version=${apiVersion}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

	// A failed PUT leaves a hole in the estate that only shows up as a missing panel much
	// later, so it stops the seed rather than being logged and skipped.
	if (!response.ok) {
		throw new Error(`PUT ${path} → ${response.status} ${await response.text()}`);
	}
}

/** A VM's power state is what `cloud.nodes` counts, so it is what the seed varies. */
function vmBody(location: string, state: 'running' | 'degraded' | 'stopped') {
	return {
		location,
		properties: {
			hardwareProfile: { vmSize: 'Standard_D4s_v3' },
			provisioningState: state === 'stopped' ? 'Failed' : 'Succeeded',
			// floci-az stores what it is given, so the instance view travels with the
			// resource rather than needing a second call to set it.
			instanceView: {
				statuses: [
					{ code: 'ProvisioningState/succeeded', level: 'Info' },
					{
						code: state === 'running' ? 'PowerState/running' : `PowerState/${state}`,
						level: state === 'running' ? 'Info' : 'Warning'
					}
				]
			}
		}
	};
}

/** The seed's half of "ownership by tag": every resource carries the domain that owns it. */
function tagged<T extends object>(body: T, ownerOf: string): T & { tags?: Record<string, string> } {
	const owner = seedOwnerOf(ownerOf);
	return owner ? { ...body, tags: { [OWNER_TAG_KEY]: owner } } : body;
}

let created = 0;

for (const [location, group, healthy, warning, down] of REGIONS) {
	await put(`/resourcegroups/${group}`, tagged({ location }, group), '2021-04-01');
	created++;

	const nodes: Array<'running' | 'degraded' | 'stopped'> = [
		...Array<'running'>(healthy).fill('running'),
		...Array<'degraded'>(warning).fill('degraded'),
		...Array<'stopped'>(down).fill('stopped')
	];

	for (const [index, state] of nodes.entries()) {
		await put(
			`/resourceGroups/${group}/providers/Microsoft.Compute/virtualMachines/${group}-node-${index + 1}`,
			tagged(vmBody(location, state), group),
			'2023-03-01'
		);
		created++;
	}

	// One cluster per region, so the compute panel has rows in every location the map draws.
	await put(
		`/resourceGroups/${group}/providers/Microsoft.ContainerService/managedClusters/${group}-aks`,
		tagged(
			{
				location,
				properties: {
					provisioningState: 'Succeeded',
					agentPoolProfiles: [
						{ name: 'system', count: healthy + warning, vmSize: 'Standard_D4s_v3' }
					]
				}
			},
			group
		),
		'2023-10-01'
	);
	created++;

	// `ccst` prefix and no dashes: storage account names are lowercase alphanumeric only,
	// and a name the real API would reject is not worth seeding into a stand-in for it.
	await put(
		`/resourceGroups/${group}/providers/Microsoft.Storage/storageAccounts/ccst${location.slice(0, 12)}`,
		// Tagged by its group: the truncated account name is deliberately not in the
		// ownership table, so the region's owner is the storage account's too. floci-az
		// drops `tags` on this one type — PUT and PATCH both come back without them, while
		// every other type keeps them — so locally `owned()` finds no account and a domain's
		// storage cell reads 0 B (a measurement, not a gap) rather than the real figure.
		// Real ARM stores them; the seed is written for real ARM.
		tagged({ location, sku: { name: 'Standard_LRS' }, kind: 'StorageV2' }, group),
		'2023-01-01'
	);
	created++;
}

// Databases and queues live in one region rather than all five: a real estate does not
// replicate its primaries everywhere, and a panel that lists five identical rows tells a
// reader less than one that lists the four that exist.
for (const [name, engine] of [
	['payments', 'PostgreSQL'],
	['orders', 'PostgreSQL'],
	['users', 'PostgreSQL'],
	['inventory', 'PostgreSQL']
]) {
	await put(
		`/resourceGroups/cc-westeurope/providers/Microsoft.DBforPostgreSQL/flexibleServers/cc-${name}`,
		// By name, not by group: the databases share one region and override its owner.
		tagged(
			{
				location: 'westeurope',
				sku: { name: 'Standard_D4s_v3', tier: 'GeneralPurpose' },
				properties: {
					version: '16',
					// Required by the emulator, which validates per resource type rather than
					// storing whatever it is handed — worth knowing, since it means a seed that
					// passes here would very likely pass against real ARM.
					administratorLogin: 'ccadmin',
					administratorLoginPassword: 'local-dev-only',
					storage: { storageSizeGB: 512 },
					state: 'Ready',
					engine
				}
			},
			`cc-${name}`
		),
		'2023-03-01-preview'
	);
	created++;
}

/**
 * Queues are deliberately absent.
 *
 * floci-az refuses a PUT to `Microsoft.ServiceBus/namespaces` on every API version tried,
 * while accepting arbitrary types like `Microsoft.Cache/redis` — so messaging is
 * special-cased rather than merely unimplemented, and cannot be seeded through ARM.
 *
 * That makes `cloud.queues` the second surface with no local backing, after Cost
 * Management. It is left as a stated gap rather than faked: the capability sweep already
 * proves a partial cloud provider costs the reader that panel and not the page, and a
 * seeded queue that no real adapter could read would be worse than an honest blank.
 */

console.log(`Seeded ${created} resources into ${scope}`);
console.log(`Regions: ${REGIONS.map(([location]) => location).join(', ')}`);

export {};
