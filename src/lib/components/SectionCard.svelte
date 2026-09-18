<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		/** Optional mark before the heading. A snippet so the caller owns the size. */
		icon?: Snippet;
		/** Renders the "View all" affordance when set. */
		href?: string;
		viewAllLabel?: string;
		class?: string;
		children: Snippet;
	}

	let {
		title,
		icon,
		href,
		viewAllLabel = 'View all',
		class: className = '',
		children
	}: Props = $props();
</script>

<section class="rounded-xl border border-border bg-card {className}">
	<div class="flex items-center justify-between px-4 pt-4 pb-3">
		<h2 class="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
			{#if icon}<span class="text-muted-foreground">{@render icon()}</span>{/if}
			{title}
		</h2>
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
