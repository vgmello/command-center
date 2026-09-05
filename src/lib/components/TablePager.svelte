<script lang="ts">
	import Icon from './Icon.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { paginationItems } from '$lib/platform/pagination';
	import type { Page } from '$lib/platform/types';
	import type { SelectOption } from '$lib/platform/query';

	interface Props {
		page: Page;
		/** What the rows are, for "Showing 1 to 8 of 29 …". Plural. */
		noun?: string;
		onPageChange: (value: number) => void;
		/**
		 * Page-size choices, when the screen lets the reader change them. Omitted on
		 * screens whose table is a fixed-height summary, where the control would offer
		 * a size the layout has no room for.
		 */
		pageSizes?: SelectOption<string>[];
		onPageSizeChange?: (value: number) => void;
	}

	let { page, noun = 'domains', onPageChange, pageSizes, onPageSizeChange }: Props = $props();

	const pages = $derived(paginationItems(page.page, page.totalPages));
	const pageSizeLabel = $derived(
		pageSizes?.find((option) => option.value === String(page.pageSize))?.label ??
			`${page.pageSize} per page`
	);
</script>

<div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
	<p class="tabular text-[12px] text-muted-foreground">
		Showing {page.from} to {page.to} of {page.totalItems}
		{noun}
	</p>

	<div class="flex items-center gap-3">
		<nav class="flex items-center gap-1" aria-label="Table pages">
			<button
				type="button"
				aria-label="Previous page"
				disabled={page.page <= 1}
				onclick={() => onPageChange(page.page - 1)}
				class="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
			>
				<Icon name="chevron-left" size={15} />
			</button>

			{#each pages as item, index (index)}
				{#if item === 'ellipsis'}
					<span class="grid size-8 place-items-center text-[12px] text-muted-foreground">…</span>
				{:else}
					<button
						type="button"
						aria-current={item === page.page ? 'page' : undefined}
						onclick={() => onPageChange(item)}
						class="tabular grid size-8 place-items-center rounded-lg text-[12.5px] font-medium transition-colors
							{item === page.page
							? 'bg-primary text-primary-foreground'
							: 'border border-border text-muted-foreground hover:text-foreground'}"
					>
						{item}
					</button>
				{/if}
			{/each}

			<button
				type="button"
				aria-label="Next page"
				disabled={page.page >= page.totalPages}
				onclick={() => onPageChange(page.page + 1)}
				class="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
			>
				<Icon name="chevron-right" size={15} />
			</button>
		</nav>

		{#if pageSizes && onPageSizeChange}
			<Select.Root
				type="single"
				value={String(page.pageSize)}
				onValueChange={(value) => onPageSizeChange(Number(value))}
			>
				<Select.Trigger
					class="h-8 gap-2 rounded-lg border-border bg-background px-3 text-[12.5px] dark:bg-background"
					aria-label="Rows per page"
				>
					{pageSizeLabel}
				</Select.Trigger>
				<Select.Content>
					{#each pageSizes as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
	</div>
</div>
