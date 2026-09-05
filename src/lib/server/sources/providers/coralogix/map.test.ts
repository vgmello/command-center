import { describe, expect, test } from 'bun:test';
import {
	LATENCY_BANDS,
	bucketLabel,
	healthFromUp,
	healthOf,
	latencyBand,
	sampleValue,
	scalarOf,
	scalarsByLabel,
	toSeries,
	toTimeSeries,
	toTimeSeriesByLabel
} from './map';
import type { PromMatrix, PromVector } from './client';

const matrix = (result: PromMatrix['result']): PromMatrix => ({ resultType: 'matrix', result });
const vector = (result: PromVector['result']): PromVector => ({ resultType: 'vector', result });

describe('sampleValue', () => {
	test('parses the string Prometheus actually sends', () => {
		expect(sampleValue('12.5')).toBe(12.5);
	});

	test('NaN becomes zero, once, where the decision is visible', () => {
		// histogram_quantile over an empty bucket returns NaN. Left alone it poisons
		// every average and total computed downstream of it.
		expect(sampleValue('NaN')).toBe(0);
		expect(sampleValue('')).toBe(0);
		expect(sampleValue('+Inf')).toBe(0);
	});
});

describe('bucketLabel', () => {
	test('a short window gets a clock time', () => {
		expect(bucketLabel(Date.parse('2026-09-04T14:30:00Z') / 1000, 3600)).toBe('14:30');
	});

	test('a long window gets a date, because two days would both read the same', () => {
		expect(bucketLabel(Date.parse('2026-09-04T14:30:00Z') / 1000, 7 * 86_400)).toBe('4 Sep');
	});
});

describe('toTimeSeries', () => {
	test('maps points and reports its own bounds', () => {
		const series = toTimeSeries(
			matrix([
				{
					metric: {},
					values: [
						[1_757_000_000, '10'],
						[1_757_000_060, '30']
					]
				}
			]),
			'rate',
			'Requests',
			3600
		);

		expect(series.points.map((one) => one.value)).toEqual([10, 30]);
		expect(series.min).toBe(10);
		expect(series.max).toBe(30);
	});

	test('an empty matrix is an empty series, not a throw', () => {
		// A service with no traffic in the window is an ordinary answer.
		const series = toTimeSeries(matrix([]), 'rate', 'Requests', 3600);

		expect(series.points).toEqual([]);
		expect(series.max).toBe(0);
	});
});

describe('toTimeSeriesByLabel', () => {
	const built = matrix([
		{ metric: { http_route: '/b' }, values: [[1, '2']] },
		{ metric: { http_route: '/a' }, values: [[1, '1']] }
	]);

	test('names each series by the label asked for', () => {
		expect(toTimeSeriesByLabel(built, 'http_route', 3600).map((one) => one.id)).toEqual([
			'/a',
			'/b'
		]);
	});

	test('sorts, so a stacked chart keeps its band order between renders', () => {
		const once = toTimeSeriesByLabel(built, 'http_route', 3600).map((one) => one.id);
		const twice = toTimeSeriesByLabel(built, 'http_route', 3600).map((one) => one.id);

		expect(once).toEqual(twice);
	});

	test('caps the count, because a chart with forty bands is not readable', () => {
		const many = matrix(
			Array.from({ length: 40 }, (_, index) => ({
				metric: { http_route: `/r${index}` },
				values: [[1, '1'] as [number, string]]
			}))
		);

		expect(toTimeSeriesByLabel(many, 'http_route', 3600, 8).length).toBe(8);
	});

	test('a series missing the label is named rather than dropped', () => {
		const unlabelled = matrix([{ metric: {}, values: [[1, '5']] }]);
		expect(toTimeSeriesByLabel(unlabelled, 'http_route', 3600)[0].id).toBe('unknown');
	});
});

describe('scalarOf and scalarsByLabel', () => {
	test('reads the single value of an instant query', () => {
		expect(scalarOf(vector([{ metric: {}, value: [1, '42'] }]))).toBe(42);
	});

	test('nothing matched returns the stated fallback, not undefined', () => {
		expect(scalarOf(vector([]), -1)).toBe(-1);
	});

	test('keys values by a label', () => {
		const found = scalarsByLabel(
			vector([
				{ metric: { service: 'a' }, value: [1, '1'] },
				{ metric: { service: 'b' }, value: [1, '2'] }
			]),
			'service'
		);

		expect(found.get('a')).toBe(1);
		expect(found.get('b')).toBe(2);
	});
});

describe('toSeries', () => {
	test('reduces a matrix to raw samples for a sparkline', () => {
		const series = toSeries(
			matrix([
				{
					metric: {},
					values: [
						[1, '3'],
						[2, '9']
					]
				}
			])
		);

		expect(series.values).toEqual([3, 9]);
		expect(series.max).toBe(9);
	});
});

describe('latencyBand', () => {
	test('worst first, matching the legend the bands travel with', () => {
		expect(LATENCY_BANDS[latencyBand(2000)]).toBe('> 1s');
		expect(LATENCY_BANDS[latencyBand(700)]).toBe('500ms – 1s');
		expect(LATENCY_BANDS[latencyBand(300)]).toBe('200 – 500ms');
		expect(LATENCY_BANDS[latencyBand(50)]).toBe('< 200ms');
	});

	test('every band index is a real legend entry', () => {
		for (const ms of [0, 199, 200, 500, 501, 1000, 1001, 99_999]) {
			expect(LATENCY_BANDS[latencyBand(ms)]).toBeDefined();
		}
	});
});

describe('healthOf', () => {
	test('a high error rate is down', () => {
		expect(healthOf(6, 100)).toBe('down');
	});

	test('a small error rate is degraded, not down', () => {
		expect(healthOf(2, 100)).toBe('degraded');
	});

	test('slow but not failing is still degraded', () => {
		expect(healthOf(0, 1500)).toBe('degraded');
	});

	test('fast and clean is healthy', () => {
		expect(healthOf(0, 120)).toBe('healthy');
	});
});

describe('healthFromUp', () => {
	test('no instances reporting at all is unknown — not healthy, and not down', () => {
		// An empty answer must never read as "everything is fine". It must not read as an
		// outage either: a service the catalog declares and nothing has ever emitted for
		// is not down, and a red badge on it sends someone to page a team about a service
		// nobody has deployed.
		expect(healthFromUp(new Map())).toBe('unknown');
	});

	test('every instance answering is healthy', () => {
		expect(
			healthFromUp(
				new Map([
					['a', 1],
					['b', 1]
				])
			)
		).toBe('healthy');
	});

	test('some answering is degraded', () => {
		expect(
			healthFromUp(
				new Map([
					['a', 1],
					['b', 0]
				])
			)
		).toBe('degraded');
	});

	test('none answering is down', () => {
		expect(
			healthFromUp(
				new Map([
					['a', 0],
					['b', 0]
				])
			)
		).toBe('down');
	});
});
