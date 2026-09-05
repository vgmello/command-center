import type {
	InfrastructureSnapshot,
	NodeCounts,
	ServiceStat,
	StorageClass
} from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { InfrastructureSource } from './source';
import { formatBytes } from '$lib/platform/infrastructure';
import { toSeries } from './snapshot';

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
	nodes: NodeCounts,
	nodeCapacity: number,
	clusterCount: number,
	resources: InfrastructureSnapshot['resources']
): ServiceStat[] {
	const totalNodes = nodes.healthy + nodes.warning + nodes.down;
	const estate = estateHealth(nodes);

	const RESOURCE_ICONS: Record<string, string> = {
		cpu: 'cpu',
		memory: 'memory-stick',
		disk: 'hard-drive',
		network: 'network'
	};

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
		stats.push({
			kind: 'trend',
			id: resource.id,
			label: `${resource.label}${resource.id === 'network' ? '' : ' Usage'}`,
			formatted: resource.formatted,
			unit: resource.unit,
			// The panel plots a labelled TimeSeries; a tile's sparkline only needs the
			// shape, so the labels are dropped rather than carried across the wire twice.
			series: toSeries(resource.series.points.map((point) => point.value)),
			changeFormatted: resource.changeFormatted,
			comparedToLabel: resource.comparedToLabel,
			direction: resource.direction,
			polarity: resource.polarity,
			tone: null,
			icon: RESOURCE_ICONS[resource.id]
		});
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
	const [groups, regions, nodes, clusters, resources, storage, databases, queues, alerts, cost] =
		await Promise.all([
			source.listGroups(scope),
			source.listRegions(scope),
			source.readNodeCounts(scope),
			source.listClusters(scope, CLUSTER_LIMIT),
			source.readUtilization(scope),
			source.readStorage(scope),
			source.listDatabases(scope, DATABASE_LIMIT),
			source.listQueues(scope, QUEUE_LIMIT),
			source.listAlerts(scope, ALERT_LIMIT),
			source.readCost(scope)
		]);

	const clusterCount = groups.find((group) => group.id === 'clusters')?.count ?? clusters.length;
	// Capacity is nodes provisioned, which is the total plus whatever is not reporting.
	const nodeCapacity = Math.max(
		nodes.healthy + nodes.warning + nodes.down,
		groups.find((group) => group.id === 'nodes')?.count ?? 0
	);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		stats: buildInfraStats(nodes, nodeCapacity, clusterCount, resources),
		regions,
		nodes,
		clusters,
		resources,
		storage: { totalFormatted: formatBytes(storage.totalBytes), classes: storage.classes },
		databases,
		queues,
		alerts,
		cost
	};
}

/** Re-exported so a caller can size the donut without importing the fixture. */
export type { StorageClass };
