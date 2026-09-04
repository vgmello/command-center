import { describe, expect, test } from 'bun:test';
import { PromEvaluator } from './promql-eval';
import { buildEstate } from './data';
import {
	DEFAULT_METRICS,
	availability,
	errorRate,
	instancesUp,
	p95ByRoute,
	p95Latency,
	rateByRoute,
	rateByService,
	requestRate,
	saturation
} from '../promql';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const estate = buildEstate({ now: NOW, points: 120, stepSeconds: 60 });
const evaluator = new PromEvaluator(estate);

const at = Math.floor(NOW.getTime() / 1000);
const production = { service: 'payment-api', environment: 'production' };

/** Evaluate an instant query and return the single scalar it produces. */
function value(query: string): number {
	const series = evaluator.evaluateAt(query, at);
	return series[0]?.points[0]?.value ?? NaN;
}

describe('the evaluator runs the provider’s own queries', () => {
	test('a request rate is a positive number, not an empty result', () => {
		// If the selector or the metric name were wrong this would be NaN, which is
		// exactly the mistake a canned-response mock could never catch.
		expect(value(requestRate(DEFAULT_METRICS, production, '1h'))).toBeGreaterThan(0);
	});

	test('a selector actually selects — a different service gives a different number', () => {
		const one = value(requestRate(DEFAULT_METRICS, production, '1h'));
		const other = value(
			requestRate(DEFAULT_METRICS, { service: 'auth-service', environment: 'production' }, '1h')
		);

		expect(one).not.toBe(other);
	});

	test('the environment label is honoured, so staging is quieter than production', () => {
		const live = value(requestRate(DEFAULT_METRICS, production, '1h'));
		const staging = value(
			requestRate(DEFAULT_METRICS, { service: 'payment-api', environment: 'staging' }, '1h')
		);

		expect(staging).toBeLessThan(live);
	});

	test('an unknown service yields nothing rather than another service’s traffic', () => {
		const series = evaluator.evaluateAt(
			requestRate(DEFAULT_METRICS, { service: 'no-such-service', environment: 'production' }, '1h'),
			at
		);

		expect(series.length === 0 || series[0].points[0].value === 0).toBe(true);
	});
});

describe('histogram_quantile', () => {
	test('produces a latency inside the histogram’s range', () => {
		const p95 = value(p95Latency(DEFAULT_METRICS, production, '1h'));

		// Converted to milliseconds by the query, against buckets topping out at 5s.
		expect(p95).toBeGreaterThan(0);
		expect(p95).toBeLessThanOrEqual(5000);
	});

	test('interpolates rather than snapping to a bucket bound', () => {
		const p95 = value(p95Latency(DEFAULT_METRICS, production, '1h'));
		const bounds = [50, 100, 250, 500, 1000, 2500, 5000];

		// A mock that returned a bucket bound would make every latency in the app land on
		// one of seven numbers.
		expect(bounds).not.toContain(p95);
	});

	test('by (le, http_route) gives one quantile per route, not one overall', () => {
		const series = evaluator.evaluateAt(p95ByRoute(DEFAULT_METRICS, production, '1h'), at);
		const routes = series.map((one) => one.labels.http_route).filter(Boolean);

		expect(routes.length).toBeGreaterThan(1);
		expect(new Set(routes).size).toBe(routes.length);
	});
});

describe('aggregation', () => {
	test('sum by (http_route) splits the rate by route', () => {
		const series = evaluator.evaluateAt(rateByRoute(DEFAULT_METRICS, production, '1h'), at);
		expect(series.length).toBeGreaterThan(1);

		const total = value(requestRate(DEFAULT_METRICS, production, '1h'));
		const summed = series.reduce((sum, one) => sum + one.points[0].value, 0);

		// The parts must add up to the whole — the check that catches a grouping that
		// silently drops or double-counts series.
		expect(summed).toBeCloseTo(total, 5);
	});

	test('sum by (service) names each service once', () => {
		const series = evaluator.evaluateAt(
			rateByService(DEFAULT_METRICS, { environment: 'production' }, '1h'),
			at
		);
		const names = series.map((one) => one.labels.service);

		expect(names.length).toBeGreaterThan(1);
		expect(new Set(names).size).toBe(names.length);
	});

	test('avg is a mean, not a sum', () => {
		const cpu = value(saturation(DEFAULT_METRICS, production, 'cpu'));

		// A percentage of one CPU: a sum across three instances would exceed 100.
		expect(cpu).toBeGreaterThan(0);
		expect(cpu).toBeLessThanOrEqual(100);
	});
});

describe('error rate', () => {
	test('is a percentage between zero and one hundred', () => {
		const rate = value(errorRate(DEFAULT_METRICS, production, '1h'));

		expect(rate).toBeGreaterThanOrEqual(0);
		expect(rate).toBeLessThanOrEqual(100);
	});

	test('a service with no 5xx reports zero rather than an empty series', () => {
		// `or vector(0)` exists for this: an absent line and a flat zero read differently.
		const rate = value(
			errorRate(DEFAULT_METRICS, { service: 'catalogue-api', environment: 'development' }, '1h')
		);

		expect(Number.isFinite(rate)).toBe(true);
	});
});

describe('up', () => {
	test('reports one series per instance', () => {
		const series = evaluator.evaluateAt(instancesUp(DEFAULT_METRICS, production), at);

		expect(series.length).toBe(3);
		for (const one of series) expect([0, 1]).toContain(one.points[0].value);
	});

	test('the seeded down instance is actually down', () => {
		const series = evaluator.evaluateAt(
			instancesUp(DEFAULT_METRICS, { service: 'payment-gateway', environment: 'production' }),
			at
		);

		expect(series.some((one) => one.points[0].value === 0)).toBe(true);
		expect(series.some((one) => one.points[0].value === 1)).toBe(true);
	});
});

describe('range evaluation', () => {
	test('returns one point per step across the window', () => {
		const from = at - 3600;
		const series = evaluator.evaluate(
			requestRate(DEFAULT_METRICS, production, '1h'),
			from,
			at,
			300
		);

		expect(series[0].points.length).toBe(13);
		expect(series[0].points[0].at).toBe(from);
	});
});

describe('operator precedence', () => {
	test('multiplication binds tighter than subtraction', () => {
		// Parsed left to right, `1 - 4 / 2` is -1.5 rather than -1. That is exactly how
		// the availability expression produced a negative percentage.
		expect(value('1 - 4 / 2')).toBe(-1);
	});

	test('division binds tighter than addition', () => {
		expect(value('1 + 6 / 2')).toBe(4);
	});

	test('an availability expression stays inside nought to one hundred', () => {
		const percent = value(availability(DEFAULT_METRICS, production, '1d'));

		expect(percent).toBeGreaterThanOrEqual(0);
		expect(percent).toBeLessThanOrEqual(100);
	});
});

describe('unsupported input', () => {
	test('throws rather than quietly returning zero', () => {
		// An expression the evaluator cannot handle must fail a test, not produce a
		// plausible-looking number that hides a broken query.
		expect(() => evaluator.evaluateAt('topk(3, foo)', at)).toThrow();
	});
});
