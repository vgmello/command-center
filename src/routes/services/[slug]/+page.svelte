<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import DependencyGraph from '$lib/components/services/DependencyGraph.svelte';
	import EndpointsCard from '$lib/components/services/EndpointsCard.svelte';
	import HealthChecksCard from '$lib/components/services/HealthChecksCard.svelte';
	import RequestRateCard from '$lib/components/services/RequestRateCard.svelte';
	import ServiceDeploymentsCard from '$lib/components/services/ServiceDeploymentsCard.svelte';
	import ServiceHeader from '$lib/components/services/ServiceHeader.svelte';
	import ServiceInfoCard from '$lib/components/services/ServiceInfoCard.svelte';
	import StatTiles from '$lib/components/StatTiles.svelte';
	import ServiceTabs from '$lib/components/services/ServiceTabs.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getServiceView } from '../../services.remote';
	import { getShell } from '../../shell.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const scope = getScope();

	const slug = $derived(page.params.slug ?? '');
	const args = $derived({
		environment: scope.environment,
		timeRange: scope.timeRange,
		slug
	});

	const shell = $derived(getShell());
	const view = $derived(getServiceView(args));

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => view.refresh(), scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>{slug} · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<svelte:boundary>
		{@const snapshot = await getServiceView(args)}

		{#if !snapshot}
			<!--
				The query resolves to null for a slug that matches nothing, which is an
				ordinary answer to an edited URL rather than a failure. Rendering the
				not-found state here keeps the shell and the nav in place, which a thrown
				404 would replace with an error page.
			-->
			<div class="flex flex-col items-center justify-center gap-2 py-24 text-center">
				<p class="text-[15px] font-medium">No service called “{slug}”.</p>
				<p class="text-[13px] text-muted-foreground">
					It may have been renamed or removed from the catalog.
				</p>
				<a
					href={resolve('/services')}
					class="mt-2 text-[13px] font-medium text-primary hover:text-primary/80"
				>
					Back to all services
				</a>
			</div>
		{:else}
			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: snapshot.service.domainName },
					{ label: 'Services', href: '/services' },
					{ label: snapshot.service.name }
				]}
			/>

			<ServiceHeader service={snapshot.service} />
			<ServiceTabs
				slug={snapshot.service.slug}
				active="overview"
				badges={{ alerts: snapshot.service.activeAlerts }}
			/>

			<StatTiles stats={snapshot.stats} />

			<div class="grid gap-4 xl:grid-cols-[1fr_1.05fr_0.85fr]">
				<HealthChecksCard checks={snapshot.checks} />
				<DependencyGraph service={snapshot.service} dependencies={snapshot.dependencies} />
				<ServiceInfoCard service={snapshot.service} />
			</div>

			<div class="grid gap-4 xl:grid-cols-[1fr_1.05fr_0.85fr]">
				<ServiceDeploymentsCard
					deployments={snapshot.deployments}
					environments={shell.current?.environments ?? []}
				/>
				<RequestRateCard series={snapshot.requestRate} />
				<EndpointsCard endpoints={snapshot.endpoints} />
			</div>
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[320px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[42px] rounded-xl" />
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
				{#each ['a', 'b', 'c', 'd', 'e', 'f'] as key (key)}
					<Skeleton class="h-[124px] rounded-xl" />
				{/each}
			</div>
			<div class="grid gap-4 xl:grid-cols-3">
				<Skeleton class="h-[300px] rounded-xl" />
				<Skeleton class="h-[300px] rounded-xl" />
				<Skeleton class="h-[300px] rounded-xl" />
			</div>
		{/snippet}
	</svelte:boundary>
</div>
