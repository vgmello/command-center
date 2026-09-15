<script lang="ts">
	import Icon from '../Icon.svelte';
	import Sparkline from '../Sparkline.svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import { accentTile, statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import { formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
	import { resolve } from '$app/paths';
	import type { ServiceVitals } from '$lib/platform/types';

	/**
	 * The full service listing for one domain's Services tab.
	 *
	 * The overview's `ServicesHealthCard` shows the same rows collapsed to five inside a
	 * narrow side column; this is the whole table, on its own tab, so it has room for a
	 * dedicated header row and column sort rather than the card's fixed order. No search
	 * box — a domain averages two to four services, and a filter over four rows is a dead
	 * control. The fleet-wide `/services` screen is where searching belongs.
	 */

	type SortKey = 'name' | 'status' | 'rps' | 'error' | 'p95' | 'instances';

	interface Props {
		rows: ServiceVitals[];
	}

	let { rows }: Props = $props();

	let sortKey = $state<SortKey>('name');
	let sortDir = $state<'asc' | 'desc'>('asc');

	const ACCESSORS: Record<SortKey, (row: ServiceVitals) => number | string> = {
		name: (row) => row.name.toLowerCase(),
		status: (row) => row.status,
		rps: (row) => row.requestsPerSecond,
		error: (row) => row.errorRatePct,
		p95: (row) => row.p95LatencyMs,
		instances: (row) => (row.instancesTotal === 0 ? 0 : row.instancesHealthy / row.instancesTotal)
	};

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = 'asc';
		}
	}

	const sorted = $derived(
		[...rows].sort((a, b) => {
			const accessor = ACCESSORS[sortKey];
			const [left, right] = [accessor(a), accessor(b)];
			const compared = left < right ? -1 : left > right ? 1 : 0;
			return sortDir === 'asc' ? compared : -compared;
		})
	);

	function headerProps(key: SortKey) {
		return {
			'aria-sort': (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') as
				'ascending' | 'descending' | 'none'
		};
	}
</script>

{#snippet sortIcon(key: SortKey)}
	{#if sortKey === key}
		<Icon name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} strokeWidth={2.2} />
	{/if}
{/snippet}

<div class="overflow-x-auto rounded-xl border border-border bg-card">
	<Table.Root>
		<Table.Header>
			<Table.Row class="border-border hover:bg-transparent">
				<Table.Head class="h-9 w-[220px] pl-4 text-[11.5px] font-medium" {...headerProps('name')}>
					<button
						type="button"
						onclick={() => toggleSort('name')}
						class="flex items-center gap-1 hover:text-foreground"
					>
						Service
						{@render sortIcon('name')}
					</button>
				</Table.Head>
				<Table.Head class="h-9 w-[110px] text-[11.5px] font-medium" {...headerProps('status')}>
					<button
						type="button"
						onclick={() => toggleSort('status')}
						class="flex items-center gap-1 hover:text-foreground"
					>
						Status
						{@render sortIcon('status')}
					</button>
				</Table.Head>
				<Table.Head
					class="h-9 w-[96px] text-right text-[11.5px] font-medium"
					{...headerProps('rps')}
				>
					<button
						type="button"
						onclick={() => toggleSort('rps')}
						class="ml-auto flex items-center gap-1 hover:text-foreground"
					>
						{@render sortIcon('rps')}
						Req/s
					</button>
				</Table.Head>
				<Table.Head
					class="h-9 w-[84px] text-right text-[11.5px] font-medium"
					{...headerProps('error')}
				>
					<button
						type="button"
						onclick={() => toggleSort('error')}
						class="ml-auto flex items-center gap-1 hover:text-foreground"
					>
						{@render sortIcon('error')}
						Error Rate
					</button>
				</Table.Head>
				<Table.Head
					class="h-9 w-[96px] text-right text-[11.5px] font-medium"
					{...headerProps('p95')}
				>
					<button
						type="button"
						onclick={() => toggleSort('p95')}
						class="ml-auto flex items-center gap-1 hover:text-foreground"
					>
						{@render sortIcon('p95')}
						P95 Latency
					</button>
				</Table.Head>
				<Table.Head
					class="h-9 w-[92px] text-right text-[11.5px] font-medium"
					{...headerProps('instances')}
				>
					<button
						type="button"
						onclick={() => toggleSort('instances')}
						class="ml-auto flex items-center gap-1 hover:text-foreground"
					>
						{@render sortIcon('instances')}
						Instances
					</button>
				</Table.Head>
				<Table.Head class="h-9 w-[82px] pr-4 text-[11.5px] font-medium">Trend</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each sorted as service (service.id)}
				{@const tone = statusTone(service.status)}
				{@const latency = formatLatency(service.p95LatencyMs)}
				{@const healthy = service.status === 'healthy'}
				<Table.Row class="border-border">
					<Table.Cell class="max-w-[220px] py-2.5 pl-4">
						<a
							href={resolve('/services/[slug]', { slug: service.slug })}
							class="flex items-center gap-2.5"
						>
							<span
								class="grid size-8 shrink-0 place-items-center rounded-lg ring-1 {accentTile(
									service.accent
								)}"
							>
								<Icon name={service.icon} size={15} strokeWidth={1.9} />
							</span>
							<span class="min-w-0">
								<span class="block truncate text-[13px] font-medium">{service.name}</span>
								<span class="block truncate text-[11px] text-muted-foreground">{service.kind}</span>
							</span>
						</a>
					</Table.Cell>
					<Table.Cell class="py-2.5">
						<span class="flex items-center gap-1.5 text-[12.5px] {tone.text}">
							<Icon
								name={healthy ? 'circle-check' : 'triangle-alert'}
								size={13}
								strokeWidth={2.2}
							/>
							{STATUS_LABELS[service.status]}
						</span>
					</Table.Cell>
					<Table.Cell class="tabular py-2.5 text-right text-[13px] whitespace-nowrap">
						<!--
							Formatted, not printed raw — the fixtures happen to hold whole numbers, so
							this read "450 req/s" for as long as nobody connected a real source, and
							then "2.1387043477711356 req/s".
						-->
						{formatCompact(service.requestsPerSecond)}
					</Table.Cell>
					<Table.Cell class="tabular py-2.5 text-right text-[13px] {healthy ? '' : tone.text}">
						{formatPercent(service.errorRatePct, 1)}
					</Table.Cell>
					<Table.Cell
						class="tabular py-2.5 text-right text-[13px] whitespace-nowrap {healthy
							? ''
							: tone.text}"
					>
						{latency.value}<span class="ml-1 text-muted-foreground">{latency.unit}</span>
					</Table.Cell>
					<Table.Cell class="tabular py-2.5 text-right text-[13px] whitespace-nowrap">
						{service.instancesHealthy}/{service.instancesTotal}
					</Table.Cell>
					<Table.Cell class="py-2.5 pr-4">
						<Sparkline
							series={service.trend}
							width={58}
							height={20}
							stroke={tone.stroke}
							class="h-5 w-[58px]"
						/>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
