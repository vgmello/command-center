import { describe, expect, test } from 'bun:test';
import {
	INSIGHT_RULES,
	baselineOf,
	deriveFleetInsights,
	deriveInsights,
	insightFor,
	relativeChange,
	sigmaOf,
	type MetricObservation
} from './metric-insights';

const NOW = new Date('2026-09-04T12:00:00.000Z');

/** A steady baseline of `n` points, then one current reading. */
function window(baseline: number, current: number, n = 20): number[] {
	// A little jitter, so the standard deviation is not zero and the sigma test means
	// something. Deterministic, so a threshold test cannot flake.
	return [
		...Array.from({ length: n }, (_, i) => baseline + ((i % 5) - 2) * baseline * 0.02),
		current
	];
}

function observation(overrides: Partial<MetricObservation> = {}): MetricObservation {
	return {
		id: 'error-rate',
		label: 'Error rate',
		kind: 'percent',
		affects: 'payment-api',
		values: window(0.4, 0.4),
		direction: 'higher-is-worse',
		...overrides
	};
}

describe('baselineOf', () => {
	test('excludes the current reading, which is what it is judged against', () => {
		// Including it would drag the mean toward the very value being tested.
		const baseline = baselineOf([1, 1, 1, 1, 100]);

		expect(baseline.mean).toBe(1);
		expect(baseline.samples).toBe(4);
	});

	test('an empty window has no baseline rather than a NaN one', () => {
		expect(baselineOf([])).toEqual({ mean: 0, stdDev: 0, samples: 0 });
	});
});

describe('sigmaOf', () => {
	test('measures distance in standard deviations', () => {
		expect(sigmaOf(3, { mean: 1, stdDev: 1, samples: 10 })).toBe(2);
	});

	test('a flat baseline reports zero, not infinity', () => {
		// Otherwise a metric that never moves makes every reading infinitely anomalous.
		expect(sigmaOf(2, { mean: 1, stdDev: 0, samples: 10 })).toBe(0);
	});
});

describe('relativeChange', () => {
	test('is a signed fraction of the baseline', () => {
		expect(relativeChange(1.5, { mean: 1, stdDev: 0.1, samples: 10 })).toBeCloseTo(0.5, 5);
	});

	test('a rise from nothing is a full change, not a division by zero', () => {
		expect(relativeChange(5, { mean: 0, stdDev: 0, samples: 10 })).toBe(1);
		expect(relativeChange(0, { mean: 0, stdDev: 0, samples: 10 })).toBe(0);
	});
});

describe('insightFor', () => {
	test('flags a reading far above its own baseline', () => {
		const insight = insightFor(observation({ values: window(0.4, 3.2) }), NOW, '24h');

		expect(insight).not.toBeNull();
		expect(insight!.severity).toBe('critical');
		expect(insight!.kind).toBe('anomaly');
	});

	test('states the number, the baseline and the distance, so it can be argued with', () => {
		const insight = insightFor(observation({ values: window(0.4, 3.2) }), NOW, '24h');

		expect(insight!.detail).toContain('3.20%');
		expect(insight!.detail).toContain('0.40%');
		expect(insight!.detail).toContain('24h');
		expect(insight!.detail).toMatch(/σ/);
	});

	test('says nothing about a metric sitting in its normal range', () => {
		expect(insightFor(observation({ values: window(0.4, 0.41) }), NOW, '24h')).toBeNull();
	});

	test('will not judge a window too short to have a baseline', () => {
		// A standard deviation over three points is noise dressed as statistics.
		const short = observation({ values: [0.4, 0.4, 3.2] });

		expect(baselineOf(short.values).samples).toBeLessThan(INSIGHT_RULES.minSamples);
		expect(insightFor(short, NOW, '24h')).toBeNull();
	});

	test('a flat series does not make a trivial move look enormous', () => {
		// Zero spread means every deviation is many sigma; the relative test is what
		// stops 101ms against a rock-steady 100ms being called an anomaly.
		const flat = observation({
			kind: 'duration-ms',
			values: [...Array.from({ length: 20 }, () => 100), 101]
		});

		expect(insightFor(flat, NOW, '24h')).toBeNull();
	});

	test('a big move on a flat series is still caught', () => {
		const flat = observation({
			kind: 'duration-ms',
			values: [...Array.from({ length: 20 }, () => 100), 900]
		});

		expect(insightFor(flat, NOW, '24h')).not.toBeNull();
	});

	test('a fall in a higher-is-worse metric is not an incident', () => {
		// Errors dropping is good news, and an alarm about it trains people to ignore alarms.
		expect(insightFor(observation({ values: window(3.2, 0.1) }), NOW, '24h')).toBeNull();
	});

	test('a fall in a lower-is-worse metric is an incident', () => {
		// Throughput collapsing is the outage.
		const traffic = observation({
			id: 'request-rate',
			label: 'Request rate',
			kind: 'rate',
			direction: 'lower-is-worse',
			values: window(50, 2)
		});

		expect(insightFor(traffic, NOW, '24h')!.severity).toBe('critical');
	});
});

