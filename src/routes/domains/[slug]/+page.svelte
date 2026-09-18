<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import DomainDependenciesCard from '$lib/components/domains/DomainDependenciesCard.svelte';
	import DomainHeader from '$lib/components/domains/DomainHeader.svelte';
	import DomainTabs from '$lib/components/domains/DomainTabs.svelte';
	import ServiceDeploymentsCard from '$lib/components/services/ServiceDeploymentsCard.svelte';
	import ServicesHealthCard from '$lib/components/domains/ServicesHealthCard.svelte';
	import StatTiles from '$lib/components/StatTiles.svelte';
	import TopIssuesCard from '$lib/components/domains/TopIssuesCard.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainView } from '../../domains.remote';
	import { getShell } from '../../shell.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const scope = getScope();

	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });

	const shell = $derived(getShell());
	const view = $derived(getDomainView(args));

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => view.refresh(), scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>{slug} · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<svelte:boundary>
		{@const snapshot = await getDomainView(args)}

		{#if !snapshot}
			<div class="flex flex-col items-center justify-center gap-2 py-24 text-center">
				<p class="text-[15px] font-medium">No domain called “{slug}”.</p>
				<p class="text-[13px] text-muted-foreground">
					It may have been renamed or split into others.
				</p>
				<a
					href={resolve('/domains')}
					class="mt-2 text-[13px] font-medium text-primary hover:text-primary/80"
				>
					Back to all domains
				</a>
			</div>
		{:else}
			<Breadcrumb
				trail={[{ label: 'Domains', href: '/domains' }, { label: snapshot.domain.name }]}
			/>

			<DomainHeader domain={snapshot.domain} />
			<DomainTabs
				slug={snapshot.domain.slug}
				active="overview"
				badges={{ alerts: snapshot.domain.activeIncidents }}
			/>

			<StatTiles stats={snapshot.stats} columns={7} />

			<div class="grid gap-4 xl:grid-cols-2">
				<ServicesHealthCard services={snapshot.services} />
				<DomainDependenciesCard domain={snapshot.domain} dependencies={snapshot.dependencies} />
			</div>

			<div class="grid gap-4 xl:grid-cols-2">
				<ServiceDeploymentsCard
					deployments={snapshot.deployments}
					environments={shell.current?.environments ?? []}
					showService
				/>
				<TopIssuesCard issues={snapshot.issues} />
			</div>
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[240px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[42px] rounded-xl" />
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7">
				{#each ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as key (key)}
					<Skeleton class="h-[124px] rounded-xl" />
				{/each}
			</div>
			<div class="grid gap-4 xl:grid-cols-2">
				<Skeleton class="h-[340px] rounded-xl" />
				<Skeleton class="h-[340px] rounded-xl" />
			</div>
		{/snippet}
	</svelte:boundary>
</div>
