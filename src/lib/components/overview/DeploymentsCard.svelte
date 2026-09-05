<script lang="ts">
	import Icon from '../Icon.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import SectionCard from '../SectionCard.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { DEPLOYMENT_LABELS, deploymentTone } from '../tone';
	import type { Deployment } from '$lib/platform/types';

	interface Props {
		deployments: Deployment[];
	}

	let { deployments }: Props = $props();
</script>

<SectionCard title="Recent Deployments" href="/deployments">
	<ul class="pb-2">
		{#each deployments as deployment (deployment.id)}
			{@const tone = deploymentTone(deployment.status)}
			<li>
				<div class="flex items-center gap-1.5 px-4 py-[7px] transition-colors hover:bg-accent/40">
					<span class="grid size-6 shrink-0 place-items-center rounded-md {tone.chip} border-0">
						<Icon name={deployment.icon} size={13} strokeWidth={2} />
					</span>
					<span class="min-w-0 flex-1 truncate text-[11.5px] font-medium">{deployment.service}</span
					>
					<span class="tabular shrink-0 text-[11px] text-muted-foreground"
						>{deployment.version}</span
					>
					<span class="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">
						{deployment.domainName}
					</span>
					<StatusBadge label={DEPLOYMENT_LABELS[deployment.status]} {tone} />
					<RelativeTime
						value={deployment.deployedAt}
						class="tabular w-[50px] shrink-0 text-right text-[10.5px] whitespace-nowrap text-muted-foreground"
					/>
				</div>
			</li>
		{/each}
	</ul>
</SectionCard>
