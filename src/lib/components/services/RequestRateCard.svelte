<script lang="ts">
	import LineChart from '../LineChart.svelte';
	import PanelGap from '../PanelGap.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { formatCompact } from '$lib/platform/format';
	import type { TimeSeries } from '$lib/platform/types';
	import type { Panel } from '$lib/platform/sources';

	interface Props {
		series: Panel<TimeSeries>;
	}

	let { series }: Props = $props();

	const points = $derived(series.status === 'ok' ? series.data.points : []);
	const peak = $derived(Math.max(0, ...points.map((point) => point.value)));
</script>

<SectionCard title="Request Rate">
	<PanelGap panel={series} noun="request rate" class="px-4 pb-4" />
	{#if series.status === 'ok'}
		<div class="px-4 pb-4">
			<p class="tabular text-[20px] leading-none font-semibold">
				{formatCompact(peak)}<span class="ml-1 text-[13px] text-muted-foreground">req/s</span>
			</p>
			<p class="mt-1 text-[11px] text-muted-foreground">Peak over the window</p>

			<div class="mt-2">
				<LineChart
					series={[series.data]}
					strokes={{ [series.data.id]: 'stroke-info' }}
					areas={{ [series.data.id]: 'fill-info/12' }}
					height={168}
					maxLabels={8}
					axisWidth={44}
					formatValue={(value) => `${formatCompact(value)} req/s`}
				/>
			</div>
		</div>
	{/if}
</SectionCard>
