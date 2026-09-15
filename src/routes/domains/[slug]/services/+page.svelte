<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import DomainHeader from '$lib/components/domains/DomainHeader.svelte';
	import DomainTabs from '$lib/components/domains/DomainTabs.svelte';
	import DomainServicesTable from '$lib/components/domains/DomainServicesTable.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainHeader, getDomainServices } from '../../../domains.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * A domain's services, listed in full.
	 *
	 * The overview's `ServicesHealthCard` shows five of these in a narrow side column and
	 * links here for the rest — this page is the rest, with room for every column and a
	 * sortable header. A real route so the tab strip's Services entry navigates.
	 */

	const scope = getScope();
	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });
</script>

<svelte:head><title>Services · {slug} · Command Center</title></svelte:head>

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
			{@const rows = await getDomainServices(args)}

			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: domain.name, href: `/domains/${domain.slug}` },
					{ label: 'Services' }
				]}
			/>

			<DomainHeader {domain} />
			<DomainTabs
				slug={domain.slug}
				active="services"
				badges={{ alerts: domain.activeIncidents }}
			/>

			{#if !rows}
				<!--
					`getDomainServices` resolves to `null` here for a reason distinct from a
					missing domain: `getDomainHeader` already proved this domain exists, so a
					`null` at this point means the APM connection behind its vitals is gone, not
					that the domain is. The rows lost are this panel's, not the page's.
				-->
				<div class="rounded-xl border border-border bg-card px-4 py-14 text-center">
					<p class="text-[13px] text-muted-foreground">
						No service data available for this domain right now.
					</p>
				</div>
			{:else}
				{@const healthy = rows.filter((row) => row.status === 'healthy').length}
				{@const degraded = rows.filter((row) => row.status === 'degraded').length}
				{@const down = rows.filter((row) => row.status === 'down').length}

				<!--
					Counted from the rows themselves, not from the domain header's split, so this
					line cannot disagree with what is listed beneath it.
				-->
				<p class="text-[12.5px] text-muted-foreground">
					{rows.length} services · {healthy} healthy · {degraded} degraded · {down} down
				</p>

				<DomainServicesTable {rows} />
			{/if}
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[300px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[38px] rounded-lg" />
			<Skeleton class="h-4 w-[220px] rounded" />
			<Skeleton class="h-[360px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
