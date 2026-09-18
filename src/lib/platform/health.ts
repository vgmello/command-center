import { formatCompact, formatLatency, formatPercent } from './format';
import type { HealthCheck, HealthCheckUnit, HealthCheckView } from './types';
import type {
	Criticality,
	DistributionSlice,
	DomainStatusCounts,
	HealthDistribution,
	HealthStatus,
	TrendDirection
} from './types';

/** Worst-first. Used for sorting and for rolling many statuses up into one. */
const SEVERITY_ORDER: HealthStatus[] = ['down', 'degraded', 'unknown', 'healthy'];

export const STATUS_LABELS: Record<HealthStatus, string> = {
	healthy: 'Healthy',
	degraded: 'Degraded',
	down: 'Down',
	unknown: 'Unknown'
};

export const CRITICALITY_LABELS: Record<Criticality, string> = {
	'mission-critical': 'Mission critical',
	'business-critical': 'Business critical',
	important: 'Important',
	standard: 'Standard'
};

/**
 * The one place a health score becomes a status.
 *
 * Thresholds live here rather than in the fixtures or the UI so that a score and
 * its badge can never disagree — every caller derives the status the same way.
 */
export function statusFromScore(score: number): HealthStatus {
	if (!Number.isFinite(score)) return 'unknown';
	if (score >= HEALTH_THRESHOLDS.healthy) return 'healthy';
	if (score >= HEALTH_THRESHOLDS.degraded) return 'degraded';
	return 'down';
}

/** Rank of a status, 0 = worst. Sorting by this surfaces outages first. */
export function statusSeverity(status: HealthStatus): number {
	return SEVERITY_ORDER.indexOf(status);
}

/** The worst status in a set — an aggregate is only as healthy as its weakest part. */
export function rollUpStatus(statuses: HealthStatus[]): HealthStatus {
	if (statuses.length === 0) return 'unknown';
	return statuses.reduce((worst, next) =>
		statusSeverity(next) < statusSeverity(worst) ? next : worst
	);
}

/**
 * How a health-score move reads.
 *
 * Derived from the direction rather than sent as a sentence, for the same reason
 * `status` is derived from `healthScore`: a server-supplied phrase and a
 * server-supplied number are two facts that can contradict each other, and the one
 * the reader believes is the sentence.
 */
export const HEALTH_CHANGE_LABELS: Record<TrendDirection, string> = {
	up: 'Health score improved',
	down: 'Health score degraded',
	flat: 'Health score unchanged'
};

/** Which way a score moved. The single definition, so no caller invents its own. */
export function healthChangeDirection(previous: number, current: number): TrendDirection {
	if (current > previous) return 'up';
	if (current < previous) return 'down';
	return 'flat';
}

/** Score bands. Exported so nothing has to restate them — including the UI copy. */
export const HEALTH_THRESHOLDS = { healthy: 75, degraded: 50 } as const;

/**
 * Human-readable statement of the bands above.
 *
 * The table's tooltip explains the scoring; if it spelled the numbers out itself,
 * changing a threshold would silently turn that tooltip into a lie.
 */
export function describeHealthThresholds(): string {
	const { healthy, degraded } = HEALTH_THRESHOLDS;
	return `${healthy} and above is healthy, ${degraded}–${healthy - 1} degraded, below ${degraded} down.`;
}

/**
 * Turn per-status counts into donut slices.
 *
 * Takes counts rather than the domain list because that is what an aggregate query
 * returns — asking a real backend for every row just to count four statuses would
 * be a fixture habit leaking into the contract.
 *
 * Percentages are rounded for display but the counts stay exact, so the legend can
 * show "18 Healthy 72%" without the arithmetic drifting between the two.
 */
export function buildDistribution(counts: DomainStatusCounts): HealthDistribution {
	const order: HealthStatus[] = ['healthy', 'degraded', 'down', 'unknown'];
	const total = order.reduce((sum, status) => sum + counts[status], 0);

	const slices: DistributionSlice[] = order.map((status) => ({
		status,
		label: STATUS_LABELS[status],
		count: counts[status],
		percentage: total === 0 ? 0 : Math.round((counts[status] / total) * 100)
	}));

	return { total, slices };
}

/**
 * How a health check reads.
 *
 * Derived here rather than carried by a source, because a source that formats its own
 * readings forces every consumer to parse them back — and `/api/v1` did exactly that,
 * publishing 1,200 requests per second as 1.2 milliseconds because `formatCompact`
 * rendered it "1.2k" and `parseFloat` stopped at the k.
 */
export function formatHealthCheck(check: {
	value: number;
	unit: HealthCheckUnit;
	total?: number;
}): string {
	switch (check.unit) {
		case 'percent':
			// A saturation gauge reads "42%" and an error rate reads "0.42%". That used to
			// be two units in the fixture ('percent' and 'percent-int'), which is precision
			// masquerading as a unit — the magnitude already says which is which.
			return formatPercent(check.value, Number.isInteger(check.value) ? 0 : 2);
		case 'milliseconds': {
			const latency = formatLatency(check.value);
			return `${latency.value} ${latency.unit}`;
		}
		case 'count':
			return check.total === undefined
				? formatCompact(check.value)
				: `${check.value}/${check.total} up`;
		case 'rate':
		default:
			return formatCompact(check.value);
	}
}

/** A check plus how it reads, so a table never formats and a source never does either. */
export function toHealthCheckView(check: HealthCheck): HealthCheckView {
	return { ...check, formatted: formatHealthCheck(check) };
}
