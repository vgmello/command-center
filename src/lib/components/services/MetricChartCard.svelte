<script lang="ts">
	import LineChart from '../LineChart.svelte';
	import type { TimeSeries } from '$lib/platform/types';

	/**
	 * One plotted metric, with its own frame.
	 *
	 * Takes a list of series rather than one, because the difference between "request
	 * rate" and "CPU and memory" is how many lines are on the axis and nothing else.
	 * The legend appears whenever there is more than one, since a single labelled line
	 * has a title above it already.
	 */

	interface Props {
		title: string;
		series: TimeSeries[];
		/** A stroke class per series id, so colour stays a decision of `tone.ts`. */
		strokes: Record<string, string>;
		areas?: Record<string, string>;
		unit?: string;
		height?: number;
		width?: number;
		axisWidth?: number;
		formatValue?: (value: number) => string;
	}

	let {
		title,
		series,
		strokes,
		areas = {},
		unit = '',
		height = 168,
		width = 460,
		axisWidth = 34,
		formatValue
	}: Props = $props();

	/*
	 * The dot at every point stops reading as data past about forty of them and starts
	 * reading as a thick line, so a dense series drops them.
	 */
	const dense = $derived((series[0]?.points.length ?? 0) > 40);

	const DOTS: Record<string, string> = {
		'stroke-info': 'bg-info',
		'stroke-healthy': 'bg-healthy',
		'stroke-degraded': 'bg-degraded',
		'stroke-down': 'bg-down',
		'stroke-violet-400': 'bg-violet-400',
		'stroke-unknown': 'bg-unknown'
	};
</script>

<section class="rounded-xl border border-border bg-card p-4">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-[13.5px] font-semibold tracking-tight">{title}</h2>
		{#if unit}
			<span class="text-[10.5px] text-muted-foreground">{unit}</span>
		{/if}
	</div>

	<div class="mt-1">
		<LineChart
			{series}
			{strokes}
			{areas}
			{height}
			{width}
			{axisWidth}
			{formatValue}
			dots={!dense}
			maxLabels={8}
		/>
	</div>

	<ul class="mt-1 flex flex-wrap items-center gap-3">
		{#each series as one (one.id)}
			<li class="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
				<span class="size-2 rounded-full {DOTS[strokes[one.id]] ?? 'bg-info'}" aria-hidden="true"
				></span>
				{one.label}
			</li>
		{/each}
	</ul>
</section>
