<script lang="ts">
	import CountTile from '$lib/components/CountTile.svelte';
	import DomainsTable from '$lib/components/domains/DomainsTable.svelte';
	import HealthDistributionCard from '$lib/components/HealthDistributionCard.svelte';
	import IncidentsCard from '$lib/components/IncidentsCard.svelte';
	import RecentChangesCard from '$lib/components/domains/RecentChangesCard.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainPage, getDomainsView } from '../domains.remote';
	import { getShell } from '../shell.remote';
	import { ALL_OWNERS } from '$lib/platform/query';
	import type { ViewMode } from '$lib/components/DomainToolbar.svelte';
	import type { DomainPage } from '$lib/platform/types';
	import type { DomainSortKey, DomainStatusFilter } from '$lib/platform/query';

	const scope = getScope();

	let searchInput = $state('');
	let search = $state('');
	let status = $state<DomainStatusFilter>('all');
	let owner = $state(ALL_OWNERS);
	let sort = $state<DomainSortKey>('health-score');
	let view = $state<ViewMode>('list');
	let pageNumber = $state(1);
	let pageSizeOverride = $state<number | null>(null);

	/*
	 * Typing must not fire a request per keystroke. The raw input drives the textbox,
	 * and only the settled value drives the query.
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

	/** Any change to what is being filtered invalidates the page you were on. */
	function refine(apply: () => void) {
		apply();
		pageNumber = 1;
	}

	const scopeArgs = $derived({ environment: scope.environment, timeRange: scope.timeRange });

	const shell = $derived(getShell());
	// The server decides the default; the reader may override it from the pager.
	const pageSize = $derived(pageSizeOverride ?? shell.current?.domainsPageSize ?? 10);

	const domainArgs = $derived({
		...scopeArgs,
		search,
		status,
		owner,
		sort,
		page: pageNumber,
		pageSize
	});

	const view$ = $derived(getDomainsView(scopeArgs));
	const domains = $derived(getDomainPage(domainArgs));

	/*
	 * Keep the last successful page on screen while the next one is in flight. Without
	 * this the table collapses to a skeleton on every filter change, which reads as the
	 * data disappearing rather than being refined.
	 */
	let lastDomainPage = $state<DomainPage | null>(null);
	$effect(() => {
		if (domains.current) lastDomainPage = domains.current;
	});
	const domainPage = $derived(domains.current ?? lastDomainPage);

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => {
			view$.refresh();
			domains.refresh();
		}, scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Domains · Command Center</title></svelte:head>

<div class="flex gap-4 p-5">
	<div class="min-w-0 flex-1 space-y-4">
		<div>
			<h1 class="text-[26px] leading-tight font-semibold tracking-tight">Domains</h1>
			<p class="mt-0.5 text-[13px] text-muted-foreground">
				Health, ownership, and operational status across all business domains
			</p>
		</div>

		<svelte:boundary>
			{@const snapshot = await getDomainsView(scopeArgs)}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
				{#each snapshot.counts as tile (tile.id)}
					<CountTile {tile} />
				{/each}
			</div>

			{#snippet pending()}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
					{#each ['total', 'healthy', 'degraded', 'down', 'incidents', 'deployments'] as key (key)}
						<Skeleton class="h-[104px] rounded-xl" />
					{/each}
				</div>
			{/snippet}
		</svelte:boundary>

		{#if domainPage && shell.current && view$.current}
			<div class="transition-opacity {domains.loading ? 'opacity-60' : ''}">
				<DomainsTable
					result={domainPage}
					statusOptions={shell.current.domainStatusFilters}
					sortOptions={shell.current.domainSortOptions}
					pageSizes={shell.current.domainPageSizes}
					owners={view$.current.owners}
					search={searchInput}
					{status}
					{owner}
					{sort}
					{view}
					{onSearch}
					onStatusChange={(value) => refine(() => (status = value))}
					onOwnerChange={(value) => refine(() => (owner = value))}
					onSortChange={(value) => refine(() => (sort = value))}
					onViewChange={(value) => (view = value)}
					onPageChange={(value) => (pageNumber = value)}
					onPageSizeChange={(value) => refine(() => (pageSizeOverride = value))}
				/>
			</div>
		{:else}
			<Skeleton class="h-[720px] rounded-xl" />
		{/if}
	</div>

	<aside class="hidden w-[368px] shrink-0 space-y-4 xl:block">
		<svelte:boundary>
			{@const snapshot = await getDomainsView(scopeArgs)}
			<HealthDistributionCard distribution={snapshot.distribution} />
			<IncidentsCard incidents={snapshot.incidents} />
			<RecentChangesCard changes={snapshot.changes} />

			{#snippet pending()}
				<Skeleton class="h-[196px] rounded-xl" />
				<Skeleton class="h-[240px] rounded-xl" />
				<Skeleton class="h-[240px] rounded-xl" />
			{/snippet}
		</svelte:boundary>
	</aside>
</div>
