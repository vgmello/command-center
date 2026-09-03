import type {
	Criticality,
	DistributionSlice,
	Domain,
	HealthDistribution,
	HealthStatus
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
	if (score >= 75) return 'healthy';
	if (score >= 50) return 'degraded';
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
 * Count domains per status and turn the counts into donut slices.
 *
 * Percentages are rounded for display but the counts stay exact, so the legend
 * can show "18 Healthy 72%" without the arithmetic drifting between the two.
 */
export function buildDistribution(domains: Pick<Domain, 'status'>[]): HealthDistribution {
	const order: HealthStatus[] = ['healthy', 'degraded', 'down', 'unknown'];
	const total = domains.length;

	const slices: DistributionSlice[] = order.map((status) => {
		const count = domains.filter((d) => d.status === status).length;
		return {
			status,
			label: STATUS_LABELS[status],
			count,
			percentage: total === 0 ? 0 : Math.round((count / total) * 100)
		};
	});

	return { total, slices };
}
