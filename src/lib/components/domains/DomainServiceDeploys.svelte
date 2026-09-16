<script lang="ts">
	import PanelGap from '../PanelGap.svelte';
	import SectionCard from '../SectionCard.svelte';
	import Sparkline from '../Sparkline.svelte';
	import { toneFor } from '../tone';
	import type { Panel } from '$lib/platform/sources';
	import type { DomainDeploymentStats, TimeSeries } from '$lib/platform/types';

	/**
	 * How the domain's deploys divide between its services, worst failure rate first.
	 *
	 * This is the panel that earns the tab. "payment-gateway failed one of its six deploys"
	 * is something a reader can act on; the domain's blended 5.9% above it is not, because
	 * a rate over every service is exactly the number a single bad service disappears into.
	 *
	 * The order arrives sorted from `rollUpDeployments` — the server states the ranking, the
	 * table does not re-derive it.
	 */

	interface Props {
		stats: Panel<DomainDeploymentStats>;
		/** What the counts cover, so the column heading is not a bare "Deploys". */
		windowLabel: string;
	}

	let { stats, windowLabel }: Props = $props();

	const rows = $derived(stats.status === 'ok' ? stats.data.byService : []);

	/** A `TimeSeries` carries labels the sparkline has no room for; it wants the values. */
	const spark = (series: TimeSeries) => {
		const values = series.points.map((point) => point.value);
		return { values, min: 0, max: Math.max(...values, 0) };
	};
</script>

<SectionCard title="Deployments by Service">
	<!--
		The window and the scope, because a table of counts read on its own says neither.
		The scope matters more than it looks: these rows cover the services this domain owns
		in the catalog, while the log further down covers every run attributed to the domain.
		Those are the same set when the registry is complete and not otherwise, and a reader
		comparing a total against a row count is owed the difference in words.
	-->
	<p class="px-4 pb-2 text-[11.5px] text-muted-foreground">
		{windowLabel} · services this domain owns
	</p>
	<PanelGap panel={stats} noun="per-service deployment figures" class="px-4 pb-4" />

	{#if rows.length > 0}
		<table class="w-full">
			<thead>
				<tr class="text-[11px] text-muted-foreground">
					<th class="px-4 pb-1.5 text-left font-medium">Service</th>
					<th class="pb-1.5 text-right font-medium">Deploys</th>
					<th class="pb-1.5 text-right font-medium">Failed</th>
					<th class="pb-1.5 text-right font-medium">Failure Rate</th>
					<th class="px-4 pb-1.5 text-right font-medium">Frequency</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.service)}
					{@const tone = toneFor(row.failures > 0 ? 'down' : 'healthy')}
					<tr class="border-t border-border/60">
						<td class="max-w-[180px] truncate px-4 py-[7px] text-[12.5px]">{row.service}</td>
						<td class="tabular py-[7px] text-right text-[12.5px]">{row.total}</td>
						<td class="tabular py-[7px] text-right text-[12.5px] text-muted-foreground">
							{row.failures}
						</td>
						<td class="tabular py-[7px] text-right text-[12.5px] {tone.text}">
							{row.changeFailureRatePct.toFixed(1)}%
						</td>
						<td class="py-[7px] pr-4 text-right">
							<Sparkline
								series={spark(row.frequency)}
								stroke={tone.stroke}
								class="ml-auto h-[22px] w-[88px]"
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if stats.status === 'ok'}
		<p class="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
			No services in this domain deployed in the window.
		</p>
	{/if}
</SectionCard>
