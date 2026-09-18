<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import InfraTabs from '$lib/components/infrastructure/InfraTabs.svelte';
	import { INFRA_TAB_LABELS } from '$lib/platform/infrastructure';
	import { resolve } from '$app/paths';

	/**
	 * The infrastructure sections that are not built yet.
	 *
	 * One route rather than eight placeholder files, and a real route rather than an
	 * inert tab — so every destination in the strip navigates, and the page says plainly
	 * what is missing instead of showing an empty panel that reads as broken.
	 */

	let { data } = $props();
</script>

<svelte:head
	><title>{INFRA_TAB_LABELS[data.tab]} · Infrastructure · Command Center</title></svelte:head
>

<div class="space-y-4 p-5">
	<div>
		<h1 class="text-[26px] leading-tight font-semibold tracking-tight">Infrastructure</h1>
		<p class="mt-0.5 text-[13px] text-muted-foreground">
			Real-time health and utilization of all infrastructure resources
		</p>
	</div>

	<InfraTabs active={data.tab} />

	<div
		class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-24 text-center"
	>
		<span class="text-muted-foreground"><Icon name="server" size={26} strokeWidth={1.6} /></span>
		<p class="text-[15px] font-medium">{INFRA_TAB_LABELS[data.tab]} is not built yet.</p>
		<p class="max-w-md text-[13px] text-muted-foreground">
			The Overview tab is the built one. This section has a route so the tab strip navigates, and
			will have content when the data behind it lands.
		</p>
		<a
			href={resolve('/infrastructure')}
			class="mt-1 text-[13px] font-medium text-primary hover:text-primary/80"
		>
			Back to overview
		</a>
	</div>
</div>
