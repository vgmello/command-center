import { describe, expect, test } from 'bun:test';
import {
	BUCKET_SECONDS,
	SETTLING_SECONDS,
	alignBucket,
	downsample,
	gapFor,
	groupSamples,
	toSamples,
	toTimeSeries
} from './series';
import type { StoredSample } from '../store/source-store';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

function stored(overrides: Partial<StoredSample> = {}): StoredSample {
	return {
		connectionId: 'cx',
		capability: 'apm.metricSeries',
		environment: 'production',
		entity: 'payment-api',
		metric: 'p95',
		bucketAt: minutesAgo(30),
		value: 100,
		settled: true,
		...overrides
	};
}

describe('alignBucket', () => {
	test('rounds down to the canonical grid, so every writer lands on the same buckets', () => {
		// Storing at whatever step a query asked for is the trap this exists to avoid.
		const aligned = alignBucket(new Date('2026-09-05T12:00:37.500Z'));
		expect(aligned.toISOString()).toBe('2026-09-05T12:00:00.000Z');
	});

	test('a bucket boundary is already aligned', () => {
		const at = new Date('2026-09-05T12:01:00.000Z');
		expect(alignBucket(at).getTime()).toBe(at.getTime());
	});
});

describe('toSamples', () => {
	const context = {
		connectionId: 'cx',
		capability: 'apm.metricSeries' as const,
		environment: 'production'
	};

	test('flattens named series into rows', () => {
		const samples = toSamples(
			[
				{
					key: { entity: 'payment-api', metric: 'p95' },
					points: [
						{ at: minutesAgo(20), value: 600 },
						{ at: minutesAgo(19), value: 640 }
					]
				}
			],
			context,
			NOW
		);

		expect(samples.length).toBe(2);
		expect(samples[0].entity).toBe('payment-api');
		expect(samples[0].metric).toBe('p95');
	});

	test('an old bucket is settled and a recent one is not', () => {
		// A late sample can still revise the newest buckets; writing them as final is how
		// a wrong number gets baked in permanently.
		const samples = toSamples(
			[
				{
					key: { entity: 'a', metric: 'p95' },
					points: [
						{ at: minutesAgo(30), value: 1 },
						{ at: minutesAgo(1), value: 2 }
					]
				}
			],
			context,
			NOW
		);

		expect(samples[0].settled).toBe(true);
		expect(samples[1].settled).toBe(false);
		expect(SETTLING_SECONDS).toBeGreaterThan(60);
	});

	test('the axis label is not stored, because it belongs to a window', () => {
		// Keeping it would mean a sample drawn for one window could not be reused for
		// another, which is the entire point of storing samples.
		const samples = toSamples(
			[{ key: { entity: 'a', metric: 'p95' }, points: [{ at: minutesAgo(10), value: 1 }] }],
			context,
			NOW
		);

		expect(Object.keys(samples[0])).not.toContain('label');
	});
});

describe('groupSamples', () => {
	test('splits by entity and metric, and orders each by time', () => {
		const groups = groupSamples([
			stored({ entity: 'a', metric: 'p95', bucketAt: minutesAgo(1) }),
			stored({ entity: 'a', metric: 'p95', bucketAt: minutesAgo(5) }),
			stored({ entity: 'b', metric: 'p95' }),
			stored({ entity: 'a', metric: 'error_rate' })
		]);

		expect(groups.size).toBe(3);

		const one = groups.get('a\u0000p95')!;
		expect(one[0].bucketAt.getTime()).toBeLessThan(one[1].bucketAt.getTime());
	});

	test('a separator that could be spelled would collide', () => {
		// `"a b" + "c"` and `"a" + "b c"` are different series and must not share a key —
		// the same collision the cache key was fixed for.
		const groups = groupSamples([
			stored({ entity: 'a b', metric: 'c' }),
			stored({ entity: 'a', metric: 'b c' })
		]);

		expect(groups.size).toBe(2);
	});
});

