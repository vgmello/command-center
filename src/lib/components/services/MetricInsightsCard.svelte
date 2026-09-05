<script lang="ts">
	import Icon from '../Icon.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import SectionCard from '../SectionCard.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { severityTone } from '../tone';
	import type { MetricInsight } from '$lib/platform/types';
	import type { Panel } from '$lib/platform/sources';

	interface Props {
		insights: Panel<MetricInsight[]>;
	}

	let { insights }: Props = $props();

	// "No source does this" and "this source found nothing" are different sentences a
	// reader acts on differently — one is a configuration gap, the other is good news.
	let rows = $derived(insights.status === 'ok' ? insights.data : []);

	const ICONS = { critical: 'circle-alert', warning: 'triangle-alert', info: 'info' } as const;

	/*
	 * An anomaly is a reading outside its normal range; an insight is a movement that is
	 * merely worth knowing. The badge says which, because a reader triages the two
	 * differently and the severity colour alone does not distinguish them.
	 */
	const KIND_LABELS = { anomaly: 'Anomaly', insight: 'Insight' } as const;
</script>

<SectionCard title="Metric Insights" href="/alerts" viewAllLabel="View all insights">
	<div class="grid gap-4 px-4 pb-4 lg:grid-cols-3">
		{#each rows as insight (insight.id)}
			{@const tone = severityTone(insight.severity)}
			<article class="min-w-0">
				<div class="flex items-center gap-2">
					<span class="grid size-6 shrink-0 place-items-center rounded-md {tone.chip} border-0">
						<Icon name={ICONS[insight.severity]} size={13} strokeWidth={2.2} />
					</span>
					<span class="truncate text-[13px] font-medium">{insight.title}</span>
					<StatusBadge label={KIND_LABELS[insight.kind]} {tone} />
				</div>

				<p class="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{insight.detail}</p>

				<p class="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
					<span>Started</span>
					<RelativeTime value={insight.startedAt} class="tabular" />
					<span aria-hidden="true">·</span>
					<span class="truncate">Affects: {insight.affects}</span>
				</p>
			</article>
		{:else}
			<p class="py-6 text-center text-[12px] text-muted-foreground lg:col-span-3">
				{#if insights.status === 'unavailable'}
					No connected APM source reports insights.
				{:else if insights.status === 'failed'}
					{insights.source?.name ?? 'The APM source'} did not answer.
				{:else}
					Nothing outside its normal range.
				{/if}
			</p>
		{/each}
	</div>
</SectionCard>
