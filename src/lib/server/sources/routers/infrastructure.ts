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

/**
 * Estate → the fan-out as before; owner → resolve and route to one connection, cached per owner.
 *
 * One `call` serves both branches. `mode` says which fan-out the estate takes — `'list'`
 * for a port method returning rows, `'single'` for one returning a value — so the provider
 * is spelled once per method and the owner path cannot drift from the estate path.
 */
async function scoped<T>(
	deps: RouterDeps,
	catalog: CatalogSource,
	capability: Capability,
	mode: 'list',
	scope: PlatformScope,
	args: string,
	owner: string | undefined,
	call: (client: unknown, ctx: SourceContext) => Promise<T[]>
): Promise<T[]>;
async function scoped<T>(
	deps: RouterDeps,
	catalog: CatalogSource,
	capability: Capability,
	mode: 'single',
	scope: PlatformScope,
	args: string,
	owner: string | undefined,
	call: (client: unknown, ctx: SourceContext) => Promise<T>
): Promise<T>;
async function scoped<T>(
	deps: RouterDeps,
	catalog: CatalogSource,
	capability: Capability,
	mode: 'list' | 'single',
	scope: PlatformScope,
	args: string,
	owner: string | undefined,
	call: (client: unknown, ctx: SourceContext) => Promise<T>
): Promise<T> {
	if (owner === undefined) {
		// The overloads above guarantee `call` returns rows in `'list'` mode; the
		// implementation signature cannot express that, hence the one cast.
		return mode === 'single'
			? fanOutSingle(deps, capability, scope, args, call)
			: ((await fanOut(
					deps,
					capability,
					scope,
					args,
					call as (client: unknown, ctx: SourceContext) => Promise<unknown[]>
				)) as T);
	}
	if (capability === 'cloud.queues' || capability === 'cloud.alerts') {
		// No provider filters queues or alerts by owner yet; the alerts spec that lands
		// the domain Alerts tab is where this lifts. Accepting the owner and returning the
		// estate's rows would be the exact "invented numbers" failure this codebase writes
		// the most rules against, so the router refuses rather than resolving a binding it
		// cannot honour — thrown before `catalog.findDomain` is even consulted.
		throw new CapabilityUnavailableError(capability, 'not-implemented');
	}
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
			scoped(deps, catalog, 'cloud.regions', 'list', scope, '', owner, (client, ctx) =>
				(client as CloudProvider).listRegions!(ctx)
			),

		readNodeCounts: (scope, owner) =>
			scoped(deps, catalog, 'cloud.nodes', 'single', scope, '', owner, (client, ctx) =>
				(client as CloudProvider).readNodeCounts!(ctx)
			),

		listClusters: (scope, limit, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.clusters',
				'list',
				scope,
				`limit=${limit}`,
				owner,
				(client, ctx) => (client as CloudProvider).listClusters!(ctx, limit)
			),

		readUtilization: (scope, owner) =>
			scoped(deps, catalog, 'cloud.utilization', 'list', scope, '', owner, (client, ctx) =>
				(client as CloudProvider).readUtilization!(ctx)
			),

		readStorage: (scope, owner) =>
			scoped(deps, catalog, 'cloud.storage', 'single', scope, '', owner, (client, ctx) =>
				(client as CloudProvider).readStorage!(ctx)
			),

		listDatabases: (scope, limit, owner) =>
			scoped(
				deps,
				catalog,
				'cloud.databases',
				'list',
				scope,
				`limit=${limit}`,
				owner,
				(client, ctx) => (client as CloudProvider).listDatabases!(ctx, limit)
			),

		listQueues: (scope, limit, owner) =>
			scoped(deps, catalog, 'cloud.queues', 'list', scope, `limit=${limit}`, owner, (client, ctx) =>
				(client as CloudProvider).listQueues!(ctx, limit)
			),

		listAlerts: (scope, limit, owner) =>
			scoped(deps, catalog, 'cloud.alerts', 'list', scope, `limit=${limit}`, owner, (client, ctx) =>
				(client as CloudProvider).listAlerts!(ctx, limit)
			),

		readCost: (scope, owner) =>
			scoped(deps, catalog, 'cloud.cost', 'single', scope, '', owner, (client, ctx) =>
				(client as CloudProvider).readCost!(ctx)
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
