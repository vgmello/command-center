import { formatCompact, formatLatency, formatPercent } from './format';
import type { IncidentSeverity, MetricInsight } from './types';

/**
 * Insights derived from metrics, by stated arithmetic.
 *
 * This is the difference between an insight and an opinion. Every finding here is a
 * number compared against a baseline drawn from the same series, with the rule and the
 * threshold written down — so a reader can be told *why* something was flagged, and two
 * providers cannot disagree about what "anomalous" means.
 *
 * Pure, and shared by every APM adapter rather than reimplemented in each, for the same
 * reason the deployment aggregates are.
 */

/** How a metric's value should read, and which direction is bad. */
export type MetricKind = 'rate' | 'percent' | 'duration-ms';

export interface MetricObservation {
	id: string;
	label: string;
	kind: MetricKind;
	/** What it was measured on — a service, an endpoint, an instance. */
	affects: string;
	/**
	 * The window, oldest first. The tail is the current reading; everything before it is
	 * the baseline it is judged against.
	 */
	values: number[];
	/** Higher is worse for latency and errors; for throughput a drop is the concern. */
	direction: 'higher-is-worse' | 'lower-is-worse';
}

/**
 * The rules, stated so they can be described to a reader and changed in one place.
 *
 * `sigma` is how far from the baseline mean a reading must sit to be called an anomaly.
 * Two and a half standard deviations is roughly the 99th percentile of a normal
 * distribution — rare enough to be worth a person's attention, common enough that a real
 * incident is not missed.
 *
 * `minSamples` exists because a standard deviation over three points is noise dressed as
 * statistics. Below it, nothing is flagged at all.
 *
 * `minRelative` stops a metric that is merely *stable* from tripping the sigma test: a
 * latency that sits at exactly 100ms for an hour has a standard deviation near zero, and
 * 101ms is then twenty sigma away. A reading must also move by a visible fraction.
 */
export const INSIGHT_RULES = {
	anomalySigma: 2.5,
	watchSigma: 1.5,
	minSamples: 8,
	minRelative: 0.15,
	/**
	 * The move a series with no historical spread must make to be flagged.
	 *
	 * A perfectly flat baseline has no standard deviation, so sigma cannot judge it at
	 * all — and a metric pinned at one value for hours then jumping eightfold is exactly
	 * the event worth catching. The relative test stands in, at a higher bar.
	 */
	flatRelative: 0.5,
	/** Above this share of the fleet's worst, a service is called out by name. */
	fleetOutlierShare: 0.6
} as const;

export interface Baseline {
	mean: number;
	stdDev: number;
	samples: number;
}

/** Mean and spread of everything but the current reading. */
export function baselineOf(values: number[]): Baseline {
	const history = values.slice(0, -1);
	if (history.length === 0) return { mean: 0, stdDev: 0, samples: 0 };

	const mean = history.reduce((sum, one) => sum + one, 0) / history.length;
	const variance = history.reduce((sum, one) => sum + (one - mean) ** 2, 0) / history.length;

	return { mean, stdDev: Math.sqrt(variance), samples: history.length };
}

/**
 * How many standard deviations the current reading sits from its baseline.
 *
 * A flat baseline has no spread to measure against, so it reports zero rather than
 * infinity — the relative test below is what catches a genuine move in that case.
 */
export function sigmaOf(current: number, baseline: Baseline): number {
	if (baseline.stdDev === 0) return 0;
	return (current - baseline.mean) / baseline.stdDev;
}

/** Signed fractional change against the baseline mean. */
export function relativeChange(current: number, baseline: Baseline): number {
	if (baseline.mean === 0) return current === 0 ? 0 : 1;
	return (current - baseline.mean) / baseline.mean;
}

export function formatMetric(value: number, kind: MetricKind): string {
	if (kind === 'percent') return formatPercent(value, 2);
	if (kind === 'duration-ms') {
		const { value: printed, unit } = formatLatency(value);
		return `${printed}${unit}`;
	}
	return `${formatCompact(value)} req/s`;
}

/** The current reading of a window. */
export function currentOf(values: number[]): number {
	return values.at(-1) ?? 0;
}

function severityFor(
	sigma: number,
	direction: MetricObservation['direction']
): IncidentSeverity | null {
	// A move in the good direction is not an incident. It may still be worth knowing,
	// which is what `kind: 'insight'` is for.
	const bad = direction === 'higher-is-worse' ? sigma : -sigma;

	if (bad >= INSIGHT_RULES.anomalySigma) return 'critical';
	if (bad >= INSIGHT_RULES.watchSigma) return 'warning';
	return null;
}

/**
 * One observation's finding, or nothing.
 *
 * Both tests must pass: the reading has to be statistically unusual *and* to have moved
 * by a visible amount. Either alone produces the two classic false positives — a flat
 * series where any wobble is many sigma, and a noisy series where a large move is
 * ordinary.
 */
