import { describe, expect, test } from 'bun:test';
import {
	axisTicks,
	linePath,
	niceScale,
	plotBars,
	plotPoints,
	seriesBounds,
	thinLabels
} from './chart';
import type { Plot } from './chart';
import type { TimeSeries } from './types';

const plot: Plot = {
	width: 300,
	height: 100,
	padLeft: 30,
	padRight: 10,
	padTop: 10,
	padBottom: 20
};

const series = (id: string, values: number[]): TimeSeries => ({
	id,
	label: id,
	points: values.map((value, index) => ({ label: `t${index}`, value })),
	min: values.length ? Math.min(...values) : 0,
	max: values.length ? Math.max(...values) : 0
});

describe('niceScale', () => {
	test('every tick lands on a round number, not on 12.5', () => {
		for (const value of [3, 8, 12, 24, 37, 41, 96, 230, 1450]) {
			for (const tick of axisTicks(niceScale(value))) {
				expect(Number.isInteger(tick)).toBe(true);
			}
		}
	});

	test('the ceiling is a whole number of steps above the floor', () => {
		for (const value of [8, 24, 37, 41, 96]) {
			const scale = niceScale(value);
			expect((scale.max - scale.min) % scale.step).toBeCloseTo(0, 9);
		}
	});

	test('never clips the peak it was given', () => {
		for (const value of [1, 9, 10, 25, 41, 99, 100]) {
			expect(niceScale(value).max).toBeGreaterThanOrEqual(value);
		}
	});

	test('leaves a readable number of gaps rather than an exact count', () => {
		for (const value of [8, 24, 37, 41, 96, 230]) {
			const scale = niceScale(value);
			const gaps = (scale.max - scale.min) / scale.step;
			expect(gaps).toBeGreaterThanOrEqual(3);
			expect(gaps).toBeLessThanOrEqual(8);
		}
	});

	test('a flat series still gets a height to draw in', () => {
		expect(niceScale(0)).toEqual({ min: 0, max: 1, step: 1 });
	});
});

describe('seriesBounds', () => {
	test('scales every series against one ceiling, so heights are comparable', () => {
		const bounds = seriesBounds([series('a', [1, 2, 3]), series('b', [20, 30, 24])]);

		expect(bounds.min).toBe(0);
		expect(bounds.max).toBeGreaterThanOrEqual(30);
	});

	test('an empty set still yields a drawable box', () => {
		expect(seriesBounds([])).toEqual({ min: 0, max: 1, step: 1 });
		expect(seriesBounds([series('a', [])])).toEqual({ min: 0, max: 1, step: 1 });
	});
});

describe('plotPoints', () => {
	test('the first and last points sit on the plot edges', () => {
		const points = plotPoints(series('a', [0, 5, 10]), plot, { min: 0, max: 10, step: 2 });

		expect(points[0].x).toBe(plot.padLeft);
		expect(points[2].x).toBe(plot.width - plot.padRight);
	});

	test('a maximum sits at the top of the plot and a minimum at the bottom', () => {
		const points = plotPoints(series('a', [0, 10]), plot, { min: 0, max: 10, step: 2 });

		expect(points[1].y).toBe(plot.padTop);
		expect(points[0].y).toBe(plot.height - plot.padBottom);
	});

	test('a single point is centred rather than pinned to the left edge', () => {
		const points = plotPoints(series('a', [4]), plot, { min: 0, max: 10, step: 2 });

		expect(points[0].x).toBe(plot.padLeft + (plot.width - plot.padLeft - plot.padRight) / 2);
	});

	test('carries the label through, so the axis and the line cannot disagree', () => {
		expect(plotPoints(series('a', [1, 2]), plot, { min: 0, max: 2, step: 1 })[1].label).toBe('t1');
	});
});

describe('linePath', () => {
	test('moves once and draws the rest', () => {
		const path = linePath(plotPoints(series('a', [1, 2, 3]), plot, { min: 0, max: 3, step: 1 }));

		expect(path.startsWith('M ')).toBe(true);
		expect(path.match(/M /g)).toHaveLength(1);
		expect(path.match(/L /g)).toHaveLength(2);
	});

	test('no points is an empty path, not a broken one', () => {
		expect(linePath([])).toBe('');
	});
});

describe('plotBars', () => {
	test('bars sit on the baseline and never overlap', () => {
		const bars = plotBars(series('a', [10, 20, 30]), plot, { min: 0, max: 30, step: 10 });
		const baseline = plot.padTop + plot.height - plot.padTop - plot.padBottom;

		for (const bar of bars) expect(bar.y + bar.height).toBeCloseTo(baseline, 1);
		for (let i = 1; i < bars.length; i++) {
			expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].width);
		}
	});

	test('a zero value draws nothing rather than a negative rectangle', () => {
		const [bar] = plotBars(series('a', [0]), plot, { min: 0, max: 10, step: 2 });

		expect(bar.height).toBe(0);
	});
});

describe('axisTicks', () => {
	test('includes both ends, so the scale is readable at a glance', () => {
		expect(axisTicks({ min: 0, max: 40, step: 10 })).toEqual([0, 10, 20, 30, 40]);
	});
});

describe('thinLabels', () => {
	test('keeps every label when they fit', () => {
		const points = series('a', [1, 2, 3]).points;

		expect(thinLabels(points, 5)).toEqual(['t0', 't1', 't2']);
	});

	test('blanks rather than drops, so labels stay aligned to their points', () => {
		const points = series(
			'a',
			Array.from({ length: 12 }, (_, i) => i)
		).points;
		const labels = thinLabels(points, 4);

		expect(labels).toHaveLength(12);
		expect(labels.filter(Boolean).length).toBeLessThanOrEqual(4);
		expect(labels[0]).toBe('t0');
	});
});
