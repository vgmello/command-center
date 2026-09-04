<script lang="ts">
	import CountTile from '$lib/components/CountTile.svelte';
	import DeploymentLog from '$lib/components/deployments/DeploymentLog.svelte';
	import DeploymentStatusChart from '$lib/components/deployments/DeploymentStatusChart.svelte';
	import DomainBreakdownCard from '$lib/components/deployments/DomainBreakdownCard.svelte';
	import InsightsCard from '$lib/components/deployments/InsightsCard.svelte';
	import RateTile from '$lib/components/RateTile.svelte';
	import RecentServicesStrip from '$lib/components/deployments/RecentServicesStrip.svelte';
	import TrendCard from '$lib/components/deployments/TrendCard.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDeploymentPage, getDeploymentsView } from '../deployments.remote';
	import { getShell } from '../shell.remote';
	import {
		ALL_DOMAINS,
		ALL_ENVIRONMENTS,
		durationAxisFormatter,
		formatDuration
	} from '$lib/platform/deployments';
	import type { DeploymentStateFilter, DeploymentWindow } from '$lib/platform/deployments';
	import type { DeploymentPage, EnvironmentId, TrendGrain } from '$lib/platform/types';

	const scope = getScope();

	let searchInput = $state('');
	let search = $state('');
	// Named `tab`, not `state`: a variable called `state` shadows the `$state` rune.
	let tab = $state<DeploymentStateFilter>('all');
	let domain = $state(ALL_DOMAINS);
	let environment = $state<EnvironmentId | typeof ALL_ENVIRONMENTS>(ALL_ENVIRONMENTS);
	let dateWindow = $state<DeploymentWindow>('any');
	let grain = $state<TrendGrain>('daily');
	let pageNumber = $state(1);
	let pageSizeOverride = $state<number | null>(null);

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

	function clearFilters() {
		refine(() => {
			searchInput = '';
			search = '';
			domain = ALL_DOMAINS;
			environment = ALL_ENVIRONMENTS;
			dateWindow = 'any';
		});
	}

	const scopeArgs = $derived({ environment: scope.environment, timeRange: scope.timeRange });

	const shell = $derived(getShell());
	const pageSize = $derived(pageSizeOverride ?? shell.current?.deploymentsPageSize ?? 8);

	const logArgs = $derived({
		scope: scopeArgs,
		query: {
			search,
			state: tab,
			domain,
			environment,
			window: dateWindow,
			page: pageNumber,
			pageSize
		}
	});

	const snapshot = $derived(getDeploymentsView({ ...scopeArgs, grain }));
	const log = $derived(getDeploymentPage(logArgs));

	/*
	 * Keep the last successful page on screen while the next is in flight, so a tab
	 * switch reads as the table being refined rather than the data disappearing.
	 */
	let lastPage = $state<DeploymentPage | null>(null);
	$effect(() => {
		if (log.current) lastPage = log.current;
	});
	const logPage = $derived(log.current ?? lastPage);

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => {
			snapshot.refresh();
			log.refresh();
		}, scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Deployments · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<div>
		<h1 class="text-[26px] leading-tight font-semibold tracking-tight">Deployments</h1>
		<p class="mt-0.5 text-[13px] text-muted-foreground">
			Real-time visibility of all deployments across domains and services
		</p>
	</div>

	<svelte:boundary>
		{@const view = await getDeploymentsView({ ...scopeArgs, grain })}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
			{#each view.counts as tile (tile.id)}
				<CountTile {tile} />
			{/each}
			{#each view.rates as tile (tile.id)}
				<RateTile {tile} />
			{/each}
		</div>

		{#snippet pending()}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
				{#each ['a', 'b', 'c', 'd', 'e', 'f'] as key (key)}
					<Skeleton class="h-[104px] rounded-xl" />
				{/each}
			</div>
		{/snippet}
	</svelte:boundary>

	<div class="flex gap-4">
		<div class="min-w-0 flex-1 space-y-4">
			{#if logPage && shell.current && snapshot.current}
				<div class="transition-opacity {log.loading ? 'opacity-60' : ''}">
					<DeploymentLog
						result={logPage}
						stateOptions={shell.current.deploymentStates}
						windowOptions={shell.current.deploymentWindows}
						pageSizes={shell.current.deploymentPageSizes}
						domains={snapshot.current.domains}
						environments={shell.current.environments}
						search={searchInput}
						state={tab}
						{domain}
						{environment}
						window={dateWindow}
						{onSearch}
						onStateChange={(value) => refine(() => (tab = value))}
						onDomainChange={(value) => refine(() => (domain = value))}
						onEnvironmentChange={(value) => refine(() => (environment = value))}
						onWindowChange={(value) => refine(() => (dateWindow = value))}
						onClearFilters={clearFilters}
						onPageChange={(value) => (pageNumber = value)}
						onPageSizeChange={(value) => refine(() => (pageSizeOverride = value))}
					/>
				</div>
			{:else}
				<Skeleton class="h-[560px] rounded-xl" />
			{/if}

			<svelte:boundary>
				{@const view = await getDeploymentsView({ ...scopeArgs, grain })}
				<div class="grid gap-4 lg:grid-cols-2">
					<TrendCard
						title="Deployment Frequency"
						series={view.frequency}
						kind="bars"
						formatted={String(view.summary.total)}
						caption="Deployments"
						changePct={view.summary.totalChangePct}
						polarity="higher-is-better"
						{grain}
						grainOptions={shell.current?.trendGrains ?? []}
						onGrainChange={(value) => (grain = value)}
					/>
					<TrendCard
						title="Mean Deployment Time"
						series={view.meanDuration}
						kind="line"
						formatted={formatDuration(view.summary.meanDurationSeconds)}
						caption="Mean time"
						changePct={view.summary.meanDurationChangePct}
						polarity="lower-is-better"
						{grain}
						grainOptions={shell.current?.trendGrains ?? []}
						onGrainChange={(value) => (grain = value)}
						formatValue={durationAxisFormatter(view.meanDuration.max)}
						axisWidth={38}
					/>
				</div>

				{#snippet pending()}
					<div class="grid gap-4 lg:grid-cols-2">
						<Skeleton class="h-[226px] rounded-xl" />
						<Skeleton class="h-[226px] rounded-xl" />
					</div>
				{/snippet}
			</svelte:boundary>
		</div>

		<aside class="hidden w-[400px] shrink-0 space-y-4 xl:block">
			<svelte:boundary>
				{@const view = await getDeploymentsView({ ...scopeArgs, grain })}
				<DeploymentStatusChart
					series={view.statusTrend}
					ranges={shell.current?.timeRanges ?? []}
					range={scope.timeRange}
					onRangeChange={(value) => (scope.timeRange = value)}
				/>
				<DomainBreakdownCard breakdown={view.byDomain} />
				<InsightsCard insights={view.insights} />

				{#snippet pending()}
					<Skeleton class="h-[248px] rounded-xl" />
					<Skeleton class="h-[214px] rounded-xl" />
					<Skeleton class="h-[188px] rounded-xl" />
				{/snippet}
			</svelte:boundary>
		</aside>
	</div>

	<svelte:boundary>
		{@const view = await getDeploymentsView({ ...scopeArgs, grain })}
		<RecentServicesStrip deployments={view.recent} />

		{#snippet pending()}
			<Skeleton class="h-[152px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
