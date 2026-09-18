<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import DomainHeader from '$lib/components/domains/DomainHeader.svelte';
	import DomainTabs from '$lib/components/domains/DomainTabs.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainView } from '../../../domains.remote';
	import { DOMAIN_TAB_LABELS } from '$lib/platform/domains';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * The domain sections that are not built yet.
	 *
	 * One route rather than seven placeholder files, and a real route rather than an
	 * inert tab, so every destination in the strip navigates.
	 */

	let { data } = $props();

	const scope = getScope();
	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });
</script>

<svelte:head><title>{DOMAIN_TAB_LABELS[data.tab]} · {slug} · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<svelte:boundary>
		{@const snapshot = await getDomainView(args)}

		{#if !snapshot}
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
			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: snapshot.domain.name, href: `/domains/${snapshot.domain.slug}` },
					{ label: DOMAIN_TAB_LABELS[data.tab] }
				]}
			/>

			<DomainHeader domain={snapshot.domain} />
			<DomainTabs
				slug={snapshot.domain.slug}
				active={data.tab}
				badges={{ alerts: snapshot.domain.activeIncidents }}
			/>

			<div
				class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-24 text-center"
			>
				<span class="text-muted-foreground"><Icon name="layers" size={26} strokeWidth={1.6} /></span
				>
				<p class="text-[15px] font-medium">{DOMAIN_TAB_LABELS[data.tab]} is not built yet.</p>
				<p class="max-w-md text-[13px] text-muted-foreground">
					The Overview tab is the built one. This section has a route so the tab strip navigates,
					and will have content when the data behind it lands.
				</p>
				<a
					href="/domains/{snapshot.domain.slug}"
					class="mt-1 text-[13px] font-medium text-primary hover:text-primary/80"
				>
					Back to overview
				</a>
			</div>
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[300px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[42px] rounded-xl" />
			<Skeleton class="h-[320px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
