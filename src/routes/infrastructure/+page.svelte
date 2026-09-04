<script lang="ts">
	import ComputeCard from '$lib/components/infrastructure/ComputeCard.svelte';
	import CostCard from '$lib/components/infrastructure/CostCard.svelte';
	import DatabasesCard from '$lib/components/infrastructure/DatabasesCard.svelte';
	import InfraAlertsCard from '$lib/components/infrastructure/InfraAlertsCard.svelte';
	import InfraTabs from '$lib/components/infrastructure/InfraTabs.svelte';
	import QueuesCard from '$lib/components/infrastructure/QueuesCard.svelte';
	import RegionHealthCard from '$lib/components/infrastructure/RegionHealthCard.svelte';
	import StatTiles from '$lib/components/StatTiles.svelte';
	import StorageCard from '$lib/components/infrastructure/StorageCard.svelte';
	import UtilizationCard from '$lib/components/infrastructure/UtilizationCard.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getInfrastructureView } from '../infrastructure.remote';

	const scope = getScope();
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange });
	const view = $derived(getInfrastructureView(args));

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => view.refresh(), scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Infrastructure · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<div>
		<h1 class="text-[26px] leading-tight font-semibold tracking-tight">Infrastructure</h1>
		<p class="mt-0.5 text-[13px] text-muted-foreground">
			Real-time health and utilization of all infrastructure resources
		</p>
	</div>

	<InfraTabs active="overview" />

	<svelte:boundary>
		{@const snapshot = await getInfrastructureView(args)}

		<StatTiles stats={snapshot.stats} columns={7} />

		<div class="grid gap-4 xl:grid-cols-2">
			<RegionHealthCard regions={snapshot.regions} />
			<ComputeCard nodes={snapshot.nodes} clusters={snapshot.clusters} />
		</div>

		<div class="grid gap-4 xl:grid-cols-[1.75fr_1fr]">
			<UtilizationCard resources={snapshot.resources} />
			<StorageCard
				totalFormatted={snapshot.storage.totalFormatted}
				classes={snapshot.storage.classes}
			/>
		</div>

		<div class="grid gap-4 xl:grid-cols-3">
			<DatabasesCard databases={snapshot.databases} />
			<QueuesCard queues={snapshot.queues} />
			<InfraAlertsCard alerts={snapshot.alerts} />
		</div>

		<CostCard cost={snapshot.cost} />

		{#snippet pending()}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
				{#each ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as key (key)}
					<Skeleton class="h-[104px] rounded-xl" />
				{/each}
			</div>
			<div class="grid gap-4 xl:grid-cols-2">
				<Skeleton class="h-[224px] rounded-xl" />
				<Skeleton class="h-[224px] rounded-xl" />
			</div>
			<div class="grid gap-4 xl:grid-cols-[1.75fr_1fr]">
				<Skeleton class="h-[212px] rounded-xl" />
				<Skeleton class="h-[212px] rounded-xl" />
			</div>
			<div class="grid gap-4 xl:grid-cols-3">
				<Skeleton class="h-[196px] rounded-xl" />
				<Skeleton class="h-[196px] rounded-xl" />
				<Skeleton class="h-[196px] rounded-xl" />
			</div>
			<Skeleton class="h-[232px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
