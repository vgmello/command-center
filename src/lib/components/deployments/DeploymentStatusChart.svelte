<script lang="ts">
	import LineChart from '../LineChart.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { statusTone } from '../tone';
	import type { TimeRangeOption, TimeSeries } from '$lib/platform/types';
	import type { TimeRangeId } from '$lib/platform/types';

	interface Props {
		series: TimeSeries[];
		ranges: TimeRangeOption[];
		range: TimeRangeId;
		onRangeChange: (value: TimeRangeId) => void;
	}

	let { series, ranges, range, onRangeChange }: Props = $props();

	/*
	 * The three series reuse the status palette rather than a chart palette of their
	 * own: a failed deployment is red for the same reason a down domain is, and a
	 * second set of colours for the same meanings is how a dashboard stops being
	 * readable at a glance.
	 */
	const STROKES: Record<string, string> = {
		successful: statusTone('healthy').stroke,
		'in-progress': 'stroke-info',
		failed: statusTone('down').stroke
	};

	const DOTS: Record<string, string> = {
		successful: statusTone('healthy').dot,
		'in-progress': 'bg-info',
		failed: statusTone('down').dot
	};

	const rangeLabel = $derived(ranges.find((one) => one.id === range)?.label ?? '');
</script>

<section class="rounded-xl border border-border bg-card p-4">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-[14.5px] font-semibold tracking-tight">Deployment Status Over Time</h2>
		<Select.Root
			type="single"
			value={range}
			onValueChange={(value) => onRangeChange(value as TimeRangeId)}
		>
			<Select.Trigger
				class="h-7 gap-1.5 rounded-lg border-border bg-background px-2.5 text-[11.5px] dark:bg-background"
				aria-label="Chart time range"
			>
				{rangeLabel}
			</Select.Trigger>
			<Select.Content>
				{#each ranges as option (option.id)}
					<Select.Item value={option.id} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<ul class="mt-2.5 flex flex-wrap items-center gap-4">
		{#each series as one (one.id)}
			<li class="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
				<span class="size-2 rounded-full {DOTS[one.id]}" aria-hidden="true"></span>
				{one.label}
			</li>
		{/each}
	</ul>

	<div class="mt-1">
		<LineChart {series} strokes={STROKES} height={150} maxLabels={7} />
	</div>
</section>
