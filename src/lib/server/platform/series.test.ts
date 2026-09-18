import { describe, expect, test } from 'bun:test';
import { buildSeries } from './series';

/*
 * The default length is 24. Callers that need more must say so: slicing a longer
 * window out of a shorter series yields `undefined` entries that pass silently
 * through arithmetic and land in whichever bucket a NaN comparison falls into.
 */

describe('the requested length', () => {
	test('is honoured, so a caller never gets a short array', () => {
		for (const points of [1, 7, 24, 32, 60]) {
			expect(buildSeries('x', 10, { points }).values).toHaveLength(points);
		}
	});

	test('bounds are computed over what was actually generated', () => {
		const series = buildSeries('x', 10, { points: 40 });

		expect(series.min).toBe(Math.min(...series.values));
		expect(series.max).toBe(Math.max(...series.values));
	});
});
