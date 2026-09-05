import type { Capability } from '$lib/platform/sources';
import type { TimeRangeId, TimeSeries } from '$lib/platform/types';
import type { StoredSample } from '../store/source-store';

/**
 * Accumulating series rather than caching them.
 *
 * A closed bucket never changes, so re-reading yesterday's is pure waste — and a
 * twenty-four-hour chart on a thirty-second refresh re-fetches a day of settled history
 * 2,880 times a day. Stored as samples, a fifteen-minute view and a twenty-four-hour view
 * read the same rows and a refresh asks only for the newest bucket.
 *
 * Everything here is pure. The store and the provider are somebody else's problem.
 */

/**
 * The resolution everything is stored at.
 *
 * One canonical size, not whatever step the current query wanted. Storing at the query's
 * step is the trap: a fifteen-minute view writes 37-second buckets and a seven-day view
 * writes 25,200-second ones, they share no rows, and the whole benefit is lost.
 */
export const BUCKET_SECONDS = 60;

/**
 * How long a bucket stays revisable.
 *
 * Metrics backends backfill, so the newest buckets can still change. Persisting one as
 * final the instant its window closes bakes a wrong number in permanently — which is
 * worse than not persisting it at all.
 */
export const SETTLING_SECONDS = 300;

/**
 * How far back each time range looks, in seconds.
 *
 * Here rather than in a provider: which window a range means is the app's own vocabulary,
 * and the shared router needs it without reaching into Coralogix's PromQL module.
 */
export const RANGE_SECONDS: Record<TimeRangeId, number> = {
	'5m': 5 * 60,
	'15m': 15 * 60,
	'1h': 60 * 60,
	'6h': 6 * 60 * 60,
	'24h': 24 * 60 * 60,
	'7d': 7 * 24 * 60 * 60
};

/** The longest window served from the store; beyond this, ask the source directly. */
export const MAX_STORED_SECONDS = 24 * 60 * 60;

/** Round down to the canonical grid, so every writer lands on the same buckets. */
export function alignBucket(at: Date): Date {
	const ms = BUCKET_SECONDS * 1000;
	return new Date(Math.floor(at.getTime() / ms) * ms);
}

/** One series, identified the way the store keys it. */
export interface SeriesKey {
	entity: string;
	metric: string;
}

/**
 * Turn a set of named series into samples.
 *
 * The label a point carries is not stored: it is derived from the bucket time and the
 * window being drawn, so keeping it would mean a sample rendered for one window could not
 * be reused for another — which is the point of storing samples at all.
 */
export function toSamples(
	series: Array<{ key: SeriesKey; points: Array<{ at: Date; value: number }> }>,
	context: { connectionId: string; capability: Capability; environment: string },
	now: Date
): StoredSample[] {
	const settledBefore = now.getTime() - SETTLING_SECONDS * 1000;

	return series.flatMap((one) =>
		one.points.map((point) => ({
			connectionId: context.connectionId,
			capability: context.capability,
			environment: context.environment,
			entity: one.key.entity,
			metric: one.key.metric,
			bucketAt: alignBucket(point.at),
			value: point.value,
			settled: point.at.getTime() < settledBefore
		}))
	);
}

/**
 * The separator inside a group key.
 *
 * Not a space: an entity or a metric is free-form, so `"a b" + "c"` and `"a" + "b c"`
 * would spell the same key — the same collision the cache key was fixed for. A null byte
 * cannot appear in either, so it cannot be spelled by accident. Written as an escape
 * because a literal control character in source is invisible to a reader.
 */
export const SEPARATOR = '\u0000';

/** Samples regrouped by the series they belong to. */
export function groupSamples(samples: StoredSample[]): Map<string, StoredSample[]> {
	const groups = new Map<string, StoredSample[]>();

	for (const sample of samples) {
		const id = `${sample.entity}${SEPARATOR}${sample.metric}`;
		const existing = groups.get(id);

		if (existing) existing.push(sample);
		else groups.set(id, [sample]);
	}

	for (const group of groups.values()) {
		group.sort((a, b) => a.bucketAt.getTime() - b.bucketAt.getTime());
	}

	return groups;
}

/**
 * The window that still has to be fetched, or `null` when the store has it all.
 *
 * A high-water mark, not a completeness check. The obvious implementation — demand every
 * bucket in the range and fetch from the first hole — refetches the whole window forever,
 * because a source legitimately returns fewer points than a window has buckets: a quiet
 * minute has no sample, and a provider may answer at a coarser resolution than it was
 * asked for. Under that rule one permanent hole means permanently re-reading everything.
 *
 * So: trust the settled samples, and fetch forward from the newest of them. A genuine hole
 * in the middle is never backfilled, which is the right answer — a hole almost always
 * means the source had nothing there, and re-asking will produce the same nothing.
 *
 * Everything inside the settling window is refetched regardless, because a late sample can
 * still revise it.
 */
export function gapFor(
	stored: StoredSample[],
	want: { from: Date; to: Date },
	now: Date
): { from: Date; to: Date } | null {
	const settledBefore = now.getTime() - SETTLING_SECONDS * 1000;
	let highWater = 0;

	for (const sample of stored) {
		const at = sample.bucketAt.getTime();
		if (sample.settled && at < settledBefore && at > highWater) highWater = at;
	}

	// Nothing trusted at all: the store is cold for this series.
	if (highWater === 0) return { from: alignBucket(want.from), to: want.to };

	const from = new Date(highWater + BUCKET_SECONDS * 1000);

	// The trusted history already reaches the present. Nothing to ask for.
	if (from.getTime() > want.to.getTime()) return null;

	// Never ask for less than the window wants: a store holding only ancient samples must
	// not narrow the fetch to a range the caller did not ask about.
	return {
		from: new Date(Math.max(from.getTime(), alignBucket(want.from).getTime())),
		to: want.to
	};
}

/**
 * Reduce samples to the number of points a chart can draw.
 *
 * Sixty-second buckets over a day is 1,440 points for a chart a few hundred pixels wide.
 * Averaging within each output bucket keeps the shape while cutting what travels — and
 * the alternative, storing at the display resolution, is what makes windows unshareable.
 */
export function downsample(
	samples: StoredSample[],
	from: Date,
	to: Date,
	points: number
): Array<{ at: Date; value: number }> {
	if (samples.length === 0 || points <= 0) return [];

	const span = Math.max(to.getTime() - from.getTime(), 1);
	const width = Math.max(span / points, BUCKET_SECONDS * 1000);
	const buckets = new Map<number, { total: number; count: number }>();

	for (const sample of samples) {
		const slot = Math.floor((sample.bucketAt.getTime() - from.getTime()) / width);
		const bucket = buckets.get(slot) ?? { total: 0, count: 0 };

		bucket.total += sample.value;
		bucket.count += 1;
		buckets.set(slot, bucket);
	}

	return [...buckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([slot, bucket]) => ({
			at: new Date(from.getTime() + slot * width),
			value: bucket.total / bucket.count
		}));
}

/** Turn a series' points back into the shape a chart draws. */
export function toTimeSeries(
	id: string,
	label: string,
	points: Array<{ at: Date; value: number }>,
	labelFor: (at: Date) => string
): TimeSeries {
	const values = points.map((one) => one.value);

	return {
		id,
		label,
		points: points.map((one) => ({ label: labelFor(one.at), value: one.value })),
		min: values.length ? Math.min(...values) : 0,
		max: values.length ? Math.max(...values) : 0
	};
}
