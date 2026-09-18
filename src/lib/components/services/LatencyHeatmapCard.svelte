<script lang="ts">
	import { thinLabels } from '$lib/platform/chart';
	import type { LatencyHeatmap } from '$lib/platform/types';

	interface Props {
		heatmap: LatencyHeatmap;
	}

	let { heatmap }: Props = $props();

	/*
	 * Worst first, matching the band order the source bucketed against. Written out in
	 * full because Tailwind only ships classes it can see literally — and kept to the
	 * status palette so red still means the same thing it means everywhere else.
	 */
	const BAND_FILLS = [
		'bg-down',
		'bg-down/60',
		'bg-degraded',
		'bg-degraded/55',
		'bg-info/70',
		'bg-healthy/70'
	];

	const columns = $derived(heatmap.columnLabels.length);
	const labels = $derived(
		thinLabels(
			heatmap.columnLabels.map((label) => ({ label, value: 0 })),
			8
		)
	);
</script>

<section class="rounded-xl border border-border bg-card p-4">
	<h2 class="text-[13.5px] font-semibold tracking-tight">Latency Heatmap (P95)</h2>

	<div class="mt-3 flex gap-4">
		<div class="min-w-0 flex-1">
			<div class="flex gap-2">
				<div
					class="flex shrink-0 flex-col justify-between py-[1px] text-[9px] text-muted-foreground"
				>
					{#each heatmap.rowLabels as label (label)}
						<span class="tabular leading-[13px]">{label}</span>
					{/each}
				</div>

				<div
					class="grid min-w-0 flex-1 gap-[2px]"
					style="grid-template-columns: repeat({columns}, minmax(0, 1fr))"
				>
					{#each heatmap.cells as cell (`${cell.column}:${cell.row}`)}
						<span
							class="h-[13px] rounded-[2px] {BAND_FILLS[cell.band] ?? 'bg-muted'}"
							title="{cell.columnLabel} · {heatmap.bands[cell.band]}"
						></span>
					{/each}
				</div>
			</div>

			<div class="mt-1.5 flex gap-2">
				<span class="w-[22px] shrink-0"></span>
				<div
					class="grid min-w-0 flex-1"
					style="grid-template-columns: repeat({columns}, minmax(0, 1fr))"
				>
					{#each labels as label, index (index)}
						<span class="tabular text-[9px] whitespace-nowrap text-muted-foreground">
							{label}
						</span>
					{/each}
				</div>
			</div>
		</div>

		<ul class="shrink-0 space-y-[3px]">
			{#each heatmap.bands as band, index (band)}
				<li class="flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
					<span class="size-2.5 rounded-[2px] {BAND_FILLS[index]}" aria-hidden="true"></span>
					{band}
				</li>
			{/each}
		</ul>
	</div>
</section>
