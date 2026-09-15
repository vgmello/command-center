import { describe, expect, test } from 'bun:test';
import { rollUpDeployments } from './domain-deployments';
import type { ServiceTrend } from './types';

function trend(
	service: string,
	runs: number[],
	failures: number[],
	totals: number[]
): ServiceTrend {
	const series = (id: string, values: number[]) => ({
		id,
		label: id,
		points: values.map((value, index) => ({ label: `p${index}`, value })),
		min: 0,
		max: Math.max(...values, 0)
	});

	return {
		service,
		runs: series('runs', runs),
		failures: series('failures', failures),
		durationTotal: series('duration-total', totals)
	};
}

describe('rollUpDeployments', () => {
	test('sums only the services the domain owns', () => {
		const stats = rollUpDeployments(
			[
				trend('payment-api', [2, 2], [0, 0], [100, 100]),
				trend('order-api', [9, 9], [9, 9], [1, 1])
			],
			['payment-api']
		);

		expect(stats.total).toBe(4);
		expect(stats.byService.map((one) => one.service)).toEqual(['payment-api']);
	});

	test('rebuilds the mean from the sums, never from per-service means', () => {
		// Two runs at 10s and two hundred at 1000s is a mean of 990. Averaging the two
		// service means gives 505, which is simply a different number.
		const stats = rollUpDeployments(
			[trend('a', [2], [0], [20]), trend('b', [200], [0], [200_000])],
			['a', 'b']
		);

		expect(stats.total).toBe(202);
		expect(stats.meanDurationSeconds).toBe(990);
	});

	test('rebuilds the failure rate from two counts, never from per-service rates', () => {
		const stats = rollUpDeployments(
			[trend('a', [100], [1], [0]), trend('b', [2], [1], [0])],
			['a', 'b']
		);

		// 2 of 102, not the mean of 1% and 50%.
		expect(stats.changeFailureRatePct).toBeCloseTo(1.96, 1);
	});

	test('a service with no runs does not divide by zero', () => {
		const stats = rollUpDeployments([trend('a', [0], [0], [0])], ['a']);

		expect(stats.meanDurationSeconds).toBe(0);
		expect(stats.changeFailureRatePct).toBe(0);
	});

	test('the frequency series keeps the buckets the services shared', () => {
		const stats = rollUpDeployments(
			[trend('a', [1, 2, 3], [0, 0, 0], [0, 0, 0]), trend('b', [1, 1, 1], [0, 0, 0], [0, 0, 0])],
			['a', 'b']
		);

		expect(stats.frequency.points.map((one) => one.value)).toEqual([2, 3, 4]);
	});

	test('a domain whose services never deployed reports zero, not a missing reading', () => {
		// Distinct from "nothing is accumulating", which is a gap the assembler states.
		const stats = rollUpDeployments([], ['a']);

		expect(stats.total).toBe(0);
		expect(stats.byService).toEqual([]);
	});
});
