<script lang="ts">
	import Icon from '../Icon.svelte';

	/**
	 * A trail of ancestors.
	 *
	 * An entry without an `href` renders as text. That is how a step whose route does
	 * not exist yet — a single domain, say — stays in the trail for orientation without
	 * offering a click that 404s.
	 */
	export interface Crumb {
		label: string;
		href?: string;
	}

	interface Props {
		trail: Crumb[];
	}

	let { trail }: Props = $props();
</script>

<nav aria-label="Breadcrumb">
	<ol class="flex flex-wrap items-center gap-1.5 text-[12.5px]">
		{#each trail as crumb, index (crumb.label)}
			{#if index > 0}
				<li aria-hidden="true" class="text-muted-foreground/60">
					<Icon name="chevron-right" size={13} />
				</li>
			{/if}
			<li>
				{#if crumb.href}
					<a
						href={crumb.href}
						class="text-muted-foreground transition-colors hover:text-foreground"
					>
						{crumb.label}
					</a>
				{:else}
					<span
						class={index === trail.length - 1
							? 'font-medium text-foreground'
							: 'text-muted-foreground'}
					>
						{crumb.label}
					</span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
