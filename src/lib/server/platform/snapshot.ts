import type {
	CountTile,
	DomainStatusCounts,
	HealthStatus,
	OverviewSnapshot,
	RateMetric,
	RateObservation,
	Series,
	SystemStatus
} from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { DeploymentSource, PlatformSource } from './source';
import { STATUS_LABELS, buildDistribution } from '$lib/platform/health';
import { formatChange, formatCompact, formatLatency, formatPercent } from '$lib/platform/format';

/**
 * Assembles one overview snapshot from whatever source is configured.
 *
 * Everything in this file is either a pure transform of what the source returned or
 * the orchestration that fetches it. No invented numbers, no I/O of its own — that
 * split is what lets the fixture source be swapped for a real one without touching
 * anything here.
 */

export const DEFAULT_PAGE_SIZE = 8;

/** How many rows the side panels show. The source pages; it does not guess. */
export const INCIDENT_LIMIT = 5;
export const DEPLOYMENT_LIMIT = 5;

const COUNT_TILE_ICONS: Record<'total' | HealthStatus, string> = {
	total: 'box',
	healthy: 'circle-check',
	degraded: 'triangle-alert',
	down: 'circle-x',
	unknown: 'circle-help'
};

/** Tiles across the top: one total, then one per status that matters at a glance. */
export function buildCountTiles(counts: DomainStatusCounts): CountTile[] {
	const total = counts.healthy + counts.degraded + counts.down + counts.unknown;
	const share = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

	return [
		{
			id: 'total',
			label: 'Total Domains',
			icon: COUNT_TILE_ICONS.total,
			value: total,
			percentage: null,
			caption: 'Across platform',
			tone: null
		},
		...(['healthy', 'degraded', 'down'] as const).map((status) => ({
			id: status,
			label: STATUS_LABELS[status],
			icon: COUNT_TILE_ICONS[status],
			value: counts[status],
			percentage: share(counts[status]),
			caption: null,
			tone: status
		}))
	];
}

/**
 * Format observed rates for display.
 *
 * The source says what a metric *is* (`kind`) and which way is better
 * (`polarity`); this decides how it reads. Keeping that here means a new metric
 * needs no UI change, and a formatting change touches no source.
 */
export function buildMetrics(
	observations: RateObservation[],
	timeRange: PlatformScope['timeRange']
): RateMetric[] {
	// The compact id ("15m") rather than the long label ("Last 15 minutes"): the
	// caption sits under a metric in an 11px line and has to stay on one row.
	const comparedToLabel = `vs ${timeRange} ago`;

	return observations.map((observation) => {
		const { formatted, unit } = formatValue(observation);

		return {
			id: observation.id,
			label: observation.label,
			value: observation.value,
			formatted,
			unit,
			series: toSeries(observation.samples),
			direction: observation.change > 0 ? 'up' : observation.change < 0 ? 'down' : 'flat',
			changeFormatted: formatChangeFor(observation),
			comparedToLabel,
			polarity: observation.polarity
		};
	});
}

function formatValue(observation: RateObservation): { formatted: string; unit: string } {
	switch (observation.kind) {
		case 'percent':
			return { formatted: formatPercent(observation.value), unit: '' };
		case 'duration-ms': {
			const latency = formatLatency(observation.value);
			return { formatted: latency.value, unit: latency.unit };
		}
		case 'rate':
		default:
			return { formatted: formatCompact(observation.value), unit: observation.unit };
	}
}

/**
 * A rate's change is relative (percent), a percentage's change is in points (also
 * printed with a %), and a duration's change is in its own unit.
 */
function formatChangeFor(observation: RateObservation): string {
	switch (observation.kind) {
		case 'percent':
			return formatChange(observation.change, '%', 2);
		case 'duration-ms':
			return formatChange(observation.change, observation.unit, 0);
		case 'rate':
		default:
			return formatChange(observation.change, '%', 1);
	}
}

/** Precompute the bounds once so every sparkline renders without a pass over the data. */
export function toSeries(values: number[]): Series {
	if (values.length === 0) return { values, min: 0, max: 0 };
	return { values, min: Math.min(...values), max: Math.max(...values) };
}

/** The aggregate badge in the sidebar footer, derived rather than declared. */
export function buildSystemStatus(counts: DomainStatusCounts): SystemStatus {
	if (counts.down > 0) {
		return {
			status: 'down',
			label: 'Partial Outage',
			detail: `${counts.down} domain${counts.down === 1 ? '' : 's'} down`
		};
	}
	if (counts.degraded > 0) {
		return {
			status: 'degraded',
			label: 'Degraded',
			detail: `${counts.degraded} domain${counts.degraded === 1 ? '' : 's'} degraded`
		};
	}
	return { status: 'healthy', label: 'All Systems', detail: 'Operational' };
}

/**
 * Everything the overview page needs except the paged domain table.
 *
 * Takes both ports it needs rather than reaching for a resolver: the assembler is
 * pure orchestration, and a function that fetches its own collaborators cannot be
 * handed a stub in a test.
 *
 * The reads run concurrently: they are independent, and issuing them in sequence
 * would make the page as slow as the sum of its panels rather than its slowest one.
 */
export async function buildOverview(
	source: PlatformSource,
	deployments: DeploymentSource,
	scope: PlatformScope,
	now: Date = new Date()
): Promise<OverviewSnapshot> {
	const [counts, rates, incidents, recentDeployments, infrastructure] = await Promise.all([
		source.readDomainStatusCounts(scope),
		source.readRates(scope),
		source.listIncidents(scope, INCIDENT_LIMIT),
		deployments.listDeployments(scope, DEPLOYMENT_LIMIT),
		source.listInfrastructure(scope)
	]);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		counts: buildCountTiles(counts),
		metrics: buildMetrics(rates, scope.timeRange),
		distribution: buildDistribution(counts),
		incidents,
		deployments: recentDeployments,
		infrastructure,
		system: buildSystemStatus(counts)
	};
}
