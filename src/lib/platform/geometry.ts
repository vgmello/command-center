import type { DistributionSlice, Series } from './types';

/**
 * SVG path for a sparkline, drawn in a 0..width × 0..height box.
 *
 * Pure maths rather than a charting library: the whole requirement is "polyline
 * through N points", which is API-selection tier 4 territory only if tiers 1–3
 * genuinely cannot do it — and plain SVG can.
 */
export function sparklinePath(series: Series, width: number, height: number, padding = 1): string {
	const { values } = series;
	if (values.length === 0) return '';
	if (values.length === 1) {
		const mid = height / 2;
		return `M 0 ${mid} L ${width} ${mid}`;
	}

	const span = series.max - series.min || 1;
	const usable = height - padding * 2;
	const step = width / (values.length - 1);

	return values
		.map((value, index) => {
			const x = index * step;
			const y = padding + usable - ((value - series.min) / span) * usable;
			return `${index === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`;
		})
		.join(' ');
}

/** Closed version of {@link sparklinePath}, for the soft fill under the line. */
export function sparklineArea(series: Series, width: number, height: number, padding = 1): string {
	const line = sparklinePath(series, width, height, padding);
	if (!line) return '';
	return `${line} L ${round(width)} ${height} L 0 ${height} Z`;
}

export interface DonutSegment extends DistributionSlice {
	/** Length of the drawn arc, in the same units as the circle's circumference. */
	dashLength: number;
	/** Remaining circumference, so `stroke-dasharray` is `length gap`. */
	dashGap: number;
	/** Negative offset that rotates this segment to start where the last one ended. */
	dashOffset: number;
}

/**
 * Turn distribution slices into stroke-dasharray segments of one SVG circle.
 *
 * One circle per slice, each offset by the arc lengths before it. Cheaper and
 * sharper than path arcs, and it animates for free when the numbers change.
 */
export function donutSegments(
	slices: DistributionSlice[],
	radius: number,
	gapDegrees = 2
): DonutSegment[] {
	const circumference = 2 * Math.PI * radius;
	const drawable = slices.filter((slice) => slice.count > 0);
	const total = drawable.reduce((sum, slice) => sum + slice.count, 0);
	if (total === 0) return [];

	const gap = drawable.length > 1 ? (gapDegrees / 360) * circumference : 0;
	let consumed = 0;

	return drawable.map((slice) => {
		const arc = (slice.count / total) * circumference;
		const dashLength = Math.max(arc - gap, 0.5);
		const segment: DonutSegment = {
			...slice,
			dashLength,
			dashGap: circumference - dashLength,
			dashOffset: -consumed
		};
		consumed += arc;
		return segment;
	});
}

/** Arc length for a 0–100 progress ring, e.g. the per-domain health score. */
export function ringDash(percent: number, radius: number): { dash: number; gap: number } {
	const circumference = 2 * Math.PI * radius;
	const clamped = Math.min(100, Math.max(0, percent));
	const dash = (clamped / 100) * circumference;
	return { dash, gap: circumference - dash };
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