export function insightFor(
	observation: MetricObservation,
	now: Date,
	windowLabel: string
): MetricInsight | null {
	const baseline = baselineOf(observation.values);
	if (baseline.samples < INSIGHT_RULES.minSamples) return null;

	const current = currentOf(observation.values);
	const sigma = sigmaOf(current, baseline);
	const relative = relativeChange(current, baseline);

	// A flat baseline is judged on the size of the move alone, because sigma cannot see
	// it: with no spread there is nothing to be standard deviations away from.
	const flat = baseline.stdDev === 0;
	const worseDirection = observation.direction === 'higher-is-worse' ? relative > 0 : relative < 0;

	const severity = flat
		? worseDirection && Math.abs(relative) >= INSIGHT_RULES.flatRelative
			? 'critical'
			: null
		: severityFor(sigma, observation.direction);

	if (!severity) return null;
	if (Math.abs(relative) < INSIGHT_RULES.minRelative) return null;

	const rose = current > baseline.mean;
	const verb = rose ? 'above' : 'below';

	return {
		id: observation.id,
		kind: severity === 'critical' ? 'anomaly' : 'insight',
		severity,
		title: `${observation.label} ${rose ? 'up' : 'down'} on ${observation.affects}`,
		detail:
			`${formatMetric(current, observation.kind)}, ` +
			`${Math.abs(Math.round(relative * 100))}% ${verb} its ${windowLabel} mean of ` +
			`${formatMetric(baseline.mean, observation.kind)}` +
			// A sigma against a flat baseline would be a made-up number, so it is omitted
			// rather than printed as zero.
			(flat ? ' (previously steady)' : ` (${Math.abs(sigma).toFixed(1)}σ)`),
		affects: observation.affects,
		startedAt: now.toISOString()
	};
}

/** Every finding across a set of observations, worst first. */
export function deriveInsights(
	observations: MetricObservation[],
	now: Date,
	windowLabel: string
): MetricInsight[] {
	const rank: Record<IncidentSeverity, number> = { critical: 0, warning: 1, info: 2 };

	return observations
		.map((one) => insightFor(one, now, windowLabel))
		.filter((one): one is MetricInsight => one !== null)
		.sort((a, b) => rank[a.severity] - rank[b.severity] || a.affects.localeCompare(b.affects));
}

/**
 * Findings across a fleet, which is the question a per-service view cannot answer.
 *
 * Two things are true at the aggregate level that are invisible one service at a time.
 * A service can be well inside its own historical range and still be the worst in the
 * estate — that is a *cross-sectional* outlier, found by comparing services to each
 * other rather than to their own past. And several services moving together is a
 * different event from one moving alone: it usually means something underneath them
 * moved, and it is worth saying so in one line rather than as five separate alarms.
 */
export function deriveFleetInsights(
	metric: {
		id: string;
		label: string;
		kind: MetricKind;
		direction: MetricObservation['direction'];
	},
	perService: { service: string; values: number[] }[],
	now: Date,
	windowLabel: string
): MetricInsight[] {
	const insights: MetricInsight[] = [];

	const readings = perService
		.map((one) => ({ service: one.service, current: currentOf(one.values) }))
		.filter((one) => Number.isFinite(one.current));

	if (readings.length >= 3) {
		const worst = readings.reduce((leader, one) =>
			metric.direction === 'higher-is-worse'
				? one.current > leader.current
					? one
					: leader
				: one.current < leader.current
					? one
					: leader
		);

		const others = readings.filter((one) => one.service !== worst.service);
		const median = [...others.map((one) => one.current)].sort((a, b) => a - b)[
			Math.floor(others.length / 2)
		];

		// Called out only when it is far from the pack, not merely first in a close race:
		// the top of any list is always something, and naming it regardless would make
		// the panel noise.
		const apart =
			median === 0
				? worst.current > 0
				: Math.abs(worst.current - median) / Math.abs(median) >= INSIGHT_RULES.fleetOutlierShare;

		if (apart) {
			insights.push({
				id: `fleet-${metric.id}`,
				kind: 'insight',
				severity: 'warning',
				title: `${worst.service} leads the estate on ${metric.label.toLowerCase()}`,
				detail:
					`${formatMetric(worst.current, metric.kind)} against a fleet median of ` +
					`${formatMetric(median, metric.kind)} across ${readings.length} services`,
				affects: worst.service,
				startedAt: now.toISOString()
			});
		}
	}

	// Several services moving at once. Reported as one finding rather than as one per
	// service, because the shared cause is the thing worth knowing.
	const moved = perService.filter((one) => {
		const baseline = baselineOf(one.values);
		if (baseline.samples < INSIGHT_RULES.minSamples) return false;

		const sigma = sigmaOf(currentOf(one.values), baseline);
		const bad = metric.direction === 'higher-is-worse' ? sigma : -sigma;

		return (
			bad >= INSIGHT_RULES.watchSigma &&
			Math.abs(relativeChange(currentOf(one.values), baseline)) >= INSIGHT_RULES.minRelative
		);
	});

	if (moved.length >= 3) {
		insights.push({
			id: `fleet-${metric.id}-correlated`,
			kind: 'anomaly',
			severity: 'critical',
			title: `${metric.label} moved on ${moved.length} services together`,
			detail:
				`${moved
					.slice(0, 4)
					.map((one) => one.service)
					.join(', ')}${moved.length > 4 ? ` and ${moved.length - 4} more` : ''} ` +
				`all left their ${windowLabel} range at once, which usually means something beneath them did`,
			affects: `${moved.length} services`,
			startedAt: now.toISOString()
		});
	}

	return insights;
}