describe('gapFor', () => {
	const want = { from: minutesAgo(60), to: NOW };

	/** Every bucket in a window, settled. */
	function full(fromMinutes: number, toMinutes: number): StoredSample[] {
		const samples: StoredSample[] = [];

		for (let minute = fromMinutes; minute >= toMinutes; minute--) {
			samples.push(stored({ bucketAt: alignBucket(minutesAgo(minute)), settled: true }));
		}

		return samples;
	}

	test('an empty store means fetch the whole window', () => {
		expect(gapFor([], want, NOW)).toEqual({ from: alignBucket(want.from), to: want.to });
	});

	test('a fully settled window still refetches the provisional tail', () => {
		// Everything inside the settling horizon is refetched every time, by design.
		const gap = gapFor(full(60, 0), want, NOW)!;

		expect(gap).not.toBeNull();
		expect(NOW.getTime() - gap.from.getTime()).toBeLessThanOrEqual(SETTLING_SECONDS * 1000);
	});

	test('a warm store fetches minutes rather than an hour', () => {
		// The whole point: a refresh must not re-read a day of settled history.
		const gap = gapFor(full(60, 0), want, NOW)!;
		const fetched = (gap.to.getTime() - gap.from.getTime()) / 60_000;

		expect(fetched).toBeLessThan(10);
	});

	test('a hole in the middle is not backfilled, and does not restart the window', () => {
		// A high-water mark, not a completeness check. Demanding every bucket refetches the
		// whole window forever, because a source legitimately returns fewer points than a
		// window has buckets — a quiet minute simply has no sample. A hole almost always
		// means the source had nothing there, and re-asking produces the same nothing.
		const withHole = full(60, 0).filter(
			(one) => one.bucketAt.getTime() !== alignBucket(minutesAgo(40)).getTime()
		);

		const gap = gapFor(withHole, want, NOW)!;
		const minutes = (gap.to.getTime() - gap.from.getTime()) / 60_000;

		expect(minutes).toBeLessThan(10);
	});

	test('sparse history still narrows the fetch to what follows it', () => {
		// The realistic case: a provider answered at a coarser resolution than the store's,
		// so most buckets are empty. The fetch must still start after the newest sample.
		const sparse = [30, 20, 10].map((minute) =>
			stored({ bucketAt: alignBucket(minutesAgo(minute)), settled: true })
		);

		const gap = gapFor(sparse, want, NOW)!;
		expect(gap.from.getTime()).toBe(alignBucket(minutesAgo(10)).getTime() + 60_000);
	});

	test('an unsettled bucket does not advance the mark', () => {
		// It may still be revised, so it is not history yet.
		const provisional = [
			stored({ bucketAt: alignBucket(minutesAgo(30)), settled: true }),
			stored({ bucketAt: alignBucket(minutesAgo(20)), settled: false })
		];

		const gap = gapFor(provisional, want, NOW)!;
		expect(gap.from.getTime()).toBe(alignBucket(minutesAgo(30)).getTime() + 60_000);
	});

	test('history past the end of the window asks for nothing at all', () => {
		// A bucket at `now` can never be settled — it is inside the settling horizon by
		// definition — so the mark has to come from something older than that horizon and
		// newer than the window being asked about.
		const upToDate = [stored({ bucketAt: alignBucket(minutesAgo(20)), settled: true })];
		expect(gapFor(upToDate, { from: minutesAgo(60), to: minutesAgo(30) }, NOW)).toBeNull();
	});

	test('ancient samples do not narrow the window below what was asked for', () => {
		const ancient = [stored({ bucketAt: alignBucket(minutesAgo(600)), settled: true })];
		const gap = gapFor(ancient, want, NOW)!;

		expect(gap.from.getTime()).toBe(alignBucket(want.from).getTime());
	});
});

describe('downsample', () => {
	test('reduces a day of buckets to what a chart can draw', () => {
		// 1,440 sixty-second buckets for a chart a few hundred pixels wide.
		const samples = Array.from({ length: 1440 }, (_, index) =>
			stored({ bucketAt: new Date(NOW.getTime() - (1440 - index) * 60_000), value: index })
		);

		const points = downsample(samples, minutesAgo(1440), NOW, 24);
		expect(points.length).toBeLessThanOrEqual(24);
		expect(points.length).toBeGreaterThan(20);
	});

	test('averages within a bucket rather than dropping samples', () => {
		const samples = [
			stored({ bucketAt: minutesAgo(10), value: 10 }),
			stored({ bucketAt: minutesAgo(9), value: 20 })
		];

		const points = downsample(samples, minutesAgo(10), NOW, 1);
		expect(points[0].value).toBe(15);
	});

	test('never groups tighter than the stored resolution', () => {
		// Asking for more points than there are buckets cannot invent detail.
		const samples = [stored({ bucketAt: minutesAgo(2), value: 5 })];
		const points = downsample(samples, minutesAgo(3), NOW, 1000);

		expect(points.length).toBe(1);
		expect(BUCKET_SECONDS).toBe(60);
	});

	test('an empty set is an empty chart, not a throw', () => {
		expect(downsample([], minutesAgo(10), NOW, 24)).toEqual([]);
	});
});

describe('toTimeSeries', () => {
	test('labels are computed for the window being drawn', () => {
		const series = toTimeSeries(
			'p95',
			'P95 latency',
			[
				{ at: minutesAgo(2), value: 10 },
				{ at: minutesAgo(1), value: 30 }
			],
			(at) => at.toISOString().slice(11, 16)
		);

		expect(series.points.map((one) => one.label)).toEqual(['11:58', '11:59']);
		expect(series.min).toBe(10);
		expect(series.max).toBe(30);
	});

	test('an empty series reports zero bounds rather than infinities', () => {
		const series = toTimeSeries('p95', 'P95', [], () => '');

		expect(series.min).toBe(0);
		expect(series.max).toBe(0);
	});
});
