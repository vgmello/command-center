import type { Capability } from '$lib/platform/sources';

/**
 * Which of the three kinds each capability is.
 *
 * The TTL table ranks capabilities by volatility but treats them all as a blob with an
 * expiry. They are three different things, and only two of them are worth persisting.
 * See `docs/superpowers/specs/2026-09-04-source-store-design.md`.
 *
 * - **live** — what is happening now. Never persisted: read back off disk it is already
 *   stale, and a row written every thirty seconds for a number nobody will read again is
 *   cost without benefit.
 * - **reference** — inventory that changes on a human timescale. Persisted, and where a
 *   low rate limit hurts most, because these are the expensive list calls.
 * - **series** — windows over time. Persisted as accumulated samples rather than as whole
 *   answers, because a closed bucket never changes.
 *
 * Every capability is listed rather than defaulted, so adding one is a compile error
 * instead of a silent inheritance of whichever tier happened to be the fallback.
 */
export type CapabilityTier = 'live' | 'reference' | 'series';

export const CAPABILITY_TIER: Record<Capability, CapabilityTier> = {
	// Live: the current reading, wanted fresh.
	'apm.serviceStats': 'live',
	'apm.serviceHealth': 'live',
	'apm.healthChecks': 'live',
	'apm.requestRate': 'live',
	'apm.rates': 'live',
	'apm.domainVitals': 'live',
	'cloud.utilization': 'live',
	'cloud.alerts': 'live',
	'deployment.log': 'live',

	// Reference: inventory and analysis that move slowly.
	'cloud.regions': 'reference',
	'cloud.nodes': 'reference',
	'cloud.clusters': 'reference',
	'cloud.databases': 'reference',
	'cloud.queues': 'reference',
	'cloud.storage': 'reference',
	'cloud.cost': 'reference',
	'apm.endpoints': 'reference',
	'apm.dependencies': 'reference',
	'apm.slo': 'reference',
	'apm.incidents': 'reference',
	'apm.insights': 'reference',
	'apm.platformInsights': 'reference',
	'deployment.summary': 'reference',
	'deployment.breakdown': 'reference',
	'deployment.domains': 'reference',
	'deployment.insights': 'reference',

	// Series: accumulated buckets. Persisted as samples by the series path, not as
	// documents — a whole-answer copy would key on the window and share nothing between
	// a fifteen-minute view and a twenty-four-hour one.
	'apm.metricSeries': 'series',
	'apm.latencyHeatmap': 'series',
	'deployment.trends': 'series',
	'deployment.statusTrend': 'series'
};

/** Whether an answer to this capability is worth keeping past the process. */
export function isPersisted(capability: Capability): boolean {
	return CAPABILITY_TIER[capability] !== 'live';
}

/**
 * Whether it is stored as whole answers rather than as samples.
 *
 * Series are excluded because they have their own path: storing a window's whole answer
 * would key on the window, and the point of accumulating samples is that windows overlap.
 */
export function isDocument(capability: Capability): boolean {
	return CAPABILITY_TIER[capability] === 'reference';
}
