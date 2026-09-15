import type {
	InfrastructureSnapshot,
	NodeCounts,
	ResourceUsage,
	ServiceStat,
	StorageClass
} from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { InfrastructureSource } from './source';
import { toCostView, toStorageView, toUsageView } from '$lib/platform/infrastructure';
import { toSeries } from './snapshot';
import { panel } from '../sources/panel';

/**
 * Assembles the infrastructure overview from whatever estate source is configured.
 *
 * One assembler per screen, like the others. Everything is a pure transform of what
 * the source returned, or the orchestration that fetches it.
 */

export const CLUSTER_LIMIT = 3;
export const DATABASE_LIMIT = 4;
export const QUEUE_LIMIT = 4;
export const ALERT_LIMIT = 3;

/**
 * The seven tiles across the top.
 *
 * They reuse `ServiceStat` rather than declaring a parallel union: the shapes needed
 * here are exactly the four that screen needed — a headline with a link, a ratio, a
 * reading with a trend. A second union of the same four would be two things to keep in
 * step for no gain.
 */
/**
 * How healthy the estate is, judged on proportion rather than on the worst node.
 *
 * `rollUpStatus` is right for a service — one dead instance of three is an incident —
 * and wrong here. An estate of fifty nodes always has one rebuilding, and a headline
 * that reads "At risk" whenever a single node is down is a headline nobody reads twice.
 *
 * The bands are stated here because this is the only place that judges an estate.
 */
export const ESTATE_THRESHOLDS = { downPct: 5, unhealthyPct: 15 } as const;

export function estateHealth(nodes: NodeCounts): {
	tone: 'healthy' | 'degraded' | 'down';
	headline: string;
} {
	const total = nodes.healthy + nodes.warning + nodes.down;
	if (total === 0) return { tone: 'down', headline: 'Unknown' };

	const downPct = (nodes.down / total) * 100;
	const unhealthyPct = ((nodes.down + nodes.warning) / total) * 100;

	if (downPct > ESTATE_THRESHOLDS.downPct) return { tone: 'down', headline: 'At risk' };
	if (unhealthyPct > ESTATE_THRESHOLDS.unhealthyPct) return { tone: 'degraded', headline: 'Fair' };
	return { tone: 'healthy', headline: 'Good' };
}

/**
 * The seven tiles across the top.
 *
 * They reuse `ServiceStat` rather than declaring a parallel union: the shapes needed
 * here are exactly the ones the service view needed — a headline with a caption, a
 * ratio, a reading with a trend. A second union of the same shapes would be two things
 * to keep in step for no gain.
 */
export function buildInfraStats(
	/**
	 * `null` when no connected cloud source counts nodes.
	 *
	 * The tiles that describe the estate's health are built from this, so without it they
	 * state that nothing is counting rather than printing a confident zero — the same
	 * distinction the domain header makes between no incidents and nothing watching.
	 */
	nodes: NodeCounts | null,
	nodeCapacity: number,
	clusterCount: number,
	resources: ResourceUsage[]
): ServiceStat[] {
	if (!nodes) return unreportedInfraStats(resources, clusterCount);

	const totalNodes = nodes.healthy + nodes.warning + nodes.down;
	const estate = estateHealth(nodes);

	const stats: ServiceStat[] = [
		{
			kind: 'note',
			id: 'overall',
			label: 'Overall Health',
			formatted: estate.headline,
			caption: describeOverallHealth(nodes),
			tone: estate.tone,
			icon: estate.tone === 'healthy' ? 'circle-check' : 'triangle-alert'
		},
		{
			kind: 'ratio',
			id: 'clusters',
			label: 'Clusters',
			value: clusterCount,
			total: clusterCount,
			caption: 'Healthy',
			tone: 'healthy',
			icon: 'boxes'
		},
		{
			kind: 'ratio',
			id: 'nodes',
			label: 'Nodes',
			value: totalNodes,
			total: nodeCapacity,
			caption: nodes.down > 0 ? `${nodes.down} down` : 'Healthy',
			tone: nodes.down > 0 ? 'degraded' : 'healthy',
			icon: 'server'
		}
	];

	// The four utilisation readings appear twice on this screen — once as a tile and
	// once as a panel — so both are built from one source rather than measured twice.
	for (const resource of resources) {
		stats.push(trendStatFor(resource));
	}

	return stats;
}

/** The four utilisation readings, as the tile the strip draws. */
function trendStatFor(resource: ResourceUsage): ServiceStat {
	const RESOURCE_ICONS: Record<string, string> = {
		cpu: 'cpu',
		memory: 'memory-stick',
		disk: 'hard-drive',
		network: 'network'
	};

	return {
		kind: 'trend',
		id: resource.id,
		label: `${resource.label}${resource.id === 'network' ? '' : ' Usage'}`,
		formatted: resource.formatted,
		unit: resource.displayUnit,
		// The panel plots a labelled TimeSeries; a tile's sparkline only needs the shape,
		// so the labels are dropped rather than carried across the wire twice.
		series: toSeries(resource.series.points.map((point) => point.value)),
		changeFormatted: resource.changeFormatted,
		comparedToLabel: resource.comparedToLabel,
		direction: resource.direction,
		polarity: resource.polarity,
		tone: null,
		icon: RESOURCE_ICONS[resource.id]
	};
}

