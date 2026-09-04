<script lang="ts">
	import Icon from './Icon.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ALL_OWNERS } from '$lib/platform/query';
	import type { DomainOwner } from '$lib/platform/types';
	import type { DomainSortKey, DomainStatusFilter, SelectOption } from '$lib/platform/query';

	export type ViewMode = 'grid' | 'list';

	interface Props {
		/** Filter and sort choices, supplied by the server so each list exists once. */
		statusOptions: SelectOption<DomainStatusFilter>[];
		sortOptions: SelectOption<DomainSortKey>[];
		/**
		 * Owners, when the screen offers that filter. Omitted rather than passed empty
		 * on screens that do not: an empty list would render a select with nothing in it.
		 */
		owners?: DomainOwner[];
		search: string;
		status: DomainStatusFilter;
		owner?: string;
		sort: DomainSortKey;
		view: ViewMode;
		onSearch: (value: string) => void;
		onStatusChange: (value: DomainStatusFilter) => void;
		onOwnerChange?: (value: string) => void;
		onSortChange: (value: DomainSortKey) => void;
		onViewChange: (value: ViewMode) => void;
	}

	let {
		statusOptions,
		sortOptions,
		owners,
		search,
		status,
		owner = ALL_OWNERS,
		sort,
		view,
		onSearch,
		onStatusChange,
		onOwnerChange,
		onSortChange,
		onViewChange
	}: Props = $props();

	const statusLabel = $derived(statusOptions.find((o) => o.value === status)?.label ?? 'All');
	const sortLabel = $derived(sortOptions.find((o) => o.value === sort)?.label ?? '');
	const ownerLabel = $derived(
		owner === ALL_OWNERS ? 'All' : (owners?.find((o) => o.id === owner)?.label ?? owner)
	);

	const views = [
		{ value: 'grid', icon: 'layout-grid', label: 'Grid view' },
		{ value: 'list', icon: 'list', label: 'List view' }
	] as const;
</script>

<div class="flex flex-wrap items-center gap-2.5 px-4 py-3.5">
	<div class="relative w-full max-w-[340px] min-w-[200px]">
		<span
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
		>
			<Icon name="search" size={14} />
		</span>
		<Input
			value={search}
			oninput={(event) => onSearch(event.currentTarget.value)}
			type="search"
			placeholder="Search domains..."
			aria-label="Search domains"
			class="h-10 rounded-lg border-border bg-background pl-9 text-[13px] dark:bg-background"
		/>
	</div>

	<Select.Root
		type="single"
		value={status}
		onValueChange={(value) => onStatusChange(value as DomainStatusFilter)}
	>
		<Select.Trigger
			class="h-10 gap-2 rounded-lg border-border bg-background px-3 dark:bg-background"
		>
			<span class="text-[12.5px] text-muted-foreground">Status</span>
			<span class="text-[13px] font-medium text-foreground">{statusLabel}</span>
		</Select.Trigger>
		<Select.Content>
			{#each statusOptions as option (option.value)}
				<Select.Item value={option.value} label={option.label} />
			{/each}
		</Select.Content>
	</Select.Root>

	{#if owners && onOwnerChange}
		<Select.Root type="single" value={owner} onValueChange={onOwnerChange}>
			<Select.Trigger
				class="h-10 gap-2 rounded-lg border-border bg-background px-3 dark:bg-background"
			>
				<span class="text-[12.5px] text-muted-foreground">Owner / Team</span>
				<span class="text-[13px] font-medium text-foreground">{ownerLabel}</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL_OWNERS} label="All" />
				{#each owners as option (option.id)}
					<Select.Item value={option.id} label={option.label}>
						<span class="flex w-full items-center justify-between gap-4">
							<span>{option.label}</span>
							<span class="tabular text-[11px] text-muted-foreground">{option.domainCount}</span>
						</span>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}

	<Select.Root
		type="single"
		value={sort}
		onValueChange={(value) => onSortChange(value as DomainSortKey)}
	>
		<Select.Trigger
			class="h-10 gap-2 rounded-lg border-border bg-background px-3 dark:bg-background"
		>
			<span class="text-[12.5px] text-muted-foreground">Sort by</span>
			<span class="text-[13px] font-medium text-foreground">{sortLabel}</span>
		</Select.Trigger>
		<Select.Content>
			{#each sortOptions as option (option.value)}
				<Select.Item value={option.value} label={option.label} />
			{/each}
		</Select.Content>
	</Select.Root>

	<div class="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
		{#each views as option (option.value)}
			<button
				type="button"
				aria-label={option.label}
				aria-pressed={view === option.value}
				onclick={() => onViewChange(option.value)}
				class="grid size-8 place-items-center rounded-md transition-colors
					{view === option.value
					? 'bg-accent text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<Icon name={option.icon} size={15} />
			</button>
		{/each}
	</div>
</div>
