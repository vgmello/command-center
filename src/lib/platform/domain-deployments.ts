import type { DomainDeploymentStats, ServiceDeployShare, ServiceTrend, TimeSeries } from './types';

/**
 * Deployment figures summed from per-service series — a domain's, or the whole estate's.
 *
 * The arithmetic is the whole point of this module, and both halves of it are mistakes
 * this codebase has already made once: a mean rebuilt from means weights a day of two runs
 * the same as a day of two hundred, and a rate rebuilt from rates does the same to a
 * service that deployed twice beside one that deployed a hundred times.
 *
 * Both callers sum the same rows, which is why they live together: the estate figure is
 * the sum over every service and a domain's is the sum over the ones it owns, so the
 * deployments page and a domain tab cannot tell different stories about one set of runs.
 */
export function rollUpDeployments(rows: ServiceTrend[], services: string[]): DomainDeploymentStats {
	const owned = rows.filter((row) => services.includes(row.service));
	const sum = (points: Array<{ value: number }>) =>
		points.reduce((total, one) => total + one.value, 0);

	const total = owned.reduce((count, row) => count + sum(row.runs.points), 0);
	const failures = owned.reduce((count, row) => count + sum(row.failures.points), 0);
	const durationTotal = owned.reduce((count, row) => count + sum(row.durationTotal.points), 0);

	const byService: ServiceDeployShare[] = owned
		.map((row) => {
			const runs = sum(row.runs.points);
			const failed = sum(row.failures.points);

			return {
				service: row.service,
				total: runs,
				failures: failed,
				changeFailureRatePct: runs === 0 ? 0 : (failed / runs) * 100,
				frequency: row.runs
			};
		})
		.sort((a, b) => b.changeFailureRatePct - a.changeFailureRatePct || b.total - a.total);

	return {
		total,
		failures,
		changeFailureRatePct: total === 0 ? 0 : (failures / total) * 100,
		// Sum of durations over sum of runs, not the mean of the services' means.
		meanDurationSeconds: total === 0 ? 0 : Math.round(durationTotal / total),
		frequency: combine(owned.map((row) => row.runs)),
		byService
	};
}

/**
 * Add the services' series bucket by bucket.
 *
 * They share an axis because they were written against one set of buckets, so the labels
 * of the longest series are the domain's labels and a shorter one contributes what it has.
 */
function combine(series: TimeSeries[]): TimeSeries {
	const longest = series.reduce<TimeSeries | null>(
		(best, one) => (!best || one.points.length > best.points.length ? one : best),
		null
	);

	if (!longest) {
		return { id: 'frequency', label: 'Deployments', points: [], min: 0, max: 0 };
	}

	const points = longest.points.map((point, index) => ({
		label: point.label,
		value: series.reduce((total, one) => total + (one.points[index]?.value ?? 0), 0)
	}));

	return {
		id: 'frequency',
		label: 'Deployments',
		points,
		min: 0,
		max: Math.max(...points.map((one) => one.value), 0)
	};
}

/**
 * The estate's trends, collapsed from the same per-service rows a domain sums.
 *
 * The deployments page wants one count and one mean per bucket; this is that, summed over
 * every service rather than over a domain's. Deriving it here rather than reading a
 * separate estate-wide capability is what makes `estate == sum(services)` true by
 * construction instead of by coincidence.
 *
 * The mean is the summed duration over the summed runs, for the reason stated above. Runs
 * still in flight have no duration and so contribute to the denominator without the
 * numerator — the same approximation the stored estate trends already made, and a
 * bucket's worth of in-flight runs is the only case where it shows.
 */
export function estateTrendsOf(rows: ServiceTrend[]): {
	frequency: TimeSeries;
	meanDuration: TimeSeries;
} {
	const frequency = combine(rows.map((row) => row.runs));
	const totals = combine(rows.map((row) => row.durationTotal));

	const points = frequency.points.map((point, index) => ({
		label: point.label,
		value: point.value === 0 ? 0 : Math.round((totals.points[index]?.value ?? 0) / point.value)
	}));

	return {
		frequency,
		meanDuration: {
			id: 'mean-duration',
			label: 'Mean duration',
			points,
			min: 0,
			max: Math.max(...points.map((one) => one.value), 0)
		}
	};
}
