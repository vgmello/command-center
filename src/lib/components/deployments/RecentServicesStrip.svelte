<script lang="ts">
	import Icon from '../Icon.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { DEPLOYMENT_ICONS, DEPLOYMENT_LABELS, deploymentTone } from '../tone';
	import type { Deployment } from '$lib/platform/types';

	interface Props {
		deployments: Deployment[];
	}

	let { deployments }: Props = $props();
</script>

<section class="rounded-xl border border-border bg-card p-4">
	<h2 class="text-[14.5px] font-semibold tracking-tight">Recently Deployed Services</h2>

	<!--
		A scroller rather than a grid: the strip shows as many as fit and the rest are a
		swipe away, which is what keeps it one row tall on every width.
	-->
	<ul class="mt-3 flex gap-3 overflow-x-auto pb-1">
		{#each deployments as deployment (deployment.id)}
			{@const tone = deploymentTone(deployment.status)}
			<li class="w-[196px] shrink-0 rounded-lg border border-border bg-background p-3">
				<div class="flex items-center gap-2">
					<span class="grid size-8 shrink-0 place-items-center rounded-lg {tone.chip} border-0">
						<Icon name={deployment.icon} size={15} strokeWidth={1.9} />
					</span>
					<span class="min-w-0">
						<span class="block truncate text-[12.5px] font-medium" title={deployment.service}>
							{deployment.service}
						</span>
						<span class="tabular block text-[11px] text-muted-foreground">{deployment.version}</span
						>
					</span>
				</div>
				<div class="mt-3 flex items-center justify-between gap-2">
					<StatusBadge
						label={DEPLOYMENT_LABELS[deployment.status]}
						{tone}
						icon={DEPLOYMENT_ICONS[deployment.status]}
					/>
					<RelativeTime
						value={deployment.deployedAt}
						class="tabular text-[10.5px] whitespace-nowrap text-muted-foreground"
					/>
				</div>
			</li>
		{/each}
	</ul>
</section>
