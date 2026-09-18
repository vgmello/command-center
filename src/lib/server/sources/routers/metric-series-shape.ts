import type { PlatformScope } from '$lib/platform/query';
import type { TimeSeries } from '$lib/platform/types';
import type { StoredSample } from '../../store/source-store';
import { RANGE_SECONDS, SEPARATOR, downsample, toTimeSeries, type SeriesKey } from '../series';

/**
 * How the metrics tab's answer comes apart into samples, and goes back together.
 *
 * Declared rather than inferred. The six series are not one uniform list: three are single
 * series about the service, and three are *families* — one per endpoint, per instance, per
 * saturation metric — so a generic decomposition would be a guess about all of them.
 *
 * What is stored is `(entity, metric)` and a number. Everything else a chart needs — the
 * axis labels, the ordering, the bounds — is recomputed for the window being drawn, which
 * is exactly why a sample fetched for a fifteen-minute view can be reused for a
 * twenty-four-hour one.
 */

type MetricSeriesAnswer = {
	requestRate: TimeSeries;
	p95Latency: TimeSeries;
	errorRate: TimeSeries;
	saturation: TimeSeries[];
	byEndpoint: TimeSeries[];
	byInstance: TimeSeries[];
};

/** The service's own readings, as opposed to a per-endpoint or per-instance one. */
const SERVICE_METRICS = {
	requestRate: 'request_rate',
	p95Latency: 'p95',
	errorRate: 'error_rate'
} as const;

/** Families are stored under one metric name, one row per member. */
const FAMILY_METRICS = {
	saturation: 'saturation',
	byEndpoint: 'endpoint_rate',
	byInstance: 'instance_p95'
} as const;

/**
 * Spread a series' points evenly across the window it was drawn for.
 *
 * A `TimeSeries` carries labels, not timestamps — the provider formatted them for a
 * particular axis. Recovering the instants is what lets the points become samples at all,
 * and it is safe because the provider was asked for an explicit window at an explicit
 * step: the points it returned are that window, in order.
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

/** A clock label for a bucket, matching what the charts already print. */
function labelFor(spanSeconds: number): (at: Date) => string {
	// Beyond a couple of days a clock time tells a reader nothing: two points a day apart
	// would both read "14:00".
	if (spanSeconds > 2 * 86_400) {
		return (at) =>
			at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	}

	return (at) =>
		at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function membersOf(
	groups: Map<string, StoredSample[]>,
	metric: string
): Array<{ entity: string; samples: StoredSample[] }> {
	return [...groups.entries()]
		.filter(([id]) => id.endsWith(`${SEPARATOR}${metric}`))
		.map(([id, samples]) => ({ entity: id.split(SEPARATOR)[0], samples }))
		.sort((a, b) => a.entity.localeCompare(b.entity));
}

/** How many points a chart draws, whatever resolution the samples are at. */
const DISPLAY_POINTS = 24;

export function metricSeriesShape(slug: string, scope: PlatformScope) {
	const span = RANGE_SECONDS[scope.timeRange];
	const label = labelFor(span);

	return {
		flatten(answer: MetricSeriesAnswer, window: { from: Date; to: Date }) {
			const flat: Array<{ key: SeriesKey; points: Array<{ at: Date; value: number }> }> = [];

			const spread = (series: TimeSeries, window: { from: Date; to: Date }) =>
				timestamps(series.points.length, window).map((at, index) => ({
					at,
					value: series.points[index].value
				}));

			for (const [field, metric] of Object.entries(SERVICE_METRICS)) {
				const series = answer[field as keyof typeof SERVICE_METRICS];
				flat.push({ key: { entity: slug, metric }, points: spread(series, window) });
			}

			for (const [field, metric] of Object.entries(FAMILY_METRICS)) {
				for (const member of answer[field as keyof typeof FAMILY_METRICS]) {
					flat.push({ key: { entity: member.id, metric }, points: spread(member, window) });
				}
			}

			return flat;
		},

		rebuild(groups: Map<string, StoredSample[]>, window: { from: Date; to: Date }) {
			const single = (metric: string, id: string, name: string) => {
				const samples = groups.get(`${slug}${SEPARATOR}${metric}`) ?? [];
				return toTimeSeries(
					id,
					name,
					downsample(samples, window.from, window.to, DISPLAY_POINTS),
					label
				);
			};

			const family = (metric: string) =>
				membersOf(groups, metric).map((member) =>
					toTimeSeries(
						member.entity,
						member.entity,
						downsample(member.samples, window.from, window.to, DISPLAY_POINTS),
						label
					)
				);

			return {
				requestRate: single('request_rate', 'request-rate', 'Requests / sec'),
				p95Latency: single('p95', 'p95', 'P95 latency (ms)'),
				errorRate: single('error_rate', 'error-rate', 'Error rate (%)'),
				saturation: family('saturation'),
				byEndpoint: family('endpoint_rate'),
				byInstance: family('instance_p95')
			} satisfies MetricSeriesAnswer;
		}
	};
}
