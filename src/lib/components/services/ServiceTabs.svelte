<script lang="ts">
	import { SERVICE_TAB_LABELS, SERVICE_TABS, serviceTabHref } from '$lib/platform/services';
	import type { ServiceTab } from '$lib/platform/services';

	interface Props {
		slug: string;
		active: ServiceTab;
		/** Per-tab counts, e.g. open alerts. Absent keys render no pill. */
		badges?: Partial<Record<ServiceTab, number>>;
	}

	let { slug, active, badges = {} }: Props = $props();
</script>

<!--
	Real links, not buttons: each tab is a route, so the browser's back button, a
	middle-click and a pasted URL all behave. `resolve()` cannot be used here — it is
	typed against literal routes and these are built from a slug — which is why the
	href is assembled by `serviceTabHref`, the one place that knows the shape.
-->
<nav
	class="flex items-center gap-1 overflow-x-auto border-b border-border"
	aria-label="Service sections"
>
	{#each SERVICE_TABS as tab (tab)}
		{@const badge = badges[tab]}
		<a
			href={serviceTabHref(slug, tab)}
			aria-current={tab === active ? 'page' : undefined}
			class="flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors
				{tab === active
				? 'border-primary text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
		>
			{SERVICE_TAB_LABELS[tab]}
			{#if badge}
				<span
					class="grid min-w-[17px] place-items-center rounded-full bg-down/15 px-1 text-[10px] font-semibold text-down"
				>
					{badge}
				</span>
			{/if}
		</a>
	{/each}
</nav>
