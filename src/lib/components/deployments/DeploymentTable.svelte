<script lang="ts">
	import Icon from '../Icon.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import { DEPLOYMENT_ICONS, DEPLOYMENT_LABELS, deploymentTone } from '../tone';
	import { DEPLOYMENT_TRIGGER_LABELS, formatDuration } from '$lib/platform/deployments';
	import type { Deployment, EnvironmentOption } from '$lib/platform/types';

	interface Props {
		deployments: Deployment[];
		/** Environment labels come from the server, so this list exists in one place. */
		environments: EnvironmentOption[];
	}

	let { deployments, environments }: Props = $props();

	const environmentLabel = $derived(
		(id: Deployment['environment']) => environments.find((one) => one.id === id)?.label ?? id
	);
</script>

<Table.Root>
	<Table.Header>
		<Table.Row class="border-border hover:bg-transparent">
			<Table.Head class="h-9 w-[132px] pl-4 text-[11.5px] font-medium">Deployment</Table.Head>
			<Table.Head class="h-9 w-[142px] text-[11.5px] font-medium">Service</Table.Head>
			<Table.Head class="h-9 w-[132px] text-[11.5px] font-medium">Domain</Table.Head>
			<Table.Head class="h-9 w-[96px] text-[11.5px] font-medium">Environment</Table.Head>
			<Table.Head class="h-9 w-[104px] text-[11.5px] font-medium">Status</Table.Head>
			<Table.Head class="h-9 w-[68px] text-[11.5px] font-medium">Version</Table.Head>
			<Table.Head class="h-9 w-[86px] text-[11.5px] font-medium">Deployed At</Table.Head>
			<Table.Head class="h-9 w-[110px] text-[11.5px] font-medium">Deployed By</Table.Head>
			<Table.Head class="h-9 w-[74px] text-[11.5px] font-medium">Duration</Table.Head>
			<Table.Head class="h-9 w-[36px] pr-3 text-right text-[11.5px] font-medium"></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each deployments as deployment (deployment.id)}
			{@const tone = deploymentTone(deployment.status)}
			<Table.Row class="border-border">
				<Table.Cell class="max-w-[132px] py-2 pl-4">
					<span class="flex items-center gap-2">
						<span class="grid size-7 shrink-0 place-items-center rounded-lg {tone.chip} border-0">
							<Icon name={deployment.icon} size={14} strokeWidth={1.9} />
						</span>
						<span class="min-w-0">
							<span class="tabular block truncate text-[12.5px] font-medium">
								{deployment.reference}
							</span>
							<span class="block truncate text-[10.5px] text-muted-foreground">
								{DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]}
							</span>
						</span>
					</span>
				</Table.Cell>
				<Table.Cell class="max-w-[142px] py-2">
					<span class="block truncate text-[12.5px]" title={deployment.service}>
						{deployment.service}
					</span>
				</Table.Cell>
				<Table.Cell class="max-w-[132px] py-2">
					<span class="block truncate text-[12.5px] text-muted-foreground">
						{deployment.domainName}
					</span>
				</Table.Cell>
				<Table.Cell class="py-2 text-[12.5px] text-muted-foreground">
					{environmentLabel(deployment.environment)}
				</Table.Cell>
				<Table.Cell class="py-2">
					<StatusBadge
						label={DEPLOYMENT_LABELS[deployment.status]}
						{tone}
						icon={DEPLOYMENT_ICONS[deployment.status]}
					/>
				</Table.Cell>
				<Table.Cell class="tabular py-2 text-[12.5px]">{deployment.version}</Table.Cell>
				<Table.Cell class="py-2">
					<RelativeTime
						value={deployment.deployedAt}
						class="tabular text-[12.5px] whitespace-nowrap text-muted-foreground"
					/>
				</Table.Cell>
				<Table.Cell class="max-w-[110px] py-2">
					<span class="block truncate text-[12.5px] text-muted-foreground">
						{deployment.deployedBy}
					</span>
				</Table.Cell>
				<Table.Cell class="tabular py-2 text-[12.5px] text-muted-foreground">
					{formatDuration(deployment.durationSeconds)}
				</Table.Cell>
				<Table.Cell class="py-2 pr-3 text-right">
					<button
						type="button"
						aria-label="Actions for {deployment.reference}"
						class="inline-grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<Icon name="ellipsis" size={16} />
					</button>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
