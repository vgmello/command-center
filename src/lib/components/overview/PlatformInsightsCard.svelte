<script lang="ts">
	import Icon from '../Icon.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { severityTone } from '../tone';
	import type { MetricInsight } from '$lib/platform/types';
	import type { Panel } from '$lib/platform/sources';

	interface Props {
		insights: Panel<MetricInsight[]>;
	}

	let { insights }: Props = $props();

	// "No source derives these" and "the estate is behaving" are different sentences a
	// reader acts on differently — one is a configuration gap, the other is good news.
	let rows = $derived(insights.status === 'ok' ? insights.data : []);

	const ICONS = { critical: 'circle-alert', warning: 'triangle-alert', info: 'info' } as const;
</script>

<SectionCard title="Platform Insights">
	<ul class="px-4 pb-3">
		{#each rows as insight (insight.id)}
			{@const tone = severityTone(insight.severity)}
			<li class="flex items-start gap-2.5 py-2">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg {tone.chip} border-0">
					<Icon name={ICONS[insight.severity]} size={14} strokeWidth={2} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12px] font-medium">{insight.title}</span>
					<span class="block text-[10.5px] leading-snug text-muted-foreground">
						{insight.detail}
					</span>
				</span>
				<span class="shrink-0 text-[10.5px] text-muted-foreground">
					<RelativeTime value={insight.startedAt} />
				</span>
			</li>
		{:else}
			<li class="py-6 text-center text-[12px] text-muted-foreground">
				{#if insights.status === 'unavailable'}
					No connected APM source derives platform insights.
				{:else if insights.status === 'failed'}
					{insights.source?.name ?? 'The APM source'} did not answer.
				{:else}
					Nothing across the estate is outside its normal range.
				{/if}
			</li>
		{/each}
	</ul>
</SectionCard>
