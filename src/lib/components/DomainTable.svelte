<script lang="ts">
	import HealthRing from './HealthRing.svelte';
	import Icon from './Icon.svelte';
	import Sparkline from './Sparkline.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import { accentTile, statusTone } from './tone';
	import { CRITICALITY_LABELS, STATUS_LABELS } from '$lib/platform/health';
	import { formatLatency, formatPercent } from '$lib/platform/format';
	import type { Domain } from '$lib/platform/types';

	/**
	 * Columns a screen can add on top of the always-present ones.
	 *
	 * Opt-in rather than opt-out so the narrow rendering — the overview's, embedded
	 * beside three side panels — is what you get by asking for nothing. A screen with
	 * a full-width table asks for more.
	 */
	export type DomainColumn = 'availability' | 'owner';

	interface Props {
		domains: Domain[];
		columns?: DomainColumn[];
		/** Header for the sparkline column; the window it covers differs by screen. */
		trendLabel?: string;
		/** Renders the column-settings affordance in the header's action cell. */
		configurable?: boolean;
		/**
		 * How much of a domain's identity the first cell prints.
		 *
		 * `detailed` gives the full name over its criticality tier — right for a screen
		 * with a handful of columns, where the second line is free. `compact` gives the
		 * short name alone, which is what makes eleven columns fit without every one of
		 * them truncating. One prop rather than two booleans because these are not
		 * independent choices: they are two settings of the same dial.
		 */
		identity?: 'detailed' | 'compact';
	}

	let {
		domains,
		columns = [],
		trendLabel = 'Trend',
		configurable = false,
		identity = 'detailed'
	}: Props = $props();

	const shows = $derived((column: DomainColumn) => columns.includes(column));

	/**
	 * Colour a reading only when it is worth looking at.
	 *
	 * A healthy latency printed in green competes with the status badge already saying
	 * so, and a column where every cell is coloured stops signalling anything. Health
	 * itself is the exception — availability reads as an SLO, where "green" is the
	 * point.
	 */
	function emphasis(status: Domain['status']): string {
		return status === 'healthy' ? '' : statusTone(status).text;
	}
</script>

<Table.Root>
	<Table.Header>
		<Table.Row class="border-border hover:bg-transparent">
			<Table.Head class="h-9 w-[168px] pl-4 text-[11.5px] font-medium">Domain</Table.Head>
			<Table.Head class="h-9 w-[92px] text-[11.5px] font-medium">Health Score</Table.Head>
			<Table.Head class="h-9 w-[78px] text-[11.5px] font-medium">Status</Table.Head>
			<Table.Head class="h-9 w-[68px] text-[11.5px] font-medium">Services</Table.Head>
			<Table.Head class="h-9 w-[98px] text-[11.5px] font-medium">Active Incidents</Table.Head>
			<Table.Head class="h-9 w-[78px] text-[11.5px] font-medium">Error Rate</Table.Head>
			<Table.Head class="h-9 w-[84px] text-[11.5px] font-medium">P95 Latency</Table.Head>
			{#if shows('availability')}
				<Table.Head class="h-9 w-[96px] text-[11.5px] font-medium">Availability (7d)</Table.Head>
			{/if}
			{#if shows('owner')}
				<Table.Head class="h-9 w-[124px] text-[11.5px] font-medium">Owner</Table.Head>
			{/if}
			<Table.Head class="h-9 w-[82px] text-[11.5px] font-medium">{trendLabel}</Table.Head>
			<Table.Head class="h-9 w-[36px] pr-3 text-right text-[11.5px] font-medium">
				{#if configurable}
					<button
						type="button"
						aria-label="Configure columns"
						class="inline-grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<Icon name="sliders-horizontal" size={14} />
					</button>
				{:else}
					Actions
				{/if}
			</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each domains as domain (domain.id)}
			{@const tone = statusTone(domain.status)}
			{@const latency = formatLatency(domain.p95LatencyMs)}
			<Table.Row class="border-border">
				<Table.Cell class="max-w-[168px] py-2.5 pl-4">
					<!--
						A link at last: this row waited for `/domains/[slug]` to exist rather than
						navigating to a 404, which is the rule that kept it inert until now.
					-->
					<a href="/domains/{domain.slug}" class="flex items-center gap-3">
						<span
							class="grid size-8 shrink-0 place-items-center rounded-lg ring-1 {accentTile(
								domain.accent
							)}"
						>
							<Icon name={domain.icon} size={16} strokeWidth={1.9} />
						</span>
						<span class="min-w-0">
							<span class="block truncate text-[13px] font-medium" title={domain.name}>
								{identity === 'compact' ? domain.shortName : domain.name}
							</span>
							{#if identity === 'detailed'}
								<span class="block truncate text-[11px] text-muted-foreground">
									{CRITICALITY_LABELS[domain.criticality]}
								</span>
							{/if}
						</span>
					</a>
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
				<Table.Cell
					class="tabular py-2.5 text-[13px] {domain.activeIncidents > 0
						? 'font-medium text-down'
						: 'text-muted-foreground'}"
				>
					{domain.activeIncidents}
				</Table.Cell>
				<Table.Cell class="py-2.5">
					<span class="flex items-center gap-1">
						<span class="tabular text-[13px]">{formatPercent(domain.errorRatePct)}</span>
						<Sparkline
							series={domain.errorTrend}
							width={28}
							height={16}
							stroke={domain.status === 'healthy' ? 'stroke-healthy' : 'stroke-down'}
							class="h-4 w-[28px]"
						/>
					</span>
				</Table.Cell>
				<Table.Cell class="tabular py-2.5 text-[13px] {emphasis(domain.status)}">
					{latency.value}<span class="ml-1 text-muted-foreground">{latency.unit}</span>
				</Table.Cell>
				{#if shows('availability')}
					<Table.Cell class="tabular py-2.5 text-[13px] {tone.text}">
						{formatPercent(domain.availability7dPct)}
					</Table.Cell>
				{/if}
				{#if shows('owner')}
					<Table.Cell class="max-w-[124px] py-2.5">
						<span class="block truncate text-[12.5px] text-muted-foreground" title={domain.owner}>
							{domain.owner}
						</span>
					</Table.Cell>
				{/if}
				<Table.Cell class="py-2.5">
					<Sparkline
						series={domain.healthTrend}
						width={66}
						height={22}
						stroke={domain.status === 'down' ? 'stroke-down' : 'stroke-info'}
						class="h-5 w-[66px]"
					/>
				</Table.Cell>
				<Table.Cell class="py-2.5 pr-3 text-right">
					<button
						type="button"
						aria-label="Actions for {domain.name}"
						class="inline-grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<Icon name="ellipsis" size={16} />
					</button>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
