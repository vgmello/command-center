<script lang="ts">
	import BarChart from '../BarChart.svelte';
	import LineChart from '../LineChart.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { sentimentText } from '../tone';
	import { formatChange, trendSentiment } from '$lib/platform/format';
	import type { TimeSeries, TrendDirection, TrendGrain, TrendPolarity } from '$lib/platform/types';
	import type { SelectOption } from '$lib/platform/query';

	/**
	 * One of the two charts under the deployment log.
	 *
	 * Both have the same frame — a title, a grain picker, a headline reading with its
	 * change, and a plot — and differ only in which mark suits the data: counts per
	 * period are bars, a mean over time is a line. That difference is the `kind` prop;
	 * everything else is shared, which is why this is one component and not two.
	 */

	interface Props {
		title: string;
		series: TimeSeries;
		kind: 'bars' | 'line';
		/** Headline value, already formatted — a count, or a duration. */
		formatted: string;
		caption: string;
		changePct: number;
		polarity: TrendPolarity;
		grain: TrendGrain;
		grainOptions: SelectOption<TrendGrain>[];
		onGrainChange: (value: TrendGrain) => void;
		formatValue?: (value: number) => string;
		/** Gutter for the chart's y labels. */
		axisWidth?: number;
	}

	let {
		title,
		series,
		kind,
		formatted,
		caption,
		changePct,
		polarity,
		grain,
		grainOptions,
		onGrainChange,
		formatValue,
		axisWidth
	}: Props = $props();

	const direction: TrendDirection = $derived(
		changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat'
	);
	const sentiment = $derived(trendSentiment(direction, polarity));
	const grainLabel = $derived(grainOptions.find((one) => one.value === grain)?.label ?? '');
</script>

<section class="rounded-xl border border-border bg-card p-4">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-[14.5px] font-semibold tracking-tight">{title}</h2>
		<Select.Root
			type="single"
			value={grain}
			onValueChange={(value) => onGrainChange(value as TrendGrain)}
		>
			<Select.Trigger
				class="h-7 gap-1.5 rounded-lg border-border bg-background px-2.5 text-[11.5px] dark:bg-background"
				aria-label="{title} grain"
			>
				{grainLabel}
			</Select.Trigger>
			<Select.Content>
				{#each grainOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="mt-3 flex items-start gap-4">
		<div class="w-[96px] shrink-0">
			<p class="tabular text-[24px] leading-none font-semibold whitespace-nowrap">{formatted}</p>
			<p class="mt-1 text-[11px] text-muted-foreground">{caption}</p>
			<p class="tabular mt-3 text-[11.5px] {sentimentText(sentiment)}">
				{formatChange(changePct, '%', 0)}
			</p>
			<p class="text-[10.5px] text-muted-foreground">vs yesterday</p>
		</div>

		<div class="min-w-0 flex-1">
			{#if kind === 'bars'}
				<BarChart {series} height={150} />
			{:else}
				<LineChart
					series={[series]}
					strokes={{ [series.id]: 'stroke-info' }}
					height={150}
					maxLabels={7}
					{formatValue}
					{axisWidth}
				/>
			{/if}
		</div>
	</div>
</section>
