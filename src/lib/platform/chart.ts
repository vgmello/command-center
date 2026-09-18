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

export interface StackedSeries {
	id: string;
	label: string;
	values: number[];
}

export interface StackedSegment {
	seriesId: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	value: number;
}

/**
 * Rectangles stacked per slot, one column per bucket.
 *
 * Every series must supply a value for every bucket — a stack with holes in it draws a
 * column whose total is not the sum of its parts, which is the one thing a stacked
 * chart is read for. Missing entries are treated as zero rather than skipped, so the
 * columns stay aligned.
 */
export function plotStackedBars(
	series: StackedSeries[],
	labels: string[],
	plot: Plot,
	bounds: Bounds,
	gapRatio = 0.25
): StackedSegment[] {
	if (series.length === 0 || labels.length === 0) return [];

	const innerWidth = plot.width - plot.padLeft - plot.padRight;
	const innerHeight = plot.height - plot.padTop - plot.padBottom;
	const baseline = plot.padTop + innerHeight;
	const span = bounds.max - bounds.min || 1;
	const slot = innerWidth / labels.length;
	const width = Math.max(slot * (1 - gapRatio), 1);

	const segments: StackedSegment[] = [];

	labels.forEach((label, index) => {
		const x = round(plot.padLeft + index * slot + (slot - width) / 2);
		let consumed = 0;

		for (const one of series) {
			const value = one.values[index] ?? 0;
			const height = (value / span) * innerHeight;
			segments.push({
				seriesId: one.id,
				label,
				x,
				y: round(baseline - consumed - height),
				width: round(width),
				height: round(Math.max(height, 0)),
				value
			});
			consumed += height;
		}
	});

	return segments;
}

/** The tallest column, which is what a stacked chart has to be scaled against. */
export function stackedMax(series: StackedSeries[], buckets: number): number {
	let max = 0;
	for (let index = 0; index < buckets; index++) {
		const total = series.reduce((sum, one) => sum + (one.values[index] ?? 0), 0);
		if (total > max) max = total;
	}
	return max;
}

export interface StackedBand {
	seriesId: string;
	label: string;
	/** Filled path: the band's own top edge, closed along the band below it. */
	area: string;
	/** The top edge alone, for a hairline that keeps adjacent bands apart. */
	line: string;
}

/**
 * Cumulative areas, one band per series.
 *
 * Each band is drawn between the running total below it and the running total
 * including it, so the top of the stack is the sum — which is the only thing a stacked
 * area is read for. Drawing each series from the baseline and relying on opacity would
 * show a top edge that is not the total.
 */
export function stackedBands(series: StackedSeries[], plot: Plot, bounds: Bounds): StackedBand[] {
	if (series.length === 0) return [];

	const buckets = Math.max(...series.map((one) => one.values.length));
	if (buckets === 0) return [];

	const innerWidth = plot.width - plot.padLeft - plot.padRight;
	const innerHeight = plot.height - plot.padTop - plot.padBottom;
	const span = bounds.max - bounds.min || 1;
	const step = buckets === 1 ? 0 : innerWidth / (buckets - 1);

	const x = (index: number) =>
		round(plot.padLeft + (buckets === 1 ? innerWidth / 2 : index * step));
	const y = (value: number) =>
		round(plot.padTop + innerHeight - ((value - bounds.min) / span) * innerHeight);

	const running = new Array<number>(buckets).fill(0);

	return series.map((one) => {
		const below = [...running];
		for (let index = 0; index < buckets; index++) {
			running[index] += one.values[index] ?? 0;
		}

		const top = running.map((total, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(total)}`);
		const back = below
			.map((total, index) => ({ total, index }))
			.reverse()
			.map(({ total, index }) => `L ${x(index)} ${y(total)}`);

		return {
			seriesId: one.id,
			label: one.label,
			area: `${top.join(' ')} ${back.join(' ')} Z`,
			line: top.join(' ')
		};
	});
}

export interface HeatCell {
	column: number;
	row: number;
	/** Index into the caller's band list, worst first. */
	band: number;
	value: number;
	columnLabel: string;
}

/**
 * Put a reading into one of an ordered set of bands.
 *
 * Bands are upper bounds, worst first — `[2000, 1000, 500, 200, 100]` reads as "over
 * two seconds, one to two, …". Anything below the last bound falls into the final
 * band, so every value lands somewhere and the legend can never be incomplete.
 */
export function bandFor(value: number, upperBounds: number[]): number {
	for (let index = 0; index < upperBounds.length; index++) {
		if (value >= upperBounds[index]) return index;
	}
	return upperBounds.length;
}

/**
 * Longitude/latitude to a point in an equirectangular box.
 *
 * The simplest projection there is, and the right one here: the map is a locator for a
 * handful of regions, not a chart anyone measures. Anything conformal would need a
 * projection library to place five dots.
 */
export function projectLatLon(
	lat: number,
	lon: number,
	width: number,
	height: number
): { x: number; y: number } {
	return {
		x: round(((lon + 180) / 360) * width),
		y: round(((90 - lat) / 180) * height)
	};
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
