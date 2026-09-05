<script lang="ts">
	import { axisTicks, niceScale, stackedBands, stackedMax, thinLabels } from '$lib/platform/chart';
	import type { Plot } from '$lib/platform/chart';
	import type { TimeSeries } from '$lib/platform/types';

	/**
	 * Request rate split by endpoint, stacked.
	 *
	 * Stacked rather than overlaid because the question is how the total divides, and
	 * the top edge of a stack is the total — which is the one thing overlaid lines
	 * cannot show.
	 */

	interface Props {
		title: string;
		series: TimeSeries[];
		unit?: string;
		height?: number;
		width?: number;
	}

	let { title, series, unit = '', height = 168, width = 380 }: Props = $props();

	const plot = $derived<Plot>({
		width,
		height,
		padLeft: 30,
		padRight: 6,
		padTop: 8,
		padBottom: 20
	});

	const stack = $derived(
		series.map((one) => ({
			id: one.id,
			label: one.label,
			values: one.points.map((point) => point.value)
		}))
	);

	const buckets = $derived(series[0]?.points.length ?? 0);
	const bounds = $derived(niceScale(stackedMax(stack, buckets), 0, 4));
	const bands = $derived(stackedBands(stack, plot, bounds));
	const ticks = $derived(axisTicks(bounds));
	const labels = $derived(thinLabels(series[0]?.points ?? [], 6));
	const baseline = $derived(plot.height - plot.padBottom);

	/*
	 * A fixed palette by position rather than by endpoint name: the bands are a
	 * breakdown of one quantity, so what matters is that adjacent layers are
	 * distinguishable, not that a particular path is always blue.
	 */
	const LAYERS = [
		{ fill: 'fill-info/70', stroke: 'stroke-info', dot: 'bg-info' },
		{ fill: 'fill-violet-400/70', stroke: 'stroke-violet-400', dot: 'bg-violet-400' },
		{ fill: 'fill-healthy/70', stroke: 'stroke-healthy', dot: 'bg-healthy' },
		{ fill: 'fill-degraded/70', stroke: 'stroke-degraded', dot: 'bg-degraded' },
		{ fill: 'fill-unknown/70', stroke: 'stroke-unknown', dot: 'bg-unknown' }
	];

	const layerFor = (index: number) => LAYERS[index % LAYERS.length];
</script>

<section class="rounded-xl border border-border bg-card p-4">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-[13.5px] font-semibold tracking-tight">{title}</h2>
		{#if unit}
			<span class="text-[10.5px] text-muted-foreground">{unit}</span>
		{/if}
	</div>

	<svg
		viewBox="0 0 {width} {height}"
		class="mt-1 w-full"
		style="height:{height}px"
		role="img"
		aria-label={title}
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

		{#each bands as band, index (band.seriesId)}
			<path d={band.area} class={layerFor(index).fill} stroke="none" />
			<path d={band.line} fill="none" stroke-width="1" class={layerFor(index).stroke} />
		{/each}

		{#each labels as label, index (index)}
			{#if label && buckets > 1}
				{@const x = plot.padLeft + (index / (buckets - 1)) * (width - plot.padLeft - plot.padRight)}
				<text
					{x}
					y={height - 5}
					text-anchor="middle"
					class="fill-muted-foreground text-[9px] tabular-nums"
				>
					{label}
				</text>
			{/if}
		{/each}
	</svg>

	<ul class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
		{#each series as one, index (one.id)}
			<li class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
				<span class="size-2 rounded-full {layerFor(index).dot}" aria-hidden="true"></span>
				{one.label}
			</li>
		{/each}
	</ul>
</section>
