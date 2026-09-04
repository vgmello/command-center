<script lang="ts">
	import { INFRA_TABS, INFRA_TAB_LABELS, infraTabHref } from '$lib/platform/infrastructure';
	import type { InfraTab } from '$lib/platform/infrastructure';

	interface Props {
		active: InfraTab;
	}

	let { active }: Props = $props();
</script>

<!--
	Real links, one route each, so back and middle-click behave. The hrefs are literal
	per tab but assembled by `infraTabHref`, which is the one place that knows the
	overview lives at the bare path.
-->
<nav
	class="flex items-center gap-1 overflow-x-auto border-b border-border"
	aria-label="Infrastructure sections"
>
	{#each INFRA_TABS as tab (tab)}
		<a
			href={infraTabHref(tab)}
			aria-current={tab === active ? 'page' : undefined}
			class="shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors
				{tab === active
				? 'border-primary text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
		>
			{INFRA_TAB_LABELS[tab]}
		</a>
	{/each}
</nav>
