<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		/** Renders the "View all" affordance when set. */
		href?: string;
		viewAllLabel?: string;
		class?: string;
		children: Snippet;
	}

	let { title, href, viewAllLabel = 'View all', class: className = '', children }: Props = $props();
</script>

<section class="rounded-xl border border-border bg-card {className}">
	<div class="flex items-center justify-between px-4 pt-4 pb-3">
		<h2 class="text-[14.5px] font-semibold tracking-tight">{title}</h2>
		{#if href}
			<a
				{href}
				class="flex items-center gap-1 text-[12px] font-medium text-primary transition-colors hover:text-primary/80"
			>
				{viewAllLabel}
				<Icon name="arrow-right" size={13} />
			</a>
		{/if}
	</div>
	{@render children()}
</section>