describe('deriveInsights', () => {
	test('reports the worst first', () => {
		const insights = deriveInsights(
			[
				observation({ id: 'a', affects: 'a-service', values: window(0.4, 1.0) }),
				observation({ id: 'b', affects: 'b-service', values: window(0.4, 6.0) })
			],
			NOW,
			'24h'
		);

		expect(insights[0].severity).toBe('critical');
	});

	test('an estate behaving itself produces no findings, rather than filler', () => {
		expect(deriveInsights([observation()], NOW, '24h')).toEqual([]);
	});
});

describe('deriveFleetInsights', () => {
	const metric = {
		id: 'error-rate',
		label: 'Error rate',
		kind: 'percent' as const,
		direction: 'higher-is-worse' as const
	};

	test('names a service far worse than the pack', () => {
		const insights = deriveFleetInsights(
			metric,
			[
				{ service: 'payment-api', values: window(0.4, 0.4) },
				{ service: 'auth-service', values: window(0.4, 0.42) },
				{ service: 'payment-gateway', values: window(4, 4.2) }
			],
			NOW,
			'24h'
		);

		const outlier = insights.find((one) => one.id === 'fleet-error-rate');
		expect(outlier?.affects).toBe('payment-gateway');
		expect(outlier?.detail).toContain('fleet median');
	});

	test('says nothing when the leader is merely first in a close race', () => {
		// The top of any list is always something. Naming it regardless is noise.
		const insights = deriveFleetInsights(
			metric,
			[
				{ service: 'a', values: window(0.4, 0.4) },
				{ service: 'b', values: window(0.4, 0.42) },
				{ service: 'c', values: window(0.4, 0.44) }
			],
			NOW,
			'24h'
		);

		expect(insights.find((one) => one.id === 'fleet-error-rate')).toBeUndefined();
	});

	test('one finding for many services moving together, not one each', () => {
		// The shared cause is the thing worth knowing; five alarms hide it.
		const insights = deriveFleetInsights(
			metric,
			['a', 'b', 'c', 'd'].map((service) => ({ service, values: window(0.4, 3.5) })),
			NOW,
			'24h'
		);

		const correlated = insights.find((one) => one.id === 'fleet-error-rate-correlated');
		expect(correlated).toBeDefined();
		expect(correlated!.severity).toBe('critical');
		expect(correlated!.affects).toBe('4 services');
		expect(correlated!.detail).toContain('beneath them');
	});

	test('two services moving is not yet a pattern', () => {
		const insights = deriveFleetInsights(
			metric,
			[
				{ service: 'a', values: window(0.4, 3.5) },
				{ service: 'b', values: window(0.4, 3.5) },
				{ service: 'c', values: window(0.4, 0.4) }
			],
			NOW,
			'24h'
		);

		expect(insights.find((one) => one.id === 'fleet-error-rate-correlated')).toBeUndefined();
	});

	test('too few services to compare produces nothing', () => {
		expect(
			deriveFleetInsights(metric, [{ service: 'a', values: window(0.4, 9) }], NOW, '24h')
		).toEqual([]);
	});
});
