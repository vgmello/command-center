<script lang="ts">
	import { axisTicks, plotBars, seriesBounds } from '$lib/platform/chart';
	import type { Plot } from '$lib/platform/chart';
	import type { TimeSeries } from '$lib/platform/types';

	/**
	 * A single-series bar chart in plain SVG. Same split as `LineChart`: the maths is
	 * in `$lib/platform/chart.ts` and tested there; this only draws.
	 */

	interface Props {
		series: TimeSeries;
		fill?: string;
		height?: number;
	}

	let { series, fill = 'fill-primary', height = 168 }: Props = $props();

	const width = 400;

	const plot = $derived<Plot>({
		width,
		height,
		padLeft: 26,
		padRight: 4,
		padTop: 8,
		padBottom: 20
	});

	const bounds = $derived(seriesBounds([series]));
	const ticks = $derived(axisTicks(bounds));
	const bars = $derived(plotBars(series, plot, bounds));
	const baseline = $derived(plot.height - plot.padBottom);
</script>

<svg
	viewBox="0 0 {width} {height}"
	class="w-full"
	style="height:{height}px"
	role="img"
	aria-label={series.label}
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
			{Math.round(tick)}
		</text>
	{/each}

	{#each bars as bar (bar.label)}
		<rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx="2" class={fill}>
			<title>{bar.label}: {bar.value}</title>
		</rect>
		<text
			x={bar.x + bar.width / 2}
			y={height - 5}
			text-anchor="middle"
			class="fill-muted-foreground text-[9px]"
		>
			{bar.label}
		</text>
	{/each}
</svg>
