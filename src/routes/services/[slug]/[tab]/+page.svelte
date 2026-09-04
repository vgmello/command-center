<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ServiceHeader from '$lib/components/services/ServiceHeader.svelte';
	import ServiceTabs from '$lib/components/services/ServiceTabs.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getServiceView } from '../../../services.remote';
	import { SERVICE_TAB_LABELS } from '$lib/platform/services';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * The service sections that are not built yet.
	 *
	 * One route rather than seven placeholder files, and a real route rather than an
	 * inert tab: the strip has eight destinations and every one of them navigates, so
	 * back, middle-click and a pasted URL all work. What is missing is the content, and
	 * this says so plainly instead of showing an empty panel that looks broken.
	 */

	let { data } = $props();

	const scope = getScope();

	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });
</script>

<svelte:head><title>{SERVICE_TAB_LABELS[data.tab]} · {slug} · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<svelte:boundary>
		{@const snapshot = await getServiceView(args)}

		{#if !snapshot}
			<div class="flex flex-col items-center justify-center gap-2 py-24 text-center">
				<p class="text-[15px] font-medium">No service called “{slug}”.</p>
				<a
					href={resolve('/services')}
					class="text-[13px] font-medium text-primary hover:text-primary/80"
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
					{ label: snapshot.service.name, href: `/services/${snapshot.service.slug}` },
					{ label: SERVICE_TAB_LABELS[data.tab] }
				]}
			/>

			<ServiceHeader service={snapshot.service} />
			<ServiceTabs
				slug={snapshot.service.slug}
				active={data.tab}
				badges={{ alerts: snapshot.service.activeAlerts }}
			/>

			<div
				class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-24 text-center"
			>
				<span class="text-muted-foreground"><Icon name="layers" size={26} strokeWidth={1.6} /></span
				>
				<p class="text-[15px] font-medium">{SERVICE_TAB_LABELS[data.tab]} is not built yet.</p>
				<p class="max-w-md text-[13px] text-muted-foreground">
					The Overview tab is the built one. This section has a route so the tab strip navigates,
					and will have content when the data behind it lands.
				</p>
				<a
					href="/services/{snapshot.service.slug}"
					class="mt-1 text-[13px] font-medium text-primary hover:text-primary/80"
				>
					Back to overview
				</a>
			</div>
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[360px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[42px] rounded-xl" />
			<Skeleton class="h-[320px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
