import type { HealthStatus, Series, TimeSeries } from '$lib/platform/types';
import type { PromMatrix, PromVector } from './client';

/**
 * Prometheus answers into our shapes.
 *
 * Pure. Everything here takes a parsed response and returns a fact — no fetching, no
 * clock, no formatting beyond the axis labels a series carries because only the source
 * knows what its buckets are.
 */

/**
 * A Prometheus sample value.
 *
 * Values arrive as strings to preserve precision, and `NaN` is a legitimate answer —
 * `histogram_quantile` over an empty bucket returns it. Treating that as a number would
 * put NaN into arithmetic that silently poisons every figure downstream, so it becomes
 * zero here, once, where the decision is visible.
 */
export function sampleValue(raw: string): number {
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** A clock label for a bucket, chosen to suit the window it belongs to. */
export function bucketLabel(atSeconds: number, spanSeconds: number): string {
	const date = new Date(atSeconds * 1000);

	// Beyond a couple of days a clock time tells a reader nothing — two points a day
	// apart would both read "14:00".
	if (spanSeconds > 2 * 86_400) {
		return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	}

	return date.toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC'
	});
}

function boundsOf(values: number[]): { min: number; max: number } {
	if (values.length === 0) return { min: 0, max: 0 };
	return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * The first series of a matrix, as a `TimeSeries`.
 *
 * An empty matrix yields an empty series rather than throwing: a service with no traffic
 * in the window is an ordinary answer, and the chart draws an empty axis for it.
 */
export function toTimeSeries(
	matrix: PromMatrix,
	id: string,
	label: string,
	spanSeconds: number
): TimeSeries {
	const first = matrix.result[0];
	const points = (first?.values ?? []).map(([at, raw]) => ({
		label: bucketLabel(at, spanSeconds),
		value: sampleValue(raw)
	}));

	return { id, label, points, ...boundsOf(points.map((one) => one.value)) };
}

/**
 * Every series of a matrix, named by one of its labels.
 *
 * Sorted by the label so a stacked chart's bands keep their order between renders — a
 * legend that reshuffles on refresh reports change that did not happen.
 */
export function toTimeSeriesByLabel(
	matrix: PromMatrix,
	labelKey: string,
	spanSeconds: number,
	limit = 8
): TimeSeries[] {
	return matrix.result
		.map((row) => {
			const name = row.metric[labelKey] ?? 'unknown';
			const points = row.values.map(([at, raw]) => ({
				label: bucketLabel(at, spanSeconds),
				value: sampleValue(raw)
			}));

			return { id: name, label: name, points, ...boundsOf(points.map((one) => one.value)) };
		})
		.sort((a, b) => a.id.localeCompare(b.id))
		.slice(0, limit);
}

/** A matrix's first series as raw samples, for a sparkline. */
export function toSeries(matrix: PromMatrix): Series {
	const values = (matrix.result[0]?.values ?? []).map(([, raw]) => sampleValue(raw));
	return { values, ...boundsOf(values) };
}

/** The single value of an instant query, or a stated fallback when nothing matched. */
export function scalarOf(vector: PromVector, fallback = 0): number {
	const first = vector.result[0];
	return first ? sampleValue(first.value[1]) : fallback;
}

/** An instant query's values keyed by one of its labels. */
export function scalarsByLabel(vector: PromVector, labelKey: string): Map<string, number> {
	const found = new Map<string, number>();

	for (const row of vector.result) {
		const key = row.metric[labelKey];
		if (key) found.set(key, sampleValue(row.value[1]));
	}

	return found;
}

/**
 * How a latency reading rates.
 *
 * The thresholds live here rather than in the component, because the band a cell falls in
 * and the legend that explains the bands must come from one place — a heatmap whose
 * colours disagree with its key is worse than no heatmap.
 */
export const LATENCY_BANDS = ['> 1s', '500ms – 1s', '200 – 500ms', '< 200ms'] as const;

export function latencyBand(milliseconds: number): number {
	if (milliseconds > 1000) return 0;
	if (milliseconds > 500) return 1;
	if (milliseconds > 200) return 2;
	return 3;
}

/**
 * Health from an error rate and a latency.
 *
 * Stated as thresholds rather than inferred, so the same numbers always produce the same
 * verdict — and so a reader can be told what "degraded" means.
 */
export const HEALTH_THRESHOLDS = {
	errorPctDown: 5,
	errorPctDegraded: 1,
	latencyMsDegraded: 1000
} as const;

export function healthOf(errorPct: number, p95Ms: number): HealthStatus {
	if (errorPct >= HEALTH_THRESHOLDS.errorPctDown) return 'down';
	if (errorPct >= HEALTH_THRESHOLDS.errorPctDegraded) return 'degraded';
	if (p95Ms >= HEALTH_THRESHOLDS.latencyMsDegraded) return 'degraded';
	return 'healthy';
}

/** `up` is 1 or 0 per instance; a service is down only when none of them answers. */
export function healthFromUp(up: Map<string, number>): HealthStatus {
	// No instances reporting at all is `unknown`, not `down`. A service the account has
	// never seen — one the catalog declares and nothing emits for — is not an outage, and
	// calling it one puts a red badge on something nobody has deployed yet.
	if (up.size === 0) return 'unknown';

	const answering = [...up.values()].filter((one) => one > 0).length;
	if (answering === 0) return 'down';
	if (answering < up.size) return 'degraded';
	return 'healthy';
}
