<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { severityTone } from '../tone';
	import type { DeploymentInsight } from '$lib/platform/types';

	interface Props {
		insights: DeploymentInsight[];
	}

	let { insights }: Props = $props();
</script>

<SectionCard title="Deployment Insights">
	<ul class="px-4 pb-3">
		{#each insights as insight (insight.id)}
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
				Nothing worth flagging in this period.
			</li>
		{/each}
	</ul>
</SectionCard>
