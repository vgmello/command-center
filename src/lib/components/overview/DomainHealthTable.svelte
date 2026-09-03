<script lang="ts">
	import DomainRowCard from './DomainRowCard.svelte';
	import HealthRing from '../HealthRing.svelte';
	import Icon from '../Icon.svelte';
	import Sparkline from '../Sparkline.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { accentTile, statusTone } from '../tone';
	import { CRITICALITY_LABELS, STATUS_LABELS } from '$lib/platform/health';
	import { formatLatency, formatPercent } from '$lib/platform/format';
	import { paginationItems } from '$lib/platform/pagination';
	import type { DomainPage, DomainQuery, DomainSortKey, HealthStatus } from '$lib/platform/types';

	type StatusFilter = HealthStatus | 'all';
	type ViewMode = 'grid' | 'list';

	interface Props {
		result: DomainPage;
		search: string;
		status: StatusFilter;
		sort: DomainQuery['sort'];
		view: ViewMode;
		onSearch: (value: string) => void;
		onStatusChange: (value: StatusFilter) => void;
		onSortChange: (value: DomainSortKey) => void;
		onViewChange: (value: ViewMode) => void;
		onPageChange: (value: number) => void;
	}

	let {
		result,
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

	const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
		{ value: 'all', label: 'All' },
		{ value: 'healthy', label: 'Healthy' },
		{ value: 'degraded', label: 'Degraded' },
		{ value: 'down', label: 'Down' }
	];

	const SORT_OPTIONS: Array<{ value: DomainSortKey; label: string }> = [
		{ value: 'health-score', label: 'Health Score' },
		{ value: 'error-rate', label: 'Error Rate' },
		{ value: 'p95-latency', label: 'P95 Latency' },
		{ value: 'active-incidents', label: 'Active Incidents' },
		{ value: 'name', label: 'Name' }
	];

	const statusLabel = $derived(STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'All');
	const sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Health Score');
	const pages = $derived(paginationItems(result.page.page, result.page.totalPages));
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
					Health score blends error rate, latency and open incidents. 75 and above is healthy, 50–74
					degraded, below 50 down.
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</div>

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
			onValueChange={(value) => onStatusChange(value as StatusFilter)}
		>
			<Select.Trigger
				class="h-10 gap-2 rounded-lg border-border bg-background px-3 dark:bg-background"
			>
				<span class="text-[12.5px] text-muted-foreground">Status</span>
				<span class="text-[13px] font-medium text-foreground">{statusLabel}</span>
			</Select.Trigger>
			<Select.Content>
				{#each STATUS_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>

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
				{#each SORT_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<div class="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
			{#each [{ value: 'grid', icon: 'layout-grid', label: 'Grid view' }, { value: 'list', icon: 'list', label: 'List view' }] as const as option (option.value)}
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
		<Table.Root>
			<Table.Header>
				<Table.Row class="border-border hover:bg-transparent">
					<Table.Head class="h-9 pl-4 text-[11.5px] font-medium">Domain</Table.Head>
					<Table.Head class="h-9 w-[112px] text-[11.5px] font-medium">Health Score</Table.Head>
					<Table.Head class="h-9 w-[104px] text-[11.5px] font-medium">Status</Table.Head>
					<Table.Head class="h-9 w-[84px] text-[11.5px] font-medium">Services</Table.Head>
					<Table.Head class="h-9 w-[128px] text-[11.5px] font-medium">Error Rate</Table.Head>
					<Table.Head class="h-9 w-[110px] text-[11.5px] font-medium">P95 Latency</Table.Head>
					<Table.Head class="h-9 w-[116px] text-[11.5px] font-medium">Active Incidents</Table.Head>
					<Table.Head class="h-9 w-[148px] text-[11.5px] font-medium">Trend (15m)</Table.Head>
					<Table.Head class="h-9 w-[64px] pr-4 text-right text-[11.5px] font-medium">
						Actions
					</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each result.domains as domain (domain.id)}
					{@const tone = statusTone(domain.status)}
					{@const latency = formatLatency(domain.p95LatencyMs)}
					<Table.Row class="border-border">
						<Table.Cell class="py-2.5 pl-4">
							<span class="flex items-center gap-3">
								<span
									class="grid size-9 shrink-0 place-items-center rounded-lg ring-1 {accentTile(
										domain.accent
									)}"
								>
									<Icon name={domain.icon} size={17} strokeWidth={1.9} />
								</span>
								<span class="min-w-0">
									<span class="block truncate text-[13px] font-medium">{domain.name}</span>
									<span class="block truncate text-[11px] text-muted-foreground">
										{CRITICALITY_LABELS[domain.criticality]}
									</span>
								</span>
							</span>
						</Table.Cell>
						<Table.Cell class="py-2.5">
							<span class="flex items-center gap-1.5">
								<HealthRing score={domain.healthScore} status={domain.status} />
								<span class="tabular text-[11px] text-muted-foreground">/100</span>
							</span>
						</Table.Cell>
						<Table.Cell class="py-2.5">
							<StatusBadge label={STATUS_LABELS[domain.status]} {tone} />
						</Table.Cell>
						<Table.Cell class="tabular py-2.5 text-[13px]">{domain.serviceCount}</Table.Cell>
						<Table.Cell class="py-2.5">
							<span class="flex items-center gap-2">
								<span class="tabular text-[13px]">{formatPercent(domain.errorRatePct)}</span>
								<Sparkline
									series={domain.errorTrend}
									width={44}
									height={16}
									stroke={domain.status === 'healthy' ? 'stroke-healthy' : 'stroke-down'}
									class="h-4 w-11"
								/>
							</span>
						</Table.Cell>
						<Table.Cell class="tabular py-2.5 text-[13px]">
							{latency.value}<span class="ml-1 text-muted-foreground">{latency.unit}</span>
						</Table.Cell>
						<Table.Cell
							class="tabular py-2.5 text-[13px] {domain.activeIncidents > 0
								? 'font-medium text-down'
								: 'text-muted-foreground'}"
						>
							{domain.activeIncidents}
						</Table.Cell>
						<Table.Cell class="py-2.5">
							<Sparkline
								series={domain.healthTrend}
								width={120}
								height={22}
								stroke={domain.status === 'down' ? 'stroke-down' : 'stroke-info'}
								class="h-5 w-[120px]"
							/>
						</Table.Cell>
						<Table.Cell class="py-2.5 pr-4 text-right">
							<button
								type="button"
								aria-label="Actions for {domain.name}"
								class="inline-grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<Icon name="ellipsis" size={16} />
							</button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
		<p class="tabular text-[12px] text-muted-foreground">
			Showing {result.page.from} to {result.page.to} of {result.page.totalItems} domains
		</p>

		<nav class="flex items-center gap-1" aria-label="Domain table pages">
			<button
				type="button"
				aria-label="Previous page"
				disabled={result.page.page <= 1}
				onclick={() => onPageChange(result.page.page - 1)}
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
						aria-current={item === result.page.page ? 'page' : undefined}
						onclick={() => onPageChange(item)}
						class="tabular grid size-8 place-items-center rounded-lg text-[12.5px] font-medium transition-colors
							{item === result.page.page
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
				disabled={result.page.page >= result.page.totalPages}
				onclick={() => onPageChange(result.page.page + 1)}
				class="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
			>
				<Icon name="chevron-right" size={15} />
			</button>
		</nav>
	</div>
</section>
