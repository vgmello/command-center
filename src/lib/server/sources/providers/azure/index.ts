import * as v from 'valibot';
import { ClientSecretCredential, type TokenCredential } from '@azure/identity';
import { defineProvider } from '../../provider';
import type { CloudProvider } from '../../contracts';
import type { LinkView, SourceBinding } from '../../provider';
import { AzureClient } from './client';
import { costFrom, countNodes, regionsOf, type ArmVirtualMachine, type CostRow } from './map';

/**
 * Microsoft Azure, through ARM.
 *
 * **It declares three capabilities, not nine, and that is the finding rather than a
 * shortcut.** Almost everything the infrastructure screen asks for is a *utilisation*
 * reading — a cluster's CPU, a database's connections, a storage account's bytes, a
 * queue's depth — and none of that is in ARM. It is in Azure Monitor, which floci-az does
 * not emulate: a metrics request against it returns "Unsupported Microsoft.Compute path".
 *
 * So the three below are what can be answered honestly from resource metadata alone, plus
 * spend from Cost Management. The rest are left undeclared, which makes them stated gaps
 * the panels render as "no connected cloud source provides this" — the alternative is a
 * provider that reports a CPU percentage nobody measured, which is the exact failure the
 * throw-on-unknown-capability rule exists to prevent.
 *
 * Unblocking the other six means a Monitor mock, the way Cost Management already has one.
 */
export const azureSettings = v.object({
	/** ARM's root. Omit for real Azure; set it to reach floci-az. */
	baseUrl: v.optional(
		v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
		'https://management.azure.com'
	),
	/**
	 * Cost Management's root.
	 *
	 * ARM in production; our own mock locally, because floci-az does not emulate it.
	 */
	costBaseUrl: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(2048))),
	subscriptionId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	tenantId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	clientId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	clientSecret: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
	/** How many machines to read when counting an estate. */
	nodeLimit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(10_000)), 2_000)
});

export type AzureSettings = v.InferOutput<typeof azureSettings>;

const VM_API = '2023-03-01';

/**
 * A credential that works against an emulator as well as against Azure.
 *
 * floci-az serves an Entra token endpoint, so `ClientSecretCredential` authenticates
 * against it for real. It is only swapped for a stub when the secret is the literal
 * placeholder a local connections file carries, because asking a local emulator for a
 * genuine client-credentials grant it has no tenant for fails in a way that reads like a
 * misconfiguration rather than a local run.
 */
function credentialFor(settings: AzureSettings): TokenCredential {
	if (settings.clientSecret === 'local-dev-only') {
		return {
			getToken: async () => ({ token: 'local', expiresOnTimestamp: Date.now() + 3_600_000 })
		};
	}

	return new ClientSecretCredential(settings.tenantId, settings.clientId, settings.clientSecret);
}

export const azureProvider = defineProvider<CloudProvider>({
	id: 'azure',
	kind: 'cloud',
	name: 'Microsoft Azure',
	icon: 'cloud',
	// Three, deliberately. See the note above: the other six are Monitor readings, and a
	// provider that invented them would be worse than one that says it cannot.
	capabilities: ['cloud.regions', 'cloud.nodes', 'cloud.cost'],
	settings: azureSettings,
	connect: (raw) => {
		// Parsed, not cast — a cast leaves the schema's defaults unapplied for any caller
		// that is not `loadConnections`.
		const settings: AzureSettings = v.parse(azureSettings, raw);

		const client = new AzureClient({
			baseUrl: settings.baseUrl,
			costBaseUrl: settings.costBaseUrl ?? settings.baseUrl,
			subscriptionId: settings.subscriptionId,
			credential: credentialFor(settings)
		});

		/**
		 * Every virtual machine in the subscription, fetched once per read.
		 *
		 * Both capabilities that use it want the whole estate — one counts power states and
		 * the other groups by location — so a shared window is memoised for a few seconds
		 * the way the Octopus provider's is, rather than paging the estate twice a page.
		 */
		let machines: { at: number; rows: Promise<ArmVirtualMachine[]> } | null = null;

		function loadMachines(): Promise<ArmVirtualMachine[]> {
			const now = Date.now();

			if (!machines || now - machines.at > 30_000) {
				machines = {
					at: now,
					rows: client.collect<ArmVirtualMachine>(
						`${client.scopePath}/providers/Microsoft.Compute/virtualMachines`,
						{ limit: settings.nodeLimit, params: { 'api-version': VM_API } }
					)
				};
			}

			return machines.rows;
		}

		return {
			async listRegions() {
				return regionsOf(await loadMachines());
			},

			async readNodeCounts() {
				return countNodes(await loadMachines());
			},

			async readCost() {
				const body = await client.queryCost<{
					properties: { rows: CostRow[] };
				}>({
					type: 'Usage',
					timeframe: 'MonthToDate',
					dataset: {
						granularity: 'Daily',
						aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
						grouping: [{ type: 'Dimension', name: 'ServiceName' }]
					}
				});

				return costFrom(body.properties?.rows ?? [], new Date());
			},

			resourceLink(binding: SourceBinding | undefined, view: LinkView) {
				if (!binding) return null;

				// The portal addresses a resource by its full ARM id, so the id travels whole
				// rather than being rebuilt from its parts.
				const blade =
					view === 'metrics' ? 'metrics' : view === 'cost' ? 'costanalysis' : 'overview';

				return {
					label: 'Show in Azure',
					href: client.portalLink(settings.tenantId, binding.externalId, blade)
				};
			}
		};
	}
});
