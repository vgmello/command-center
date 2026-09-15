<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import DomainHeader from '$lib/components/domains/DomainHeader.svelte';
	import DomainTabs from '$lib/components/domains/DomainTabs.svelte';
	import DomainDependencyGraph from '$lib/components/domains/DomainDependencyGraph.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainHeader, getDomainDependencies } from '../../../domains.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * The dependency graph, on its own page.
	 *
	 * Its own route rather than a panel on the overview because the drawn graph needs about
	 * nine hundred pixels to place two columns either side of a hub, and the overview's side
	 * column is 368. The card there summarises the same data and links here.
	 *
	 * A real route also means the tab strip's Dependencies entry navigates, so back,
	 * middle-click and a pasted link all behave — the rule the placeholder tabs exist for.
	 */

	const scope = getScope();
	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });
</script>

<svelte:head><title>Dependencies · {slug} · Command Center</title></svelte:head>

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
			<!--
				Non-null: the wrapper only returns null when the domain itself is missing,
				and the `{#if !domain}` branch above already handled that case.
			-->
			{@const dependencies = (await getDomainDependencies(args))!}

			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: domain.name, href: `/domains/${domain.slug}` },
					{ label: 'Dependencies' }
				]}
			/>

			<DomainHeader {domain} />
			<DomainTabs
				slug={domain.slug}
				active="dependencies"
				badges={{ alerts: domain.activeIncidents }}
			/>

			<DomainDependencyGraph {domain} {dependencies} />
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[300px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[38px] rounded-lg" />
			<Skeleton class="h-[520px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
