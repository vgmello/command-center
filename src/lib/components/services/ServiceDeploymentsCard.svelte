<script lang="ts">
	import RelativeTime from '../RelativeTime.svelte';
	import SectionCard from '../SectionCard.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { DEPLOYMENT_LABELS, deploymentTone } from '../tone';
	import { DEPLOYMENT_TRIGGER_LABELS } from '$lib/platform/deployments';
	import type { Deployment, EnvironmentOption } from '$lib/platform/types';

	interface Props {
		deployments: Deployment[];
		environments: EnvironmentOption[];
	}

	let { deployments, environments }: Props = $props();

	const environmentLabel = $derived(
		(id: Deployment['environment']) => environments.find((one) => one.id === id)?.label ?? id
	);
</script>

<SectionCard title="Recent Deployments" href="/deployments">
	<table class="w-full">
		<thead>
			<tr class="text-[11px] text-muted-foreground">
				<th class="px-4 pb-1.5 text-left font-medium">Version</th>
				<th class="pb-1.5 text-left font-medium">Environment</th>
				<th class="pb-1.5 text-left font-medium">Status</th>
				<th class="pb-1.5 text-left font-medium">Deployed At</th>
				<th class="px-4 pb-1.5 text-left font-medium">Deployed By</th>
			</tr>
		</thead>
		<tbody>
			{#each deployments as deployment (deployment.id)}
				{@const tone = deploymentTone(deployment.status)}
				<tr class="border-t border-border/60">
					<td class="tabular px-4 py-[7px] text-[12.5px]">{deployment.version}</td>
					<td class="py-[7px] text-[12.5px] text-muted-foreground">
						{environmentLabel(deployment.environment)}
					</td>
					<td class="py-[7px]">
						<StatusBadge label={DEPLOYMENT_LABELS[deployment.status]} {tone} />
					</td>
					<td class="py-[7px]">
						<RelativeTime
							value={deployment.deployedAt}
							class="tabular text-[12.5px] whitespace-nowrap text-muted-foreground"
						/>
					</td>
					<td class="max-w-[110px] truncate px-4 py-[7px] text-[12.5px] text-muted-foreground">
						{DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]}
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan="5" class="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
						No deployments recorded for this service.
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</SectionCard>
