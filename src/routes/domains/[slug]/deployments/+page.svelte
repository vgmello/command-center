<script lang="ts">
	import BarChart from '$lib/components/BarChart.svelte';
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import DomainDeployStats from '$lib/components/domains/DomainDeployStats.svelte';
	import DomainHeader from '$lib/components/domains/DomainHeader.svelte';
	import DomainServiceDeploys from '$lib/components/domains/DomainServiceDeploys.svelte';
	import DomainTabs from '$lib/components/domains/DomainTabs.svelte';
	import PanelGap from '$lib/components/PanelGap.svelte';
	import SectionCard from '$lib/components/SectionCard.svelte';
	import ServiceDeploymentsCard from '$lib/components/services/ServiceDeploymentsCard.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainDeployments, getDomainHeader } from '../../../domains.remote';
	import { getShell } from '../../../shell.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * A domain's deployment history, and how it divides between its services.
	 *
	 * The estate's deployments page answers "what shipped"; this one answers "what shipped
	 * here, and which of our services keeps breaking" — which is the per-service table, and
	 * the reason this tab exists rather than a link to a filtered log.
	 *
	 * Two queries, like the Services tab: the header is identical on every tab and changes
	 * only with the scope, so moving between tabs refetches the tab's own payload alone.
	 */

	const scope = getScope();
	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });

	const shell = $derived(getShell());
	const view = $derived(getDomainDeployments(args));

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => view.refresh(), scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Deployments · {slug} · Command Center</title></svelte:head>

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
			{@const snapshot = await getDomainDeployments(args)}

			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: domain.name, href: `/domains/${domain.slug}` },
					{ label: 'Deployments' }
				]}
			/>

			<DomainHeader {domain} />
			<DomainTabs
				slug={domain.slug}
				active="deployments"
				badges={{ alerts: domain.activeIncidents }}
			/>

			{#if snapshot}
				{@const newest = snapshot.log.status === 'ok' ? snapshot.log.data[0] : undefined}

				<DomainDeployStats
					stats={snapshot.stats}
					windowLabel={snapshot.windowLabel}
					lastDeployedAt={newest?.deployedAt ?? null}
				/>

				<div class="grid gap-4 xl:grid-cols-2">
					<SectionCard title="Deployment Frequency">
						<p class="px-4 pb-2 text-[11.5px] text-muted-foreground">{snapshot.windowLabel}</p>
						<div class="px-4 pb-4">
							{#if snapshot.stats.status === 'ok'}
								<BarChart series={snapshot.stats.data.frequency} height={168} />
							{:else}
								<PanelGap panel={snapshot.stats} noun="a deployment frequency trend" />
							{/if}
						</div>
					</SectionCard>

					<DomainServiceDeploys stats={snapshot.stats} windowLabel={snapshot.windowLabel} />
				</div>

				<ServiceDeploymentsCard
					deployments={snapshot.log}
					environments={shell.current?.environments ?? []}
					showService
				/>
			{/if}
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[300px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[38px] rounded-lg" />
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{#each ['a', 'b', 'c', 'd'] as key (key)}
					<Skeleton class="h-[96px] rounded-xl" />
				{/each}
			</div>
			<div class="grid gap-4 xl:grid-cols-2">
				<Skeleton class="h-[280px] rounded-xl" />
				<Skeleton class="h-[280px] rounded-xl" />
			</div>
			<Skeleton class="h-[320px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
