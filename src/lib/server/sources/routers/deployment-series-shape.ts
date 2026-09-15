import type { Capability } from '$lib/platform/sources';
import type { ServiceTrend, TimeSeries, TrendGrain } from '$lib/platform/types';
import type { StoredSample } from '../../store/source-store';
import { SEPARATOR, downsample, geometryFor, type SeriesKey } from '../series';

/**
 * How the deployment trends come apart into samples, and go back together.
 *
 * Both capabilities are counts of runs bucketed by day, which is what makes them worth
 * accumulating: `daily`, `weekly` and `monthly` are three renderings of one set of facts,
 * and stored as whole answers they key on the grain and share nothing. A reader switching
 * from daily to weekly pays for a fresh four-hundred-row window to see the same runs
 * counted differently.
 *
 * Two things about this decomposition differ from the metrics one, and both would be wrong
 * if copied from it.
 *
 * **Counts are additive, so they sum.** `downsample` averages by default, which is right
 * for a CPU reading and wrong here: a week that averaged its days would report a seventh
 * of the deployments that happened.
 *
 * **A mean cannot be re-aggregated from means.** `meanDuration` is stored decomposed as a
 * total and a count, and the mean rebuilt by dividing the sums. Averaging a day of two runs
 * with a day of two hundred weights them equally, which is simply a different number from
 * the mean of the fortnight.
 */

/** How many days each grain looks back — the provider's own `TREND_DAYS`. */
export const TREND_DAYS: Record<TrendGrain, number> = { daily: 14, weekly: 84, monthly: 365 };

/** How many buckets each grain draws across its window. */
const GRAIN_DAYS: Record<TrendGrain, number> = { daily: 1, weekly: 7, monthly: 28 };

type TrendsAnswer = { frequency: TimeSeries; meanDuration: TimeSeries };

/**
 * Spread a series' points across the window it was drawn for.
 *
 * A `TimeSeries` carries labels, not instants — the provider formatted them for an axis.
 * Recovering the times is safe because the provider was asked for an explicit window at an
 * explicit step, so the points it returned are that window, in order.
 */
function timestamps(count: number, window: { from: Date; to: Date }): Date[] {
	if (count <= 0) return [];
	if (count === 1) return [window.to];

	const span = window.to.getTime() - window.from.getTime();
	const step = span / (count - 1);

	return Array.from(
		{ length: count },
		(_, index) => new Date(window.from.getTime() + index * step)
	);
}

