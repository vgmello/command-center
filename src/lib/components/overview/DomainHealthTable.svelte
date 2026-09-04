<script lang="ts">
	import TablePager from '../TablePager.svelte';
	import DomainRowCard from '../DomainRowCard.svelte';
	import DomainTable from '../DomainTable.svelte';
	import DomainToolbar from '../DomainToolbar.svelte';
	import Icon from '../Icon.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { ViewMode } from '../DomainToolbar.svelte';
	import type { DomainPage } from '$lib/platform/types';
	import type { DomainSortKey, DomainStatusFilter, SelectOption } from '$lib/platform/query';

	/**
	 * The overview's summary of the domain table.
	 *
	 * A composition of the shared toolbar, table and pager rather than its own copy of
	 * them — the domains page renders the same three with more columns and an owner
	 * filter, and two hand-maintained tables of the same rows drift.
	 *
	 * What is specific to this screen stays here: the heading, the tooltip explaining
	 * the score, and the decision to offer neither the extra columns nor a page-size
	 * control in a panel this narrow.
	 */

	interface Props {
		result: DomainPage;
		statusOptions: SelectOption<DomainStatusFilter>[];
		sortOptions: SelectOption<DomainSortKey>[];
		/** Sentence describing the health bands, generated from the thresholds themselves. */
		thresholds: string;
		search: string;
		status: DomainStatusFilter;
		sort: DomainSortKey;
		view: ViewMode;
		onSearch: (value: string) => void;
		onStatusChange: (value: DomainStatusFilter) => void;
		onSortChange: (value: DomainSortKey) => void;
		onViewChange: (value: ViewMode) => void;
		onPageChange: (value: number) => void;
	}

	let {
		result,
		statusOptions,
		sortOptions,
		thresholds,
		search,
		status,
		sort,
		view,
		onSearch,
		onStatusChange,
		onSortChange,
		onViewChange,
		onPageChange
	}: Props = $props();
</script>

<section class="rounded-xl border border-border bg-card">
	<div class="flex items-center gap-2 px-4 pt-4">
		<h2 class="text-[15px] font-semibold tracking-tight">Domain Health</h2>
		<Tooltip.Provider delayDuration={200}>
			<Tooltip.Root>
				<Tooltip.Trigger
					class="text-muted-foreground transition-colors hover:text-foreground"
					aria-label="How the health score is calculated"
				>
					<Icon name="info" size={14} />
				</Tooltip.Trigger>
				<Tooltip.Content class="max-w-[260px]">
					Health score blends error rate, latency and open incidents. {thresholds}
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</div>

	<DomainToolbar
		{statusOptions}
		{sortOptions}
		{search}
		{status}
		{sort}
		{view}
		{onSearch}
		{onStatusChange}
		{onSortChange}
		{onViewChange}
	/>

	{#if result.domains.length === 0}
		<p class="px-4 py-14 text-center text-[13px] text-muted-foreground">
			No domains match the current filters.
		</p>
	{:else if view === 'grid'}
		<div class="grid gap-3 px-4 pb-2 sm:grid-cols-2 2xl:grid-cols-3">
			{#each result.domains as domain (domain.id)}
				<DomainRowCard {domain} />
			{/each}
		</div>
	{:else}
		<DomainTable domains={result.domains} trendLabel="Trend (15m)" />
	{/if}

	<TablePager page={result.page} {onPageChange} />
</section>
