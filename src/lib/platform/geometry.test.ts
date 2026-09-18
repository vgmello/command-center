import { describe, expect, test } from 'bun:test';
import { donutSegments, ringDash, sparklinePath } from './geometry';
import type { DistributionSlice, Series } from './types';

const series = (values: number[]): Series => ({
	values,
	min: Math.min(...values),
	max: Math.max(...values)
});

describe('sparklinePath', () => {
	test('spans the full width and inverts the y axis', () => {
		const path = sparklinePath(series([0, 10]), 100, 20, 0);
		// Lowest value sits at the bottom of the box, highest at the top.
		expect(path).toBe('M 0 20 L 100 0');
	});

	test('draws a flat line through the middle for a single sample', () => {
		expect(sparklinePath(series([5]), 100, 20)).toBe('M 0 10 L 100 10');
	});

	test('returns nothing for an empty series instead of an invalid path', () => {
		expect(sparklinePath({ values: [], min: 0, max: 0 }, 100, 20)).toBe('');
	});

	test('survives a flat series without dividing by a zero span', () => {
		const path = sparklinePath(series([7, 7, 7]), 100, 20, 0);
		expect(path).toBe('M 0 20 L 50 20 L 100 20');
	});
});

describe('donutSegments', () => {
	const slices = (...counts: number[]): DistributionSlice[] =>
		counts.map((count, index) => ({
			status: (['healthy', 'degraded', 'down', 'unknown'] as const)[index],
			label: 'slice',
			count,
			percentage: 0
		}));

	test('skips empty slices so they cannot claim an arc', () => {
		const segments = donutSegments(slices(3, 0, 1), 50);
		expect(segments.map((segment) => segment.status)).toEqual(['healthy', 'down']);
	});

	test('each segment starts where the previous one ended', () => {
		const radius = 50;
		const circumference = 2 * Math.PI * radius;
		const segments = donutSegments(slices(1, 1), radius, 0);

		expect(segments[0].dashOffset).toBe(-0);
		expect(segments[1].dashOffset).toBeCloseTo(-circumference / 2, 6);
	});

	test('an empty distribution draws nothing', () => {
		expect(donutSegments(slices(0, 0), 50)).toEqual([]);
	});
});

describe('ringDash', () => {
	test('clamps outside 0–100 rather than overdrawing the ring', () => {
		const radius = 20;
		const circumference = 2 * Math.PI * radius;

		expect(ringDash(150, radius).dash).toBeCloseTo(circumference, 6);
		expect(ringDash(-10, radius).dash).toBe(0);
		expect(ringDash(50, radius).dash).toBeCloseTo(circumference / 2, 6);
	});
});
