<script lang="ts">
	import { DOMAIN_TABS, DOMAIN_TAB_LABELS, domainTabHref } from '$lib/platform/domains';
	import type { DomainTab } from '$lib/platform/domains';

	interface Props {
		slug: string;
		active: DomainTab;
		badges?: Partial<Record<DomainTab, number>>;
	}

	let { slug, active, badges = {} }: Props = $props();
</script>

<!-- Real links, one route each, so back and middle-click behave. -->
<nav
	class="flex items-center gap-1 overflow-x-auto border-b border-border"
	aria-label="Domain sections"
>
	{#each DOMAIN_TABS as tab (tab)}
		{@const badge = badges[tab]}
		<a
			href={domainTabHref(slug, tab)}
			aria-current={tab === active ? 'page' : undefined}
			class="flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors
				{tab === active
				? 'border-primary text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
		>
			{DOMAIN_TAB_LABELS[tab]}
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
