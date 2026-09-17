<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import ComputeCard from '$lib/components/infrastructure/ComputeCard.svelte';
	import CostCard from '$lib/components/infrastructure/CostCard.svelte';
	import DatabasesCard from '$lib/components/infrastructure/DatabasesCard.svelte';
	import RegionHealthCard from '$lib/components/infrastructure/RegionHealthCard.svelte';
	import UtilizationCard from '$lib/components/infrastructure/UtilizationCard.svelte';
	import DomainHeader from '$lib/components/domains/DomainHeader.svelte';
	import DomainInfraSummary from '$lib/components/domains/DomainInfraSummary.svelte';
	import DomainTabs from '$lib/components/domains/DomainTabs.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { gapSentence } from '$lib/platform/gaps';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainHeader, getDomainInfrastructure } from '../../../domains.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * What a domain runs on: its regions, its compute, its databases, its utilisation and
	 * its cost — the estate's infrastructure page, narrowed to one domain's tagged
	 * resources.
	 *
	 * A domain with no cloud binding gets one sentence and nothing else: `unbound` is
	 * all-or-nothing across the whole tab (see `collapseUnbound`), so seven identical
	 * "not bound" cards would repeat one fact seven times rather than state it once.
	 *
	 * Two queries, like every other tab: the header is identical on every tab and changes
	 * only with the scope, so moving between tabs refetches the tab's own payload alone.
	 */

	const scope = getScope();
	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });

	const view = $derived(getDomainInfrastructure(args));

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => view.refresh(), scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Infrastructure · {slug} · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<svelte:boundary>
		{@const domain = await getDomainHeader(args)}

		{#if !domain}
			<div class="flex flex-col items-center justify-center gap-2 py-24 text-center">
				<p class="text-[15px] font-medium">No domain called “{slug}”.</p>
				<a
					href={resolve('/domains')}
					class="text-[13px] font-medium text-primary hover:text-primary/80"
				>
					Back to all domains
				</a>
			</div>
		{:else}
			{@const snapshot = await getDomainInfrastructure(args)}

			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: domain.name, href: `/domains/${domain.slug}` },
					{ label: 'Infrastructure' }
				]}
			/>

			<DomainHeader {domain} />
			<DomainTabs
				slug={domain.slug}
				active="infrastructure"
				badges={{ alerts: domain.activeIncidents }}
			/>

			{#if snapshot}
				{#if snapshot.unbound}
					<p class="text-[12px] text-muted-foreground">
						{gapSentence('no-binding', 'cloud', 'infrastructure')}
					</p>
				{:else}
					<DomainInfraSummary summary={snapshot.summary} />

					<div class="grid gap-4 xl:grid-cols-2">
						<RegionHealthCard regions={snapshot.regions} title="Regions (this domain)" />
						<ComputeCard
							nodes={snapshot.nodes}
							clusters={snapshot.clusters}
							title="Compute (this domain)"
							href={null}
						/>
					</div>

					<div class="grid gap-4 xl:grid-cols-2">
						<DatabasesCard
							databases={snapshot.databases}
							title="Databases (this domain)"
							href={null}
						/>
						<UtilizationCard
							resources={snapshot.utilization}
							title="Utilisation (this domain's machines)"
							href={null}
						/>
					</div>

					<CostCard cost={snapshot.cost} title="Tagged spend (this domain, MTD)" href={null} />
				{/if}
			{/if}
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[300px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[38px] rounded-lg" />
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{#each ['a', 'b', 'c', 'd'] as key (key)}
					<Skeleton class="h-[76px] rounded-xl" />
				{/each}
			</div>
			<div class="grid gap-4 xl:grid-cols-2">
				<Skeleton class="h-[280px] rounded-xl" />
				<Skeleton class="h-[280px] rounded-xl" />
			</div>
			<div class="grid gap-4 xl:grid-cols-2">
				<Skeleton class="h-[280px] rounded-xl" />
				<Skeleton class="h-[280px] rounded-xl" />
			</div>
			<Skeleton class="h-[220px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
