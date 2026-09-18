<script lang="ts">
	import DeploymentTable from './DeploymentTable.svelte';
	import TablePager from '../TablePager.svelte';
	import Icon from '../Icon.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ALL_DOMAINS, ALL_ENVIRONMENTS } from '$lib/platform/deployments';
	import type {
		DeploymentPage,
		EnvironmentId,
		EnvironmentOption,
		FacetOption
	} from '$lib/platform/types';
	import type { DeploymentStateFilter, DeploymentWindow } from '$lib/platform/deployments';
	import type { SelectOption } from '$lib/platform/query';

	/**
	 * The deployment log: tabs, filters, table and pager.
	 *
	 * The tabs are a filter, not a view — each one narrows the same query — so they
	 * live in the same component as the toolbar rather than above it, where they would
	 * look like they switched between four different things.
	 */

	interface Props {
		result: DeploymentPage;
		stateOptions: SelectOption<DeploymentStateFilter>[];
		windowOptions: SelectOption<DeploymentWindow>[];
		pageSizes: SelectOption<string>[];
		domains: FacetOption[];
		environments: EnvironmentOption[];
		search: string;
		state: DeploymentStateFilter;
		domain: string;
		environment: EnvironmentId | typeof ALL_ENVIRONMENTS;
		window: DeploymentWindow;
		onSearch: (value: string) => void;
		onStateChange: (value: DeploymentStateFilter) => void;
		onDomainChange: (value: string) => void;
		onEnvironmentChange: (value: EnvironmentId | typeof ALL_ENVIRONMENTS) => void;
		onWindowChange: (value: DeploymentWindow) => void;
		onClearFilters: () => void;
		onPageChange: (value: number) => void;
		onPageSizeChange: (value: number) => void;
	}

	let {
		result,
		stateOptions,
		windowOptions,
		pageSizes,
		domains,
		environments,
		search,
		state,
		domain,
		environment,
		window: dateWindow,
		onSearch,
		onStateChange,
		onDomainChange,
		onEnvironmentChange,
		onWindowChange,
		onClearFilters,
		onPageChange,
		onPageSizeChange
	}: Props = $props();

	const domainLabel = $derived(
		domain === ALL_DOMAINS
			? 'All Domains'
			: (domains.find((one) => one.id === domain)?.label ?? domain)
	);
	const environmentLabel = $derived(
		environment === ALL_ENVIRONMENTS
			? 'All Environments'
			: (environments.find((one) => one.id === environment)?.label ?? environment)
	);
	const windowLabel = $derived(
		windowOptions.find((one) => one.value === dateWindow)?.label ?? 'Any time'
	);

	/*
	 * The Filters control reports and clears rather than opening a panel of controls
	 * that are already on screen. A button that does nothing is worse than no button,
	 * and this is the one useful thing left for it to do.
	 */
	const activeFilters = $derived(
		[
			search.trim() !== '',
			domain !== ALL_DOMAINS,
			environment !== ALL_ENVIRONMENTS,
			dateWindow !== 'any'
		].filter(Boolean).length
	);
</script>

<section class="rounded-xl border border-border bg-card">
	<div class="flex items-center gap-1 border-b border-border px-4" role="tablist">
		{#each stateOptions as option (option.value)}
			<button
				type="button"
				role="tab"
				aria-selected={state === option.value}
				onclick={() => onStateChange(option.value)}
				class="border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors
					{state === option.value
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				{option.label}
			</button>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-2.5 px-4 py-3.5">
		<div class="relative w-full max-w-[240px] min-w-[180px]">
			<span
				class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
			>
				<Icon name="search" size={14} />
			</span>
			<Input
				value={search}
				oninput={(event) => onSearch(event.currentTarget.value)}
				type="search"
				placeholder="Search deployments..."
				aria-label="Search deployments"
				class="h-9 rounded-lg border-border bg-background pl-9 text-[12.5px] dark:bg-background"
			/>
		</div>

		<Select.Root type="single" value={domain} onValueChange={onDomainChange}>
			<Select.Trigger
				class="h-9 gap-2 rounded-lg border-border bg-background px-3 text-[12.5px] dark:bg-background"
			>
				{domainLabel}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL_DOMAINS} label="All Domains" />
				{#each domains as option (option.id)}
					<Select.Item value={option.id} label={option.label}>
						<span class="flex w-full items-center justify-between gap-4">
							<span>{option.label}</span>
							<span class="tabular text-[11px] text-muted-foreground">{option.count}</span>
						</span>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root
			type="single"
			value={environment}
			onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
		>
			<Select.Trigger
				class="h-9 gap-2 rounded-lg border-border bg-background px-3 text-[12.5px] dark:bg-background"
			>
				{environmentLabel}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL_ENVIRONMENTS} label="All Environments" />
				{#each environments as option (option.id)}
					<Select.Item value={option.id} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root
			type="single"
			value={dateWindow}
			onValueChange={(value) => onWindowChange(value as DeploymentWindow)}
		>
			<Select.Trigger
				class="h-9 gap-2 rounded-lg border-border bg-background px-3 text-[12.5px] dark:bg-background"
			>
				<Icon name="calendar" size={14} />
				{windowLabel}
			</Select.Trigger>
			<Select.Content>
				{#each windowOptions as option (option.value)}
					<Select.Item value={option.value} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<button
			type="button"
			disabled={activeFilters === 0}
			onclick={onClearFilters}
			class="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
		>
			<Icon name="funnel" size={14} />
			{activeFilters === 0 ? 'Filters' : `Clear ${activeFilters}`}
		</button>
	</div>

	{#if result.deployments.length === 0}
		<p class="px-4 py-14 text-center text-[13px] text-muted-foreground">
			No deployments match the current filters.
		</p>
	{:else}
		<div class="overflow-x-auto">
			<DeploymentTable deployments={result.deployments} {environments} />
		</div>
	{/if}

	<TablePager page={result.page} {onPageChange} {pageSizes} {onPageSizeChange} noun="deployments" />
</section>
