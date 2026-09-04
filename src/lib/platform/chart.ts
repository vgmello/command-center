import type { TimeSeries, TimeSeriesPoint } from './types';

/**
 * Layout maths for the deployment charts.
 *
 * Plain arithmetic rather than a charting library, by the API selection order: the
 * whole requirement is "points on a grid" and "rectangles on a baseline", which SVG
 * does natively. A chart dependency here would be a bundle cost, a supply-chain
 * surface and an upgrade obligation bought for two dozen lines of division.
 *
 * Everything is pure and takes its bounds as arguments, so a chart drawn from a test
 * is the same chart drawn from a component.
 */

export interface Bounds {
	min: number;
	max: number;
	/** Distance between axis ticks. Derived with the ceiling, never independently. */
	step: number;
}

export interface Plot {
	width: number;
	height: number;
	/** Room reserved for axis labels, inside the viewBox. */
	padLeft: number;
	padBottom: number;
	padTop: number;
	padRight: number;
}

export interface PlotPoint extends TimeSeriesPoint {
	x: number;
	y: number;
}

/**
 * The union of several series' bounds, padded to a round-ish ceiling.
 *
 * Series are scaled together rather than each to its own maximum: three lines on one
 * axis that each fill the height say nothing about which is larger, which is the only
 * question a status-over-time chart is asked.
 */
export function seriesBounds(series: TimeSeries[], floorAtZero = true, targetGaps = 5): Bounds {
	const withPoints = series.filter((one) => one.points.length > 0);
	if (withPoints.length === 0) return { min: 0, max: 1, step: 1 };

	const min = floorAtZero ? 0 : Math.min(...withPoints.map((one) => one.min));
	const max = Math.max(...withPoints.map((one) => one.max));

	// A line that touches the top edge reads as clipped, so the ceiling is rounded up
	// past it rather than sitting exactly on the largest value.
	return niceScale(max, min, targetGaps);
}

/** Round a value up to the next 1/2/5 × 10ⁿ. The set a reader recognises. */
export function niceStep(value: number): number {
	if (value <= 0) return 1;

	const magnitude = 10 ** Math.floor(Math.log10(value));
	const normalized = value / magnitude;
	const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

	return step * magnitude;
}

/**
 * A ceiling and a tick step that agree with each other.
 *
 * The step is rounded first and the ceiling is a whole number of steps above the
 * floor. Rounding them independently is what produces an axis labelled 0, 12.5, 25 —
 * each number defensible on its own, and unreadable together.
 *
 * `targetGaps` is a preference, not a promise: the step is chosen near it and the
 * actual gap count falls out, because forcing an exact count is what forces the
 * fractional ticks back in.
 */
export function niceScale(max: number, min = 0, targetGaps = 5): Bounds {
	const span = max - min;
	if (span <= 0) return { min, max: min + 1, step: 1 };

	const step = niceStep(span / targetGaps);
	return { min, max: min + step * Math.ceil(span / step), step };
}

/** Axis values from `min` to `max`, one per step, inclusive of both ends. */
export function axisTicks(bounds: Bounds): number[] {
	const count = Math.round((bounds.max - bounds.min) / bounds.step) + 1;
	return Array.from({ length: count }, (_, index) => bounds.min + bounds.step * index);
}

/** Place one series' points in the plot area. */
export function plotPoints(series: TimeSeries, plot: Plot, bounds: Bounds): PlotPoint[] {
	const { points } = series;
	if (points.length === 0) return [];

	const innerWidth = plot.width - plot.padLeft - plot.padRight;
	const innerHeight = plot.height - plot.padTop - plot.padBottom;
	const span = bounds.max - bounds.min || 1;
	const step = points.length === 1 ? 0 : innerWidth / (points.length - 1);

	return points.map((point, index) => ({
		...point,
		x: round(plot.padLeft + (points.length === 1 ? innerWidth / 2 : index * step)),
		y: round(plot.padTop + innerHeight - ((point.value - bounds.min) / span) * innerHeight)
	}));
}

/** `M x y L x y …` through the placed points. */
export function linePath(points: PlotPoint[]): string {
	return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

/** The line closed down to a baseline, for a soft fill beneath it. */
export function areaPath(points: PlotPoint[], baseline: number): string {
	const line = linePath(points);
	if (!line) return '';

	const first = points[0];
	const last = points[points.length - 1];
	return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

export interface PlotBar extends TimeSeriesPoint {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Rectangles on a baseline.
 *
 * `gapRatio` is the share of each slot left empty, so bars stay proportionally spaced
 * whatever the width — a fixed pixel gap collapses when a chart gets narrow.
 */
export function plotBars(
	series: TimeSeries,
	plot: Plot,
	bounds: Bounds,
	gapRatio = 0.4
): PlotBar[] {
	const { points } = series;
	if (points.length === 0) return [];

	const innerWidth = plot.width - plot.padLeft - plot.padRight;
	const innerHeight = plot.height - plot.padTop - plot.padBottom;
	const baseline = plot.padTop + innerHeight;
	const span = bounds.max - bounds.min || 1;
	const slot = innerWidth / points.length;
	const width = Math.max(slot * (1 - gapRatio), 1);

	return points.map((point, index) => {
		const height = Math.max(((point.value - bounds.min) / span) * innerHeight, 0);
		return {
			...point,
			x: round(plot.padLeft + index * slot + (slot - width) / 2),
			y: round(baseline - height),
			width: round(width),
			height: round(height)
		};
	});
}

/**
 * Thin an axis's labels so they cannot overlap.
 *
 * Returns the labels to draw and blanks the rest, rather than dropping points: the
 * chart still plots every value, it just does not name every one of them.
 */
export function thinLabels(points: TimeSeriesPoint[], maxLabels: number): string[] {
	if (points.length <= maxLabels) return points.map((point) => point.label);

	const stride = Math.ceil(points.length / maxLabels);
	return points.map((point, index) => (index % stride === 0 ? point.label : ''));
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
