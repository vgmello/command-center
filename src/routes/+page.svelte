<script lang="ts">
	import CountTile from '$lib/components/overview/CountTile.svelte';
	import DeploymentsCard from '$lib/components/overview/DeploymentsCard.svelte';
	import DomainHealthTable from '$lib/components/overview/DomainHealthTable.svelte';
	import HealthDistributionCard from '$lib/components/overview/HealthDistributionCard.svelte';
	import IncidentsCard from '$lib/components/overview/IncidentsCard.svelte';
	import InfrastructureCard from '$lib/components/overview/InfrastructureCard.svelte';
	import MetricStrip from '$lib/components/overview/MetricStrip.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainPage, getOverview } from './overview.remote';
	import type { DomainPage, DomainSortKey, HealthStatus } from '$lib/platform/types';

	const scope = getScope();

	let searchInput = $state('');
	let search = $state('');
	let status = $state<HealthStatus | 'all'>('all');
	let sort = $state<DomainSortKey>('health-score');
	let view = $state<'grid' | 'list'>('list');
	let pageNumber = $state(1);

	/*
	 * Typing must not fire a request per keystroke. The raw input drives the
	 * textbox, and only the settled value drives the query.
	 */
	let debounce: ReturnType<typeof setTimeout>;
	function onSearch(value: string) {
		searchInput = value;
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			search = value;
			pageNumber = 1;
		}, 250);
	}

	const scopeArgs = $derived({ environment: scope.environment, timeRange: scope.timeRange });

	const domainArgs = $derived({
		...scopeArgs,
		search,
		status,
		sort,
		page: pageNumber,
		pageSize: 8
	});

	const overview = $derived(getOverview(scopeArgs));
	const domains = $derived(getDomainPage(domainArgs));

	/*
	 * Keep the last successful page on screen while the next one is in flight.
	 * Without this the table would collapse to a skeleton on every filter change,
	 * which reads as the data disappearing rather than being refined.
	 */
	let lastDomainPage = $state<DomainPage | null>(null);
	$effect(() => {
		if (domains.current) lastDomainPage = domains.current;
	});
	const domainPage = $derived(domains.current ?? lastDomainPage);

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => {
			overview.refresh();
			domains.refresh();
		}, scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Overview · Command Center</title></svelte:head>

<div class="flex gap-4 p-5">
	<div class="min-w-0 flex-1 space-y-4">
		<div>
			<h1 class="text-[26px] leading-tight font-semibold tracking-tight">Overview</h1>
			<p class="mt-0.5 text-[13px] text-muted-foreground">Platform-wide operational view</p>
		</div>

		<svelte:boundary>
			{@const snapshot = await getOverview(scopeArgs)}
			<div class="grid gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_3.2fr]">
				{#each snapshot.counts as tile (tile.id)}
					<CountTile {tile} />
				{/each}
				<MetricStrip metrics={snapshot.metrics} />
			</div>

			{#snippet pending()}
				<div class="grid gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_3.2fr]">
					{#each ['total', 'healthy', 'degraded', 'down', 'metrics'] as key (key)}
						<Skeleton class="h-[104px] rounded-xl" />
					{/each}
				</div>
			{/snippet}
		</svelte:boundary>

		{#if domainPage}
			<div class="transition-opacity {domains.loading ? 'opacity-60' : ''}">
				<DomainHealthTable
					result={domainPage}
					search={searchInput}
					{status}
					{sort}
					{view}
					{onSearch}
					onStatusChange={(value) => ((status = value), (pageNumber = 1))}
					onSortChange={(value) => ((sort = value), (pageNumber = 1))}
					onViewChange={(value) => (view = value)}
					onPageChange={(value) => (pageNumber = value)}
				/>
			</div>
		{:else}
			<Skeleton class="h-[620px] rounded-xl" />
		{/if}
	</div>

	<aside class="hidden w-[368px] shrink-0 space-y-4 xl:block">
		<svelte:boundary>
			{@const snapshot = await getOverview(scopeArgs)}
			<HealthDistributionCard distribution={snapshot.distribution} />
			<IncidentsCard incidents={snapshot.incidents} />
			<DeploymentsCard deployments={snapshot.deployments} />
			<InfrastructureCard groups={snapshot.infrastructure} />

			{#snippet pending()}
				<Skeleton class="h-[196px] rounded-xl" />
				<Skeleton class="h-[240px] rounded-xl" />
				<Skeleton class="h-[220px] rounded-xl" />
				<Skeleton class="h-[132px] rounded-xl" />
			{/snippet}
		</svelte:boundary>
	</aside>
</div>
