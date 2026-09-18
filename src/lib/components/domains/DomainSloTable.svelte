<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { formatPercent } from '$lib/platform/format';
	import { resolve } from '$app/paths';
	import type { ServiceSloRow } from '$lib/platform/types';

	/**
	 * The full per-service SLO listing for one domain's SLOs tab.
	 *
	 * A domain averages two to four services, so — like `DomainServicesTable` — this has
	 * no search box and no pagination, just every row on one screen.
	 */

	interface Props {
		rows: ServiceSloRow[];
	}

	let { rows }: Props = $props();

	/*
	 * The bar draws the budget left, not the availability achieved — a bar drawn at
	 * 99.95% of its width looks identical to one at 99.5%, and the gap between those two
	 * is the whole month's allowance. Same rule `SloBudgetCard` follows on the service tab.
	 */
	function healthy(remainingPct: number) {
		return remainingPct >= 25;
	}
</script>

<div class="overflow-x-auto rounded-xl border border-border bg-card">
	<Table.Root>
		<Table.Header>
			<Table.Row class="border-border hover:bg-transparent">
				<Table.Head class="h-9 w-[220px] pl-4 text-[11.5px] font-medium">Service</Table.Head>
				<Table.Head class="h-9 w-[96px] text-right text-[11.5px] font-medium">Achieved</Table.Head>
				<Table.Head class="h-9 w-[84px] text-right text-[11.5px] font-medium">Target</Table.Head>
				<Table.Head class="h-9 w-[120px] text-right text-[11.5px] font-medium">Remaining</Table.Head
				>
				<Table.Head class="h-9 w-[140px] pr-4 text-[11.5px] font-medium">Burn</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.slug)}
				{@const budget = row.budget}
				<Table.Row class="border-border">
					<Table.Cell class="max-w-[220px] py-2.5 pl-4">
						<a
							href={resolve('/services/[slug]', { slug: row.slug })}
							class="block truncate text-[13px] font-medium hover:text-primary"
						>
							{row.name}
						</a>
						<span class="block truncate text-[10.5px] text-muted-foreground">{budget.label}</span>
					</Table.Cell>
					<Table.Cell class="tabular py-2.5 text-right text-[13px] whitespace-nowrap">
						{formatPercent(budget.achievedPct)}
					</Table.Cell>
					<Table.Cell class="tabular py-2.5 text-right text-[13px] whitespace-nowrap">
						{formatPercent(budget.targetPct)}
					</Table.Cell>
					<Table.Cell class="tabular py-2.5 text-right text-[13px] whitespace-nowrap">
						<!--
							`remainingLabel` travels with `remainingMinutes` precisely so this table
							and the API cannot round the same figure two different ways — reformatting
							it here would be a second, independent rounding of the same number.
						-->
						{budget.remainingLabel}
					</Table.Cell>
					<Table.Cell class="py-2.5 pr-4">
						<div class="flex items-center gap-2">
							<div class="h-1.5 w-[72px] shrink-0 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full {healthy(budget.remainingPct)
										? 'bg-healthy'
										: 'bg-degraded'}"
									style="width:{budget.remainingPct}%"
								></div>
							</div>
							<span class="tabular text-[11.5px] text-muted-foreground">
								{formatPercent(budget.burnPct, 1)}
							</span>
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
