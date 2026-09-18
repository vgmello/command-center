<script lang="ts">
	import SectionCard from '../SectionCard.svelte';
	import { formatPercent } from '$lib/platform/format';
	import type { SloBudget } from '$lib/platform/types';

	interface Props {
		slo: SloBudget;
	}

	let { slo }: Props = $props();

	/*
	 * The bar shows the budget left, not the availability achieved. A bar drawn at
	 * 99.95% of its width is indistinguishable from one at 99.5%, and the difference
	 * between those two is the entire month's allowance.
	 */
	const healthy = $derived(slo.remainingPct >= 25);

	const burnMax = $derived(Math.max(1, ...slo.burn.points.map((point) => point.value)));
</script>

<SectionCard title="SLO / Error Budget" href="/services" viewAllLabel="View details">
	<div class="px-4 pb-4">
		<p class="text-[11.5px] text-muted-foreground">{slo.label}</p>

		<div class="mt-1 flex flex-wrap items-baseline justify-between gap-2">
			<span class="tabular text-[26px] leading-none font-semibold">
				{formatPercent(slo.achievedPct)}
			</span>
			<span class="tabular text-[11.5px] text-muted-foreground">
				Target: {formatPercent(slo.targetPct)}
			</span>
		</div>

		<div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
			<div
				class="h-full rounded-full transition-all duration-500 {healthy
					? 'bg-healthy'
					: 'bg-degraded'}"
				style="width:{slo.remainingPct}%"
			></div>
		</div>

		<div class="mt-4 grid gap-4 sm:grid-cols-2">
			<div>
				<p class="text-[11px] text-muted-foreground">Error budget</p>
				<p class="tabular mt-1 text-[15px] font-semibold">{slo.remainingLabel} remaining</p>
				<p class="tabular text-[10.5px] text-muted-foreground">
					({formatPercent(slo.achievedPct)})
				</p>
			</div>

			<div>
				<p class="text-[11px] text-muted-foreground">Budget burn</p>
				<p class="tabular mt-1 text-[15px] font-semibold">{formatPercent(slo.burnPct, 1)}</p>
				<p class="text-[10.5px] text-muted-foreground">{slo.burnWindowLabel}</p>
			</div>
		</div>

		<!--
			A bar per day of the window. Deliberately unlabelled: it says whether burn is
			steady or spiky, which is all a reader needs before opening the detail.
		-->
		<div class="mt-3 flex h-9 items-end gap-[2px]">
			{#each slo.burn.points as point (point.label)}
				<span
					class="flex-1 rounded-[1px] bg-healthy/70"
					style="height:{Math.max(8, (point.value / burnMax) * 100)}%"
					title="{point.label}: {point.value.toFixed(2)}%"
				></span>
			{/each}
		</div>
	</div>
</SectionCard>
