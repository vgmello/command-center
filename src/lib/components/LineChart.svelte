<script lang="ts">
	import {
		areaPath,
		axisTicks,
		linePath,
		plotPoints,
		seriesBounds,
		thinLabels
	} from '$lib/platform/chart';
	import type { Plot } from '$lib/platform/chart';
	import type { TimeSeries } from '$lib/platform/types';

	/**
	 * A multi-series line chart in plain SVG.
	 *
	 * All the maths lives in `$lib/platform/chart.ts`, which is pure and tested; this
	 * file only turns the results into elements. That split is what lets the layout be
	 * asserted without rendering anything.
	 */

	interface Props {
		series: TimeSeries[];
		/** A stroke class per series id, so colour stays a decision of `tone.ts`. */
		strokes: Record<string, string>;
		height?: number;
		/** Draws a dot at every point. Off for dense series, where they merge into a band. */
		dots?: boolean;
		/** How many x labels to print; the rest are blanked so the ones left stay aligned. */
		maxLabels?: number;
		formatValue?: (value: number) => string;
		/** Gutter for the y labels. Widen it when they carry a unit, or they clip. */
		axisWidth?: number;
		/** A fill class per series id. Only the named series get an area under the line. */
		areas?: Record<string, string>;
		/**
		 * Width of the coordinate space, not of the rendered chart — the SVG still fills
		 * its container. It has to be near the real width, though: a 460-wide box in a
		 * 200px column is letterboxed to a third of its stated height, because the
		 * viewBox scales to fit the narrower axis.
		 */
		width?: number;
	}

	let {
		series,
		strokes,
		height = 168,
		dots = true,
		maxLabels = 8,
		formatValue = (value: number) => String(Math.round(value)),
		axisWidth = 30,
		areas = {},
		width = 460
	}: Props = $props();

	const plot = $derived<Plot>({
		width,
		height,
		padLeft: axisWidth,
		padRight: 6,
		padTop: 8,
		padBottom: 20
	});

	const bounds = $derived(seriesBounds(series));
	const ticks = $derived(axisTicks(bounds));
	const plotted = $derived(
		series.map((one) => ({
			id: one.id,
			label: one.label,
			points: plotPoints(one, plot, bounds)
		}))
	);
	const labels = $derived(thinLabels(series[0]?.points ?? [], maxLabels));
	const baseline = $derived(plot.height - plot.padBottom);
</script>

<svg
	viewBox="0 0 {width} {height}"
	class="w-full"
	style="height:{height}px"
	role="img"
	aria-label={series.map((one) => one.label).join(', ')}
>
	{#each ticks as tick (tick)}
		{@const y =
			plot.padTop +
			(baseline - plot.padTop) * (1 - (tick - bounds.min) / (bounds.max - bounds.min || 1))}
		<line x1={plot.padLeft} x2={width - plot.padRight} y1={y} y2={y} class="stroke-border" />
		<text
			x={plot.padLeft - 6}
			y={y + 3}
			text-anchor="end"
			class="fill-muted-foreground text-[9px] tabular-nums"
		>
			{formatValue(tick)}
		</text>
	{/each}

	{#each plotted as one (one.id)}
		{#if areas[one.id]}
			<path d={areaPath(one.points, baseline)} stroke="none" class={areas[one.id]} />
		{/if}
		<path d={linePath(one.points)} fill="none" stroke-width="1.6" class={strokes[one.id]} />
		{#if dots}
			{#each one.points as point, index (index)}
				<circle cx={point.x} cy={point.y} r="2.4" class="{strokes[one.id]} fill-card" />
			{/each}
		{/if}
	{/each}

	{#each labels as label, index (index)}
		{#if label && plotted[0]?.points[index]}
			<text
				x={plotted[0].points[index].x}
				y={height - 5}
				text-anchor="middle"
				class="fill-muted-foreground text-[9px] tabular-nums"
			>
				{label}
			</text>
		{/if}
	{/each}
</svg>