/**
 * The strip when nothing counts the estate.
 *
 * The cluster count still comes from the groups read, and any utilisation readings that
 * did arrive are still drawn — a provider that answers four of nine capabilities should
 * show the four.
 */
function unreportedInfraStats(resources: ResourceUsage[], clusterCount: number): ServiceStat[] {
	const stats: ServiceStat[] = [
		{
			kind: 'note',
			id: 'overall',
			label: 'Overall Health',
			formatted: 'Not reported',
			caption: 'No connected cloud source counts nodes.',
			tone: null,
			icon: 'circle-help'
		}
	];

	if (clusterCount > 0) {
		stats.push({
			kind: 'ratio',
			id: 'clusters',
			label: 'Clusters',
			value: clusterCount,
			total: clusterCount,
			caption: 'Healthy',
			tone: 'healthy',
			icon: 'boxes'
		});
	}

	for (const resource of resources) {
		stats.push(trendStatFor(resource));
	}

	return stats;
}

/** The overall-health caption, kept beside the headline it belongs to. */
export function describeOverallHealth(nodes: NodeCounts): string {
	if (nodes.down > 0) return `${nodes.down} node${nodes.down === 1 ? '' : 's'} down`;
	if (nodes.warning > 0) return `${nodes.warning} node${nodes.warning === 1 ? '' : 's'} degraded`;
	return 'No critical issues';
}

export async function buildInfrastructureSnapshot(
	source: InfrastructureSource,
	scope: PlatformScope,
	now: Date = new Date()
): Promise<InfrastructureSnapshot> {
	/**
	 * Every read wrapped, because a cloud provider answers what it can and no more.
	 *
	 * An ARM-only Azure adapter serves regions, nodes and spend; utilisation, storage,
	 * databases and queues live in Monitor. Unwrapped, the first of those gaps took the
	 * whole page down with `CapabilityUnavailableError` — the failure `panel()` exists to
	 * turn into a stated empty state, and one the overview and domains screens had already
	 * been fixed for.
	 */
	const [groups, regions, nodes, clusters, resources, storage, databases, queues, alerts, cost] =
		await Promise.all([
			panel('cloud.nodes', async () => ({ data: await source.listGroups(scope) })),
			panel('cloud.regions', async () => ({ data: await source.listRegions(scope) })),
			panel('cloud.nodes', async () => ({ data: await source.readNodeCounts(scope) })),
			panel('cloud.clusters', async () => ({
				data: await source.listClusters(scope, CLUSTER_LIMIT)
			})),
			panel('cloud.utilization', async () => ({ data: await source.readUtilization(scope) })),
			panel('cloud.storage', async () => ({ data: await source.readStorage(scope) })),
			panel('cloud.databases', async () => ({
				data: await source.listDatabases(scope, DATABASE_LIMIT)
			})),
			panel('cloud.queues', async () => ({ data: await source.listQueues(scope, QUEUE_LIMIT) })),
			panel('cloud.alerts', async () => ({ data: await source.listAlerts(scope, ALERT_LIMIT) })),
			panel('cloud.cost', async () => ({ data: await source.readCost(scope) }))
		]);

	// The readings arrive as facts; how they read is decided here, once, so a cloud
	// adapter never formats a number or picks a tint.
	const usage = resources.status === 'ok' ? resources.data.map(toUsageView) : [];
	const counts = nodes.status === 'ok' ? nodes.data : null;
	const groupRows = groups.status === 'ok' ? groups.data : [];
	const clusterRows = clusters.status === 'ok' ? clusters.data : [];

	const clusterCount =
		groupRows.find((group) => group.id === 'clusters')?.count ?? clusterRows.length;
	// Capacity is nodes provisioned, which is the total plus whatever is not reporting.
	const nodeCapacity = Math.max(
		counts ? counts.healthy + counts.warning + counts.down : 0,
		groupRows.find((group) => group.id === 'nodes')?.count ?? 0
	);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		stats: buildInfraStats(counts, nodeCapacity, clusterCount, usage),
		regions,
		nodes,
		clusters,
		resources: resources.status === 'ok' ? { ...resources, data: usage } : resources,
		storage: storage.status === 'ok' ? { ...storage, data: toStorageView(storage.data) } : storage,
		databases,
		queues,
		alerts,
		cost: cost.status === 'ok' ? { ...cost, data: toCostView(cost.data) } : cost
	};
}

/** Re-exported so a caller can size the donut without importing the fixture. */
export type { StorageClass };
