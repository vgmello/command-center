<script lang="ts">
	import { page } from '$app/state';
	import Icon from '../Icon.svelte';
	import BrandMark from './BrandMark.svelte';
	import { statusTone } from '../tone';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import type { CurrentUser, FavoriteItem, NavItem, SystemStatus } from '$lib/platform/types';

	interface Props {
		nav: NavItem[];
		favorites: FavoriteItem[];
		user: CurrentUser;
		system: SystemStatus;
	}

	let { nav, favorites, user, system }: Props = $props();

	// Longest matching href wins, so `/domains/payment` highlights Domains rather
	// than Overview, whose href is `/`.
	const activeId = $derived(
		[...nav]
			.filter((item) =>
				item.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(item.href)
			)
			.sort((a, b) => b.href.length - a.href.length)[0]?.id
	);

	const systemTone = $derived(statusTone(system.status));
	const systemIcon = $derived(
		system.status === 'healthy'
			? 'circle-check'
			: system.status === 'degraded'
				? 'circle-alert'
				: 'circle-x'
	);
</script>

<aside
	class="flex h-svh w-[212px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
>
	<div class="flex h-[60px] shrink-0 items-center gap-2.5 px-4">
		<BrandMark />
		<span class="text-[15px] font-semibold tracking-tight text-foreground">Command Center</span>
	</div>

	<nav class="flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
		<ul class="space-y-0.5">
			{#each nav as item (item.id)}
				{@const active = item.id === activeId}
				<li>
					<a
						href={item.href}
						aria-current={active ? 'page' : undefined}
						class="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors
							{active
							? 'bg-sidebar-accent text-sidebar-accent-foreground'
							: 'hover:bg-sidebar-accent/40 hover:text-foreground'}"
					>
						<Icon name={item.icon} size={16} strokeWidth={1.9} />
						<span>{item.label}</span>
						{#if item.badge}
							<span
								class="tabular ml-auto rounded-full bg-down/15 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-down"
							>
								{item.badge}
							</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>

		{#if favorites.length > 0}
			<h2
				class="px-3 pt-6 pb-2 text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase"
			>
				Favorites
			</h2>
			<ul class="space-y-0.5">
				{#each favorites as favorite (favorite.id)}
					<li>
						<a
							href={favorite.href}
							class="group flex h-8 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors hover:bg-sidebar-accent/40 hover:text-foreground"
						>
							<span
								class="ml-0.5 size-2 shrink-0 rounded-full {favorite.pinned
									? 'bg-primary'
									: 'bg-muted-foreground/45'}"
								aria-hidden="true"
							></span>
							<span class="truncate">{favorite.label}</span>
							<span
								class="ml-auto {favorite.pinned
									? 'text-degraded'
									: 'text-transparent group-hover:text-muted-foreground'}"
							>
								<Icon name="star" size={13} />
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</nav>

	<div class="space-y-2 border-t border-sidebar-border p-3">
		<button
			type="button"
			class="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card/60 px-3 py-2.5 text-left transition-colors hover:bg-card"
		>
			<span class={systemTone.text}><Icon name={systemIcon} size={17} /></span>
			<span class="min-w-0">
				<span class="block truncate text-[12px] font-medium text-foreground">{system.label}</span>
				<span class="block truncate text-[11px] text-muted-foreground">{system.detail}</span>
			</span>
			<span class="ml-auto text-muted-foreground"><Icon name="chevron-down" size={15} /></span>
		</button>

		<button
			type="button"
			class="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent/40"
		>
			<Avatar.Root class="size-8">
				<Avatar.Fallback class="bg-primary/15 text-[11px] font-semibold text-primary">
					{user.initials}
				</Avatar.Fallback>
			</Avatar.Root>
			<span class="min-w-0">
				<span class="block truncate text-[12.5px] font-medium text-foreground">{user.name}</span>
				<span class="block truncate text-[11px] text-muted-foreground">{user.role}</span>
			</span>
			<span class="ml-auto text-muted-foreground"><Icon name="chevron-down" size={15} /></span>
		</button>
	</div>
</aside>
