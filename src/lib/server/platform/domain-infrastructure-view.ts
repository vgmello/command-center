import type { DomainInfrastructureSnapshot, InfraSummary } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { InfrastructureSource, PlatformSource } from './source';
import { toCostView, toUsageView } from '$lib/platform/infrastructure';
import { collapseUnbound } from '$lib/platform/gaps';
import { panel } from '../sources/panel';
import type { Panel } from '$lib/platform/sources';

/**
 * Assembles one domain's Infrastructure tab: the same seven cloud reads
 * `infrastructure-view.ts` makes for the estate, narrowed to the resources this domain
 * owns by passing its slug as `owner`.
 *
 * Returns `null` when there is no such domain, so the route renders a not-found panel
 * inside the shell rather than throwing — a typo in a URL is not an outage.
 */

export const DOMAIN_INFRA_LIMIT = 100;

export async function buildDomainInfrastructureSnapshot(
	platform: PlatformSource,
	infrastructure: InfrastructureSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<DomainInfrastructureSnapshot | null> {
	const domain = await platform.findDomain(scope, slug);
	if (!domain) return null;

	const owner = slug;
	const [nodes, regions, clusters, databases, utilization, cost, storage] = await Promise.all([
		panel('cloud.nodes', async () => ({ data: await infrastructure.readNodeCounts(scope, owner) })),
		panel('cloud.regions', async () => ({ data: await infrastructure.listRegions(scope, owner) })),
		panel('cloud.clusters', async () => ({
			data: await infrastructure.listClusters(scope, DOMAIN_INFRA_LIMIT, owner)
		})),
		panel('cloud.databases', async () => ({
			data: await infrastructure.listDatabases(scope, DOMAIN_INFRA_LIMIT, owner)
		})),
		panel('cloud.utilization', async () => ({
			data: (await infrastructure.readUtilization(scope, owner)).map(toUsageView)
		})),
		panel('cloud.cost', async () => ({
			data: toCostView(await infrastructure.readCost(scope, owner))
		})),
		panel('cloud.storage', async () => ({ data: await infrastructure.readStorage(scope, owner) }))
	]);

	// The strip is composed, not read: no node count, no strip; a storage-only gap is a
	// null cell, never a false zero, per `CountTile.value`.
	const summary: Panel<InfraSummary> =
		nodes.status !== 'ok'
			? (nodes as Panel<InfraSummary>)
			: {
					...nodes,
					data: {
						nodes: nodes.data,
						clusters:
							clusters.status === 'ok'
								? {
										count: clusters.data.length,
										atLimit: clusters.data.length === DOMAIN_INFRA_LIMIT
									}
								: null,
						databases:
							databases.status === 'ok'
								? {
										count: databases.data.length,
										atLimit: databases.data.length === DOMAIN_INFRA_LIMIT
									}
								: null,
						storageBytes: storage.status === 'ok' ? storage.data.totalBytes : null
					}
				};

	return {
		generatedAt: now.toISOString(),
		domain,
		unbound: collapseUnbound([nodes, regions, clusters, databases, utilization, cost, storage]),
		summary,
		nodes,
		regions,
		clusters,
		databases,
		utilization,
		cost
	};
}
