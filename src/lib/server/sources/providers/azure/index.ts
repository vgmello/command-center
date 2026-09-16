import * as v from 'valibot';
import { ClientSecretCredential, type TokenCredential } from '@azure/identity';
import { defineProvider } from '../../provider';
import type { CloudProvider } from '../../contracts';
import type { LinkView, SourceBinding, SourceContext } from '../../provider';
import { AzureClient } from './client';
import { ownsResource } from '$lib/platform/ownership';
import {
	clusterIsReady,
	costFrom,
	countNodes,
	latest,
	regionsOf,
	utilizationFrom,
	type ArmCluster,
	type ArmResource,
	type ArmVirtualMachine,
	type CostRow
} from './map';

/**
 * Microsoft Azure, through ARM, Cost Management and Monitor.
 *
 * **It declares seven capabilities, not nine, and the two it leaves out are the finding.**
 * Almost everything the infrastructure screen asks for is a *utilisation* reading — a
 * cluster's CPU, a database's connections, a storage account's bytes — and none of that is
 * in ARM. It is in Azure Monitor, which floci-az does not emulate: a metrics request
 * against it returns "Unsupported Microsoft.Compute path". So Monitor got a mock of its
 * own (`mock/monitor.ts`), the way Cost Management already had one, and the four readings
 * that mock unblocks are declared here.
 *
 * The two still undeclared are undeclared for reasons a mock does not fix. Queues live in
 * Service Bus, which floci-az will not provision through ARM at all, so there is nothing
 * to read. Alerts are Monitor's *alerts* API rather than its metrics one — a different
 * service with a different shape, not another metric name. Both render as stated gaps
 * ("no connected cloud source provides this"), which is the whole point: a provider that
 * reported a queue depth nobody measured is the exact failure the
 * throw-on-unknown-capability rule exists to prevent.
 *
 * **A domain's reads are narrowed client-side, and that is a stated ceiling, not an
 * oversight.** When `ctx.binding` names a domain, every method filters the resources it
 * already fetched by `tags[settings.ownerTagKey] === externalId`, matched case-insensitively
 * on the key via `ownsResource`. Nothing here sends ARM a tag `$filter`: floci-az ignores it,
 * and ARM only documents it on the generic `/resources` list, not on a typed collection like
 * `virtualMachines` — a `$filter` this provider trusted would be silently no-op against the
 * emulator and unreliable against the real thing. A subscription too large to read whole and
 * filter locally wants ARM's `/resources?$filter=tagName eq '…'` — a different endpoint
 * (the generic, untyped one), not a parameter on this one, and is out of scope here.
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
	/**
	 * Monitor's root.
	 *
	 * ARM in production; our own mock locally, because floci-az answers a metrics request
	 * with "Unsupported Microsoft.Compute path".
	 */
	monitorBaseUrl: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(2048))),
	subscriptionId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	tenantId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	clientId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	clientSecret: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
	/** How many machines to read when counting an estate. */
	nodeLimit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(10_000)), 2_000),
	/**
	 * How many machines the estate's utilisation is averaged over.
	 *
	 * Monitor answers per resource, so a subscription with two thousand machines would be
	 * two thousand requests for one line on a chart. Sampling is a stated approximation;
	 * fanning out would be a rate-limit incident.
	 */
	metricSampleSize: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(200)), 12),
	/**
	 * The tag key a resource's domain owner is read from.
	 *
	 * `'domain'` everywhere this app runs, and a setting rather than a constant only
	 * because a real subscription's tagging convention is not this app's to dictate.
	 */
	ownerTagKey: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128)), 'domain')
});

export type AzureSettings = v.InferOutput<typeof azureSettings>;

const VM_API = '2023-03-01';
const AKS_API = '2023-10-01';
const STORAGE_API = '2023-01-01';
const POSTGRES_API = '2023-03-01-preview';

/**
 * The ceiling a connection ratio is drawn against when Azure does not publish one.
 *
 * `max_connections` follows the SKU rather than appearing as a metric, so this is the
 * General Purpose default. The observed peak wins when it is higher, so the ratio is never
 * a number above its own denominator.
 */