/** The axis label for a bucket, matching what the charts already print. */
function labelFor(grain: TrendGrain): (at: Date) => string {
	if (grain === 'monthly') {
		return (at) => at.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
	}

	return (at) =>
		at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function seriesOf(id: string, label: string, points: Array<{ label: string; value: number }>) {
	const values = points.map((one) => one.value);
	return { id, label, points, min: 0, max: values.length ? Math.max(...values) : 0 };
}

/**
 * Rebuild one named series from its samples, summed into the grain's buckets.
 *
 * `entity` is the first half of the stored key — `''` for the estate-wide trends, a
 * service name for the per-service ones — so the same helper serves both shapes rather
 * than each keeping its own copy of the downsampling arithmetic.
 */
function rebuildSeries(
	groups: Map<string, StoredSample[]>,
	entity: string,
	metric: string,
	window: { from: Date; to: Date },
	grain: TrendGrain,
	capability: Capability = 'deployment.trends'
): Array<{ at: Date; value: number }> {
	const samples = groups.get(`${entity}${SEPARATOR}${metric}`) ?? [];
	const geometry = geometryFor(capability);
	const days = Math.max(
		Math.round((window.to.getTime() - window.from.getTime()) / (86_400 * 1000)),
		1
	);

	return downsample(samples, window.from, window.to, Math.ceil(days / GRAIN_DAYS[grain]), {
		aggregate: 'sum',
		bucketSeconds: geometry.bucketSeconds
	});
}

/**
 * `deployment.trends`: run count and mean duration over time.
 *
 * The mean travels as its two halves, which is the whole reason this is not a copy of the
 * metrics shape.
 */
export function trendsShape(grain: TrendGrain) {
	return {
		flatten(
			answer: TrendsAnswer,
			window: { from: Date; to: Date }
		): Array<{ key: SeriesKey; points: Array<{ at: Date; value: number }> }> {
			const times = timestamps(answer.frequency.points.length, window);
			const counts = answer.frequency.points.map((point, index) => ({
				at: times[index],
				value: point.value
			}));

			// The provider reports a mean per bucket; the total is that mean times the runs
			// in the bucket, which is exactly what has to be summed to rebuild it.
			const totals = answer.meanDuration.points.map((point, index) => ({
				at: times[index],
				value: point.value * (answer.frequency.points[index]?.value ?? 0)
			}));

			return [
				{ key: { entity: '', metric: 'run_count' }, points: counts },
				{ key: { entity: '', metric: 'duration_total' }, points: totals }
			];
		},

		rebuild(groups: Map<string, StoredSample[]>, window: { from: Date; to: Date }): TrendsAnswer {
			const counts = rebuildSeries(groups, '', 'run_count', window, grain);
			const totals = rebuildSeries(groups, '', 'duration_total', window, grain);
			const label = labelFor(grain);

			return {
				frequency: seriesOf(
					'frequency',
					'Deployments',
					counts.map((one) => ({ label: label(one.at), value: one.value }))
				),
				meanDuration: seriesOf(
					'mean-duration',
					'Mean duration',
					counts.map((one, index) => ({
						label: label(one.at),
						// Sum of durations over sum of runs. Dividing here rather than
						// averaging stored means is what keeps a fortnight's figure right
						// when its days had wildly different run counts.
						value: one.value === 0 ? 0 : Math.round((totals[index]?.value ?? 0) / one.value)
					}))
				)
			};
		}
	};
}

/** The three statuses the trend plots, and the labels the chart prints. */
const STATUSES: Array<[string, string]> = [
	['success', 'Successful'],
	['failed', 'Failed'],
	['in-progress', 'In progress']
];

/** `deployment.statusTrend`: three counts per bucket, all additive. */
export function statusTrendShape(grain: TrendGrain = 'daily') {
	return {
		flatten(
			answer: TimeSeries[],
			window: { from: Date; to: Date }
		): Array<{ key: SeriesKey; points: Array<{ at: Date; value: number }> }> {
			return answer.map((series) => {
				const times = timestamps(series.points.length, window);

				return {
					key: { entity: '', metric: series.id },
					points: series.points.map((point, index) => ({ at: times[index], value: point.value }))
				};
			});
		},

		rebuild(groups: Map<string, StoredSample[]>, window: { from: Date; to: Date }): TimeSeries[] {
			const label = labelFor(grain);

			return STATUSES.map(([id, name]) => {
				const points = rebuildSeries(groups, '', id, window, grain);

				return seriesOf(
					id,
					name,
					points.map((one) => ({ label: label(one.at), value: one.value }))
				);
			});
		}
	};
}

/**
 * `deployment.serviceTrends`: the same runs as the estate trends, keyed per service.
 *
 * Three metrics rather than two. A change failure rate is a headline on the domain tab and
 * a rate cannot be re-aggregated from rates, so the failures travel as their own count and
 * the rate is divided out after both have been summed.
 */
export function serviceTrendsShape(grain: TrendGrain) {
	return {
		flatten(
			answer: ServiceTrend[],
			window: { from: Date; to: Date }
		): Array<{ key: SeriesKey; points: Array<{ at: Date; value: number }> }> {
			return answer.flatMap((row) => {
				const times = timestamps(row.runs.points.length, window);
				const at = (points: typeof row.runs.points) =>
					points.map((point, index) => ({ at: times[index], value: point.value }));

				return [
					{ key: { entity: row.service, metric: 'run_count' }, points: at(row.runs.points) },
					{
						key: { entity: row.service, metric: 'failure_count' },
						points: at(row.failures.points)
					},
					{
						key: { entity: row.service, metric: 'duration_total' },
						points: at(row.durationTotal.points)
					}
				];
			});
		},

		rebuild(groups: Map<string, StoredSample[]>, window: { from: Date; to: Date }): ServiceTrend[] {
			// The entity is the first half of every stored key, so the services present are
			// read back off the store rather than assumed from a catalog that may have moved
			// on since the rows were written.
			const services = [...new Set([...groups.keys()].map((key) => key.split(SEPARATOR)[0]))]
				.filter((one) => one !== '')
				.sort();

			const label = labelFor(grain);
			const read = (service: string, metric: string) =>
				rebuildSeries(groups, service, metric, window, grain, 'deployment.serviceTrends');

			return services.map((service) => {
				const runs = read(service, 'run_count');
				const failures = read(service, 'failure_count');
				const totals = read(service, 'duration_total');
				const points = (values: Array<{ at: Date; value: number }>) =>
					values.map((one) => ({ label: label(one.at), value: one.value }));

				return {
					service,
					runs: seriesOf('runs', 'Deployments', points(runs)),
					failures: seriesOf('failures', 'Failures', points(failures)),
					durationTotal: seriesOf('duration-total', 'Duration total', points(totals))
				};
			});
		}
	};
}
