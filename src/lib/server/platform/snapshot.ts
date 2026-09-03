import type {
	CountTile,
	Criticality,
	Domain,
	DomainPage,
	DomainQuery,
	EnvironmentId,
	OverviewSnapshot,
	RateMetric,
	SystemStatus,
	TimeRangeId
} from '$lib/platform/types';
import { buildDistribution, STATUS_LABELS } from '$lib/platform/health';
import { formatChange, formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
import {
	CURRENT_USER,
	TIME_RANGES,
	listDeployments,
	listDomains,
	listIncidents,
	listInfrastructure
} from './fixtures';
import { buildSeries } from './series';

export const DEFAULT_PAGE_SIZE = 8;

/** Attention order: a mission-critical wobble outranks a standard-tier outage. */
const CRITICALITY_WEIGHT: Record<Criticality, number> = {
	'mission-critical': 0,
	'business-critical': 1,
	important: 2,
	standard: 3
};

/**
 * Filter, sort, and slice the domain list.
 *
 * Pure and exported on its own so it can be tested without a request context —
 * the remote function that wraps it adds validation and nothing else.
 */
export function queryDomains(domains: Domain[], query: DomainQuery): DomainPage {
	const needle = query.search.trim().toLowerCase();

	const filtered = domains.filter((domain) => {
		if (query.status !== 'all' && domain.status !== query.status) return false;
		if (!needle) return true;
		return domain.name.toLowerCase().includes(needle) || domain.slug.includes(needle);
	});

	const sorted = [...filtered].sort(comparatorFor(query.sort));

	const pageSize = Math.max(1, query.pageSize);
	const totalItems = sorted.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const page = Math.min(Math.max(1, query.page), totalPages);
	const offset = (page - 1) * pageSize;
	const slice = sorted.slice(offset, offset + pageSize);

	return {
		domains: slice,
		page: {
			page,
			pageSize,
			totalItems,
			totalPages,
			from: totalItems === 0 ? 0 : offset + 1,
			to: offset + slice.length
		}
	};
}

function comparatorFor(sort: DomainQuery['sort']): (a: Domain, b: Domain) => number {
	switch (sort) {
		case 'error-rate':
			return (a, b) => b.errorRatePct - a.errorRatePct;
		case 'p95-latency':
			return (a, b) => b.p95LatencyMs - a.p95LatencyMs;
		case 'active-incidents':
			return (a, b) => b.activeIncidents - a.activeIncidents || a.healthScore - b.healthScore;
		case 'name':
			return (a, b) => a.name.localeCompare(b.name);
		case 'health-score':
		default:
			// Criticality-weighted: a mission-critical domain at 74 is a bigger problem
			// than a standard-tier one at 38, so the tier leads and the score breaks ties.
			return (a, b) =>
				CRITICALITY_WEIGHT[a.criticality] - CRITICALITY_WEIGHT[b.criticality] ||
				a.healthScore - b.healthScore;
	}
}

/** Tiles across the top: one total, then one per status that matters at a glance. */
export function buildCountTiles(domains: Domain[]): CountTile[] {
	const total = domains.length;
	const share = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 100));
	const count = (status: Domain['status']) => domains.filter((d) => d.status === status).length;

	return [
		{
			id: 'total',
			label: 'Total Domains',
			value: total,
			percentage: null,
			caption: 'Across platform',
			status: null
		},
		...(['healthy', 'degraded', 'down'] as const).map((status) => ({
			id: status,
			label: STATUS_LABELS[status],
			value: count(status),
			percentage: share(count(status)),
			caption: null,
			status
		}))
	];
}

/**
 * The three headline rates.
 *
 * `polarity` is stated per metric because the UI cannot know that a rising
 * request rate is fine while a rising error rate is not.
 */
export function buildMetrics(timeRange: TimeRangeId): RateMetric[] {
	// The compact id ("15m") rather than the long label ("Last 15 minutes"): the
	// caption sits under a metric in an 11px line and has to stay on one row.
	const window = TIME_RANGES.find((range) => range.id === timeRange) ?? TIME_RANGES[1];
	const comparedToLabel = `vs ${window.id} ago`;

	const requestRate = 18_700;
	const errorRate = 1.38;
	const p95 = 412;

	return [
		{
			id: 'request-rate',
			label: 'Request Rate',
			value: requestRate,
			formatted: formatCompact(requestRate),
			unit: 'req/s',
			series: buildSeries(`request-rate:${timeRange}`, requestRate, {
				volatility: 0.08,
				drift: 0.12
			}),
			direction: 'up',
			changeFormatted: formatChange(8.4, '%', 1),
			comparedToLabel,
			polarity: 'higher-is-better'
		},
		{
			id: 'error-rate',
			label: 'Error Rate',
			value: errorRate,
			formatted: formatPercent(errorRate),
			unit: '',
			series: buildSeries(`error-rate:${timeRange}`, errorRate, {
				volatility: 0.2,
				drift: 0.35
			}),
			direction: 'up',
			changeFormatted: formatChange(0.32, '%'),
			comparedToLabel,
			polarity: 'lower-is-better'
		},
		{
			id: 'p95-latency',
			label: 'P95 Latency',
			value: p95,
			formatted: formatLatency(p95).value,
			unit: formatLatency(p95).unit,
			series: buildSeries(`p95:${timeRange}`, p95, { volatility: 0.12, drift: -0.15 }),
			direction: 'down',
			changeFormatted: formatChange(-28, 'ms', 0),
			comparedToLabel,
			polarity: 'lower-is-better'
		}
	];
}

/** The aggregate badge in the sidebar footer, derived rather than declared. */
export function buildSystemStatus(domains: Domain[]): SystemStatus {
	const down = domains.filter((d) => d.status === 'down').length;
	const degraded = domains.filter((d) => d.status === 'degraded').length;

	if (down > 0) {
		return {
			status: 'down',
			label: 'Partial Outage',
			detail: `${down} domain${down === 1 ? '' : 's'} down`
		};
	}
	if (degraded > 0) {
		return {
			status: 'degraded',
			label: 'Degraded',
			detail: `${degraded} domain${degraded === 1 ? '' : 's'} degraded`
		};
	}
	return { status: 'healthy', label: 'All Systems', detail: 'Operational' };
}

/**
 * Assemble everything the overview page needs except the paged domain table.
 *
 * The table is a separate query because it changes on every toolbar interaction
 * while the rest of the page does not — refetching the incidents list because
 * someone typed in the domain search would be wasted work.
 */
export function buildOverview(
	environment: EnvironmentId,
	timeRange: TimeRangeId,
	now: Date = new Date()
): OverviewSnapshot {
	const domains = listDomains();

	return {
		generatedAt: now.toISOString(),
		environment,
		timeRange,
		counts: buildCountTiles(domains),
		metrics: buildMetrics(timeRange),
		distribution: buildDistribution(domains),
		incidents: listIncidents(now),
		deployments: listDeployments(now),
		infrastructure: listInfrastructure(),
		system: buildSystemStatus(domains)
	};
}

export { CURRENT_USER };
