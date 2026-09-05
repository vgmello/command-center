<script lang="ts">
	import Sparkline from '../Sparkline.svelte';
	import { sentimentStroke, sentimentText } from '../tone';
	import { trendSentiment } from '$lib/platform/format';
	import type { RateMetric } from '$lib/platform/types';

	interface Props {
		metrics: RateMetric[];
	}

	let { metrics }: Props = $props();
</script>

<article class="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card">
	{#each metrics as metric (metric.id)}
		{@const sentiment = trendSentiment(metric.direction, metric.polarity)}
		<div class="min-w-0 px-3.5 py-2.5">
			<p class="text-[12px] font-medium text-muted-foreground">{metric.label}</p>
			<p class="tabular mt-1.5 flex items-baseline gap-1 text-[21px] leading-none font-semibold">
				{metric.formatted}
				{#if metric.unit}
					<span class="text-[12px] font-medium text-muted-foreground">{metric.unit}</span>
				{/if}
			</p>
			<Sparkline
				series={metric.series}
				width={160}
				height={22}
				stroke={sentimentStroke(sentiment)}
				class="mt-2 h-[22px] w-full"
			/>
			<p class="tabular mt-1.5 text-[10.5px] whitespace-nowrap">
				<span class="font-medium {sentimentText(sentiment)}">{metric.changeFormatted}</span>
				<span class="text-muted-foreground"> {metric.comparedToLabel}</span>
			</p>
		</div>
	{/each}
</article>
