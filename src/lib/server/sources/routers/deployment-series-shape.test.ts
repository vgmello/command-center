import { describe, expect, test } from 'bun:test';
import { serviceTrendsShape, statusTrendShape, trendsShape } from './deployment-series-shape';
import { SEPARATOR, geometryFor, groupSamples, toSamples } from '../series';
import type { Capability } from '$lib/platform/sources';
import type { TimeSeries } from '$lib/platform/types';
import type { StoredSample } from '../../store/source-store';

/**
 * The arithmetic of taking a trend apart and putting it back.
 *
 * Cost is measured elsewhere. What is checked here is that the answer survives the round
 * trip, because the two ways this could be quietly wrong both produce a plausible chart:
 * a count that averaged instead of summing, and a mean rebuilt from means.
 */

const DAY = 86_400_000;
const now = new Date('2026-09-15T12:00:00Z');
const window = { from: new Date(now.getTime() - 4 * DAY), to: now };

function seriesOf(id: string, values: number[]): TimeSeries {
	return {
		id,
		label: id,
		points: values.map((value, index) => ({ label: `d${index}`, value })),
		min: 0,
		max: Math.max(...values, 0)
	};
}

type Flattened = Array<{
	key: { entity: string; metric: string };
	points: Array<{ at: Date; value: number }>;
}>;

/** Flatten an answer, store it the way the router would, and read it back. */
function roundTrip<T>(
	shape: {
		flatten: (answer: T, window: { from: Date; to: Date }) => Flattened;
		rebuild: (groups: Map<string, StoredSample[]>, window: { from: Date; to: Date }) => T;
	},
	answer: T,
	capability: Capability
): T {
	const samples = toSamples(
		shape.flatten(answer, window),
		{
			connectionId: 'oct',
			capability,
			environment: 'production'
		},
		new Date(now.getTime() + 10 * DAY)
	);

	return shape.rebuild(groupSamples(samples), window);
}

describe('deployment trends round trip', () => {
	test('a day bucket is a day, so five days of runs do not collapse into minutes', () => {
		expect(geometryFor('deployment.trends').bucketSeconds).toBe(86_400);
	});

	test('the run counts survive, summed rather than averaged', () => {
		const answer = {
			frequency: seriesOf('frequency', [4, 0, 7, 2, 5]),
			meanDuration: seriesOf('mean-duration', [100, 0, 100, 100, 100])
		};

		const back = roundTrip(trendsShape('daily'), answer, 'deployment.trends');
		const total = back.frequency.points.reduce((sum, one) => sum + one.value, 0);

		// 4 + 0 + 7 + 2 + 5. An averaging downsample would report a fifth of this.
		expect(total).toBe(18);
	});

	test('a mean is rebuilt from the totals, not averaged from the means', () => {
		// The case that separates the two. Two runs at 10 seconds and two hundred at 1,000
		// is a fortnight mean of 990, not the 505 an average of the two daily means gives.
		const answer = {
			frequency: seriesOf('frequency', [2, 200]),
			meanDuration: seriesOf('mean-duration', [10, 1000])
		};

		const back = roundTrip(trendsShape('monthly'), answer, 'deployment.trends');
		const combined = back.meanDuration.points.find((one) => one.value > 0);

		expect(combined?.value).toBe(990);
	});

	test('a bucket with no runs reports a mean of zero rather than dividing by it', () => {
		const answer = {
			frequency: seriesOf('frequency', [0, 0]),
			meanDuration: seriesOf('mean-duration', [0, 0])
		};

		const back = roundTrip(trendsShape('daily'), answer, 'deployment.trends');

		for (const point of back.meanDuration.points) expect(Number.isFinite(point.value)).toBe(true);
	});

	test('frequency and duration share one x-axis, so the two charts line up', () => {
		const answer = {
			frequency: seriesOf('frequency', [1, 2, 3]),
			meanDuration: seriesOf('mean-duration', [10, 20, 30])
		};

		const back = roundTrip(trendsShape('daily'), answer, 'deployment.trends');

		expect(back.meanDuration.points.map((one) => one.label)).toEqual(
			back.frequency.points.map((one) => one.label)
		);
	});
});

describe('status trend round trip', () => {
	test('every status keeps its own counts, summed', () => {
		const answer = [
			seriesOf('success', [5, 6]),
			seriesOf('failed', [1, 0]),
			seriesOf('in-progress', [0, 2])
		];

		const back = roundTrip(statusTrendShape(), answer, 'deployment.statusTrend');
		const totalFor = (id: string) =>
			back.find((one) => one.id === id)?.points.reduce((sum, one) => sum + one.value, 0);

		expect(totalFor('success')).toBe(11);
		expect(totalFor('failed')).toBe(1);
		expect(totalFor('in-progress')).toBe(2);
	});

	test('the three series come back in the order the chart stacks them', () => {
		const answer = [
			seriesOf('success', [1]),
			seriesOf('failed', [1]),
			seriesOf('in-progress', [1])
		];
		const back = roundTrip(statusTrendShape(), answer, 'deployment.statusTrend');

		expect(back.map((one) => one.id)).toEqual(['success', 'failed', 'in-progress']);
	});

	test('samples are keyed by status with no entity, so nothing collides', () => {
		const answer = [seriesOf('success', [1]), seriesOf('failed', [2])];
		const flattened = statusTrendShape().flatten(answer, window);

		expect(flattened.map((one) => `${one.key.entity}${SEPARATOR}${one.key.metric}`)).toEqual([
			`${SEPARATOR}success`,
			`${SEPARATOR}failed`
		]);
	});
});

describe('serviceTrendsShape', () => {
	const answer = [
		{
			service: 'payment-api',
			runs: seriesOf('runs', [2, 4]),
			failures: seriesOf('failures', [0, 1]),
			durationTotal: seriesOf('duration-total', [20, 4_000])
		},
		{
			service: 'payment-gateway',
			runs: seriesOf('runs', [1, 1]),
			failures: seriesOf('failures', [1, 0]),
			durationTotal: seriesOf('duration-total', [10, 10])
		}
	];

	test('writes one entity per service, so a domain can be summed from them', () => {
		const keys = serviceTrendsShape('daily').flatten(answer, {
			from: new Date('2026-09-14T00:00:00Z'),
			to: new Date('2026-09-15T00:00:00Z')
		});

		expect([...new Set(keys.map((one) => one.key.entity))].sort()).toEqual([
			'payment-api',
			'payment-gateway'
		]);
		expect([...new Set(keys.map((one) => one.key.metric))].sort()).toEqual([
			'duration_total',
			'failure_count',
			'run_count'
		]);
	});

	test('survives a round trip through the store', () => {
		const back = roundTrip(serviceTrendsShape('daily'), answer, 'deployment.serviceTrends');

		expect(back.map((one) => one.service).sort()).toEqual(['payment-api', 'payment-gateway']);
		const api = back.find((one) => one.service === 'payment-api');
		expect(api?.runs.points.reduce((sum, one) => sum + one.value, 0)).toBe(6);
		expect(api?.failures.points.reduce((sum, one) => sum + one.value, 0)).toBe(1);
	});

	test('counts sum across a coarser grain rather than averaging', () => {
		// A week that averaged its days reports a seventh of the deployments that happened.
		const back = roundTrip(serviceTrendsShape('weekly'), answer, 'deployment.serviceTrends');
		const api = back.find((one) => one.service === 'payment-api');

		expect(api?.runs.points.reduce((sum, one) => sum + one.value, 0)).toBe(6);
	});
});
