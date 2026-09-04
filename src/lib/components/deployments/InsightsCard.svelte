<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { severityTone } from '../tone';
	import type { DeploymentInsight } from '$lib/platform/types';
	import type { Panel } from '$lib/platform/sources';

	interface Props {
		insights: Panel<DeploymentInsight[]>;
	}

	let { insights }: Props = $props();

	// "No source does this" and "this source found nothing" are different sentences, and
	// a reader acts on them differently — one is a configuration gap, the other is good
	// news. The panel keeps them apart rather than collapsing both into an empty list.
	let rows = $derived(insights.status === 'ok' ? insights.data : []);
</script>

<SectionCard title="Deployment Insights">
	<ul class="px-4 pb-3">
		{#each rows as insight (insight.id)}
			{@const tone = severityTone(insight.severity)}
			<li class="flex items-start gap-2.5 py-2">
				<span class="grid size-7 shrink-0 place-items-center rounded-lg {tone.chip} border-0">
					<Icon name={insight.icon} size={14} strokeWidth={2} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12px] font-medium">{insight.title}</span>
					<span class="block text-[10.5px] leading-snug text-muted-foreground">
						{insight.detail}
					</span>
				</span>
			</li>
		{:else}
			<li class="py-6 text-center text-[12px] text-muted-foreground">
				{#if insights.status === 'unavailable'}
					No connected deployment source reports insights.
				{:else if insights.status === 'failed'}
					{insights.source?.name ?? 'The deployment source'} did not answer.
				{:else}
					Nothing worth flagging in this period.
				{/if}
			</li>
		{/each}
	</ul>
</SectionCard>
