<script lang="ts">
	import DomainPager from '../DomainPager.svelte';
	import DomainRowCard from '../DomainRowCard.svelte';
	import DomainTable from '../DomainTable.svelte';
	import DomainToolbar from '../DomainToolbar.svelte';
	import type { ViewMode } from '../DomainToolbar.svelte';
	import type { DomainOwner, DomainPage } from '$lib/platform/types';
	import type { DomainSortKey, DomainStatusFilter, SelectOption } from '$lib/platform/query';

	/**
	 * The domains page's table.
	 *
	 * The same three parts the overview composes, asked for differently: this screen
	 * is the table, so it has room for the ownership and availability columns, an
	 * owner filter, and a page-size control. It carries no heading — the page's own
	 * title already names it, and a second one would just repeat the word.
	 */

	interface Props {
		result: DomainPage;
		statusOptions: SelectOption<DomainStatusFilter>[];
		sortOptions: SelectOption<DomainSortKey>[];
		pageSizes: SelectOption<string>[];
		owners: DomainOwner[];
		search: string;
		status: DomainStatusFilter;
		owner: string;
		sort: DomainSortKey;
		view: ViewMode;
		onSearch: (value: string) => void;
		onStatusChange: (value: DomainStatusFilter) => void;
		onOwnerChange: (value: string) => void;
		onSortChange: (value: DomainSortKey) => void;
		onViewChange: (value: ViewMode) => void;
		onPageChange: (value: number) => void;
		onPageSizeChange: (value: number) => void;
	}

	let {
		result,
		statusOptions,
		sortOptions,
		pageSizes,
		owners,
		search,
		status,
		owner,
		sort,
		view,
		onSearch,
		onStatusChange,
		onOwnerChange,
		onSortChange,
		onViewChange,
		onPageChange,
		onPageSizeChange
	}: Props = $props();
</script>

<section class="rounded-xl border border-border bg-card">
	<DomainToolbar
		{statusOptions}
		{sortOptions}
		{owners}
		{search}
		{status}
		{owner}
		{sort}
		{view}
		{onSearch}
		{onStatusChange}
		{onOwnerChange}
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
		<div class="overflow-x-auto">
			<DomainTable
				domains={result.domains}
				columns={['availability', 'owner']}
				configurable
				identity="compact"
			/>
		</div>
	{/if}

	<DomainPager page={result.page} {onPageChange} {pageSizes} {onPageSizeChange} />
</section>
