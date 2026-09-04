import type { InfrastructureGroup } from '$lib/platform/types';
import type { InfrastructureSource } from '../../platform/source';
import type { CloudProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

/**
 * `InfrastructureSource`, implemented by dispatching to cloud providers.
 *
 * Every method of this port is source-backed — it has no catalog side — except
 * `listGroups`, which is composed from four other capabilities rather than being one of
 * its own. That keeps the four-count summary and the panels beneath it counting the
 * same things, and means the summary is available exactly when its parts are.
 */
export function createInfrastructureRouter(deps: RouterDeps): InfrastructureSource {
	const source: InfrastructureSource = {
		id: 'routed-infrastructure',

		listRegions: (scope) =>
			fanOut(deps, 'cloud.regions', scope, '', (client, ctx) =>
				(client as CloudProvider).listRegions!(ctx)
			),

		readNodeCounts: (scope) =>
			fanOutSingle(deps, 'cloud.nodes', scope, '', (client, ctx) =>
				(client as CloudProvider).readNodeCounts!(ctx)
			),

		listClusters: (scope, limit) =>
			fanOut(deps, 'cloud.clusters', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listClusters!(ctx, limit)
			),

		readUtilization: (scope) =>
			fanOut(deps, 'cloud.utilization', scope, '', (client, ctx) =>
				(client as CloudProvider).readUtilization!(ctx)
			),

		readStorage: (scope) =>
			fanOutSingle(deps, 'cloud.storage', scope, '', (client, ctx) =>
				(client as CloudProvider).readStorage!(ctx)
			),

		listDatabases: (scope, limit) =>
			fanOut(deps, 'cloud.databases', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listDatabases!(ctx, limit)
			),

		listQueues: (scope, limit) =>
			fanOut(deps, 'cloud.queues', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listQueues!(ctx, limit)
			),

		listAlerts: (scope, limit) =>
			fanOut(deps, 'cloud.alerts', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listAlerts!(ctx, limit)
			),

		readCost: (scope) =>
			fanOutSingle(deps, 'cloud.cost', scope, '', (client, ctx) =>
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
