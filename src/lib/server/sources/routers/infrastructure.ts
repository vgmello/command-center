import type { InfrastructureGroup } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { InfrastructureSource } from '../../platform/source';
import type { CatalogSource } from '../../catalog/source';
import type { CloudProvider } from '../contracts';
import type { Capability } from '$lib/platform/sources';
import type { SourceBinding, SourceContext } from '../provider';
import { CapabilityUnavailableError } from '../errors';
import { fanOut, fanOutSingle, routeOne, type RouterDeps } from './shared';

/**
 * A domain's DECLARED cloud binding, or the reason there is none.
 *
 * Declared only — `bindingFor()`'s fallback synthesises a slug binding for APM identity and
 * would make every domain look bound. Unknown slug and no binding are the same gap: nothing
 * to read for.
 */
async function ownerBinding(
	catalog: CatalogSource,
	capability: Capability,
	owner: string
): Promise<SourceBinding> {
	const record = await catalog.findDomain(owner);
	const declared = record?.bindings.find((one) => one.kind === 'cloud');
	if (!declared) throw new CapabilityUnavailableError(capability, 'no-binding');
	return { kind: 'cloud', connectionId: declared.connectionId, externalId: declared.externalId };
}

/** Estate → the fan-out as before; owner → resolve and route to one connection, cached per owner. */
async function scoped<T>(
	deps: RouterDeps,
	catalog: CatalogSource,
	capability: Capability,
	scope: PlatformScope,
	args: string,
	owner: string | undefined,
	call: (client: unknown, ctx: SourceContext) => Promise<T>,
	estate: () => Promise<T>
): Promise<T> {
	if (owner === undefined) return estate();
	const binding = await ownerBinding(catalog, capability, owner);
	return routeOne(
		deps,
		capability,
		scope,
		binding,
		`${args}${args ? '&' : ''}owner=${owner}`,
		call
	);
}

/**
 * `InfrastructureSource`, implemented by dispatching to cloud providers.
 *
 * Every method of this port is source-backed — it has no catalog side of its own — except
 * `listGroups`, which is composed from four other capabilities rather than being one of its
 * own, and the owner-scoped path, which resolves a domain's declared cloud binding through
 * `catalog` before routing to the one connection that owns it. That keeps the four-count
 * summary and the panels beneath it counting the same things, and means the summary is
 * available exactly when its parts are.
 */
export function createInfrastructureRouter(
	deps: RouterDeps,
	catalog: CatalogSource
): InfrastructureSource {
	const source: InfrastructureSource = {
		id: 'routed-infrastructure',

		listRegions: (scope, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.regions',
				scope,
				'',
				owner,
				(client, ctx) => (client as CloudProvider).listRegions!(ctx),
				() =>
					fanOut(deps, 'cloud.regions', scope, '', (client, ctx) =>
						(client as CloudProvider).listRegions!(ctx)
					)
			),

		readNodeCounts: (scope, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.nodes',
				scope,
				'',
				owner,
				(client, ctx) => (client as CloudProvider).readNodeCounts!(ctx),
				() =>
					fanOutSingle(deps, 'cloud.nodes', scope, '', (client, ctx) =>
						(client as CloudProvider).readNodeCounts!(ctx)
					)
			),

		listClusters: (scope, limit, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.clusters',
				scope,
				`limit=${limit}`,
				owner,
				(client, ctx) => (client as CloudProvider).listClusters!(ctx, limit),
				() =>
					fanOut(deps, 'cloud.clusters', scope, `limit=${limit}`, (client, ctx) =>
						(client as CloudProvider).listClusters!(ctx, limit)
					)
			),

		readUtilization: (scope, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.utilization',
				scope,
				'',
				owner,
				(client, ctx) => (client as CloudProvider).readUtilization!(ctx),
				() =>
					fanOut(deps, 'cloud.utilization', scope, '', (client, ctx) =>
						(client as CloudProvider).readUtilization!(ctx)
					)
			),

		readStorage: (scope, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.storage',
				scope,
				'',
				owner,
				(client, ctx) => (client as CloudProvider).readStorage!(ctx),
				() =>
					fanOutSingle(deps, 'cloud.storage', scope, '', (client, ctx) =>
						(client as CloudProvider).readStorage!(ctx)
					)
			),

		listDatabases: (scope, limit, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.databases',
				scope,
				`limit=${limit}`,
				owner,
				(client, ctx) => (client as CloudProvider).listDatabases!(ctx, limit),
				() =>
					fanOut(deps, 'cloud.databases', scope, `limit=${limit}`, (client, ctx) =>
						(client as CloudProvider).listDatabases!(ctx, limit)
					)
			),

		listQueues: (scope, limit, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.queues',
				scope,
				`limit=${limit}`,
				owner,
				(client, ctx) => (client as CloudProvider).listQueues!(ctx, limit),
				() =>
					fanOut(deps, 'cloud.queues', scope, `limit=${limit}`, (client, ctx) =>
						(client as CloudProvider).listQueues!(ctx, limit)
					)
			),

		listAlerts: (scope, limit, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.alerts',
				scope,
				`limit=${limit}`,
				owner,
				(client, ctx) => (client as CloudProvider).listAlerts!(ctx, limit),
				() =>
					fanOut(deps, 'cloud.alerts', scope, `limit=${limit}`, (client, ctx) =>
						(client as CloudProvider).listAlerts!(ctx, limit)
					)
			),

		readCost: (scope, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.cost',
				scope,
				'',
				owner,
				(client, ctx) => (client as CloudProvider).readCost!(ctx),
				() =>
					fanOutSingle(deps, 'cloud.cost', scope, '', (client, ctx) =>
						(client as CloudProvider).readCost!(ctx)
					)
			),

		async listGroups(scope): Promise<InfrastructureGroup[]> {
			const [nodes, clusters, databases, queues] = await Promise.all([
				source.readNodeCounts(scope),
				source.listClusters(scope, 100),
				source.listDatabases(scope, 100),
				source.listQueues(scope, 100)
			]);

			return [
				{
					id: 'clusters',
					label: 'Clusters',
					icon: 'boxes',
					count: clusters.length,
					status: 'healthy',
					statusLabel: 'Healthy'
				},
				{
					id: 'nodes',
					label: 'Nodes',
					icon: 'server',
					count: nodes.healthy + nodes.warning + nodes.down,
					status: nodes.down > 0 ? 'degraded' : 'healthy',
					statusLabel: nodes.down > 0 ? 'Degraded' : 'Healthy'
				},
				{
					id: 'databases',
					label: 'Databases',
					icon: 'database',
					count: databases.length,
					status: 'healthy',
					statusLabel: 'Healthy'
				},
				{
					id: 'queues',
					label: 'Queues',
					icon: 'layers',
					count: queues.length,
					status: queues.some((queue) => queue.status !== 'healthy') ? 'degraded' : 'healthy',
					statusLabel: 'Operational'
				}
			];
		}
	};

	return source;
}