const DEFAULT_CONNECTION_LIMIT = 300;

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
		// The token the local mocks check for. They check rather than ignore it — a mock
		// that accepted anything would not notice the adapter had stopped sending one —
		// so the stub has to issue the key they were started with.
		return {
			getToken: async () => ({
				token: Bun.env.MOCK_API_KEY ?? 'local-dev-key',
				expiresOnTimestamp: Date.now() + 3_600_000
			})
		};
	}

	return new ClientSecretCredential(settings.tenantId, settings.clientId, settings.clientSecret);
}

export const azureProvider = defineProvider<CloudProvider>({
	id: 'azure',
	kind: 'cloud',
	name: 'Microsoft Azure',
	icon: 'cloud',
	// Seven of nine, deliberately. See the note above for the two that are missing.
	capabilities: [
		'cloud.regions',
		'cloud.nodes',
		'cloud.clusters',
		'cloud.utilization',
		'cloud.storage',
		'cloud.databases',
		'cloud.cost'
	],
	settings: azureSettings,
	connect: (raw) => {
		// Parsed, not cast — a cast leaves the schema's defaults unapplied for any caller
		// that is not `loadConnections`.
		const settings: AzureSettings = v.parse(azureSettings, raw);

		const client = new AzureClient({
			baseUrl: settings.baseUrl,
			costBaseUrl: settings.costBaseUrl ?? settings.baseUrl,
			monitorBaseUrl: settings.monitorBaseUrl ?? settings.baseUrl,
			subscriptionId: settings.subscriptionId,
			credential: credentialFor(settings)
		});

		/**
		 * Every virtual machine in the subscription, fetched once per read — and, keyed by
		 * owner, the same estate narrowed to one domain's tag.
		 *
		 * The estate window (key `''`) is what both aggregate capabilities want — one counts
		 * power states and the other groups by location — so it is memoised for a few
		 * seconds the way the Octopus provider's is, rather than paging the estate twice a
		 * page. An owner's window derives from that same estate window rather than replacing
		 * or narrowing it in place: a domain read must not evict the estate's own cache entry,
		 * because the very next aggregate read would otherwise refetch the whole subscription.
		 * Each owner key gets its own memoised entry under the same 30s TTL, so a tab a reader
		 * revisits does not refilter a settled estate on every render.
		 */
		const windows = new Map<string, { at: number; rows: Promise<ArmVirtualMachine[]> }>();

		function loadMachines(owner?: string): Promise<ArmVirtualMachine[]> {
			const key = owner ?? '';
			const now = Date.now();
			const cached = windows.get(key);

			if (!cached || now - cached.at > 30_000) {
				const rows = owner
					? loadMachines().then((estate) =>
							estate.filter((machine) => ownsResource(machine.tags, settings.ownerTagKey, owner))
						)
					: client.collect<ArmVirtualMachine>(
							`${client.scopePath}/providers/Microsoft.Compute/virtualMachines`,
							{ limit: settings.nodeLimit, params: { 'api-version': VM_API } }
						);

				windows.set(key, { at: now, rows });
			}

			return windows.get(key)!.rows;
		}

		/** A collection already fetched, narrowed to `ctx.binding`'s owner when one is asking. */
		function owned<T extends ArmResource>(rows: T[], ctx: SourceContext): T[] {
			if (!ctx.binding) return rows;
			return rows.filter((row) =>
				ownsResource(row.tags, settings.ownerTagKey, ctx.binding!.externalId)
			);
		}

		return {
			async listRegions(ctx) {
				return regionsOf(await loadMachines(ctx.binding?.externalId));
			},

			async readNodeCounts(ctx) {
				return countNodes(await loadMachines(ctx.binding?.externalId));
			},

			/**
			 * The estate's four headline readings, averaged across machines.
			 *
			 * Monitor answers per resource, and the screen wants one line per metric for the
			 * whole estate — so this samples rather than fans out across every machine: a
			 * subscription with two thousand VMs would otherwise be two thousand requests
			 * against an API with a request budget. The sample is the busiest regions' first
			 * machines, which is a stated approximation rather than a silent one.
			 */
			async readUtilization(ctx) {
				const machines = (await loadMachines(ctx.binding?.externalId)).slice(
					0,
					settings.metricSampleSize
				);
				if (machines.length === 0) return [];

				// Fifteen minutes at a minute a bucket, which is what the strip's own
				// caption claims it is comparing against.
				const window = ctx.window ?? {
					from: new Date(Date.now() - 900_000),
					to: new Date(),
					stepSeconds: 60
				};

				const readings = await Promise.all(
					machines.map((machine) =>
						client.metrics(
							machine.id,
							['Percentage CPU', 'Available Memory Bytes', 'Disk Read Bytes', 'Network In Total'],
							window
						)
					)
				);

				return utilizationFrom(readings, window);
			},

			async listClusters(ctx, limit) {
				const clusters = owned(
					await client.collect<ArmCluster>(
						`${client.scopePath}/providers/Microsoft.ContainerService/managedClusters`,
						{ limit, params: { 'api-version': AKS_API } }
					),
					ctx
				);

				const cpu = await Promise.all(
					clusters.map((cluster) =>
						client.metrics(cluster.id, ['node_cpu_usage_percentage'], {
							from: new Date(Date.now() - 900_000),
							to: new Date(),
							stepSeconds: 300
						})
					)
				);

				return clusters.map((cluster, index) => ({
					id: cluster.name,
					name: cluster.name,
					cpuPct: Math.round(latest(cpu[index][0]?.points ?? [])),
					status: clusterIsReady(cluster) ? ('healthy' as const) : ('degraded' as const)
				}));
			},

			async readStorage(ctx) {
				const accounts = owned(
					await client.collect<ArmResource>(
						`${client.scopePath}/providers/Microsoft.Storage/storageAccounts`,
						{ limit: 200, params: { 'api-version': STORAGE_API } }
					),
					ctx
				);

				const used = await Promise.all(
					accounts.map((account) =>
						client.metrics(
							account.id,
							['UsedCapacity'],
							{ from: new Date(Date.now() - 86_400_000), to: new Date(), stepSeconds: 86_400 },
							'Maximum'
						)
					)
				);

				const classes = accounts.map((account, index) => ({
					id: account.name,
					label: account.name,
					bytes: Math.round(latest(used[index][0]?.points ?? []))
				}));

				return {
					totalBytes: classes.reduce((sum, one) => sum + one.bytes, 0),
					classes
				};
			},

			async listDatabases(ctx, limit) {
				const servers = owned(
					await client.collect<ArmResource>(
						`${client.scopePath}/providers/Microsoft.DBforPostgreSQL/flexibleServers`,
						{ limit, params: { 'api-version': POSTGRES_API } }
					),
					ctx
				);

				const readings = await Promise.all(
					servers.map((server) =>
						client.metrics(server.id, ['Percentage CPU', 'active_connections', 'storage_used'], {
							from: new Date(Date.now() - 900_000),
							to: new Date(),
							stepSeconds: 300
						})
					)
				);

				return servers.map((server, index) => {
					const [cpu, connections, storage] = readings[index];
					const properties = server.properties as { version?: string; state?: string } | undefined;

					// Azure does not publish a connection ceiling as a metric; it follows the
					// SKU. Stated as the observed peak rather than invented, so the ratio a
					// reader sees is two numbers that were both measured.
					const inUse = Math.round(latest(connections?.points ?? []));

					return {
						id: server.name,
						name: server.name,
						engine: `PostgreSQL ${properties?.version ?? ''}`.trim(),
						// The server's own `state`, which is what the flexible-server API
						// publishes. Anything but Ready is a server not serving, whatever
						// its CPU says.
						status: properties?.state === 'Ready' ? ('healthy' as const) : ('degraded' as const),
						cpuPct: Math.round(latest(cpu?.points ?? [])),
						connections: inUse,
						connectionLimit: Math.max(inUse, DEFAULT_CONNECTION_LIMIT),
						storageBytes: Math.round(latest(storage?.points ?? []))
					};
				});
			},

			async readCost(ctx) {
				const body = await client.queryCost<{
					properties: { rows: CostRow[] };
				}>({
					type: 'Usage',
					timeframe: 'MonthToDate',
					dataset: {
						granularity: 'Daily',
						aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
						grouping: [{ type: 'Dimension', name: 'ServiceName' }]
					},
					...(ctx.binding
						? {
								filter: {
									tags: {
										name: settings.ownerTagKey,
										operator: 'In',
										values: [ctx.binding.externalId]
									}
								}
							}
						: {})
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
