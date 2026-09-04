<script lang="ts">
	import LineChart from '../LineChart.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { sentimentText } from '../tone';
	import { trendSentiment } from '$lib/platform/format';
	import type { ResourceUsage } from '$lib/platform/types';

	interface Props {
		resources: ResourceUsage[];
	}

	let { resources }: Props = $props();

	/*
	 * Each panel is drawn against its own stated ceiling, not against its own peak.
	 * Scaling CPU to whatever it happened to reach would make 42% and 95% look the
	 * same, which is the one thing a utilisation chart must never do.
	 */
	const STROKES: Record<string, string> = {
		cpu: 'stroke-info',
		memory: 'stroke-violet-400',
		disk: 'stroke-healthy',
		network: 'stroke-degraded'
	};

	const AREAS: Record<string, string> = {
		cpu: 'fill-info/12',
		memory: 'fill-violet-400/12',
		disk: 'fill-healthy/12',
		network: 'fill-degraded/12'
	};
</script>

<SectionCard
	title="Resource Utilization"
	href="/infrastructure/capacity"
	viewAllLabel="View all resources"
>
	<div class="grid gap-4 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each resources as resource (resource.id)}
			{@const sentiment = trendSentiment(resource.direction, resource.polarity)}
			{@const ceiling = {
				...resource.series,
				points: [...resource.series.points],
				max: resource.axisMax
			}}
			<div class="min-w-0">
				<p class="text-[12px] font-medium text-muted-foreground">{resource.label}</p>
				<div class="mt-1 flex flex-wrap items-baseline gap-2">
					<span class="tabular text-[22px] leading-none font-semibold">
						{resource.formatted}<span class="ml-0.5 text-[13px] text-muted-foreground">
							{resource.unit}
						</span>
					</span>
					<span class="tabular text-[11px] {sentimentText(sentiment)}">
						{resource.changeFormatted}
					</span>
					<span class="text-[11px] text-muted-foreground">{resource.comparedToLabel}</span>
				</div>
				<div class="mt-2">
					<LineChart
						series={[ceiling]}
						strokes={{ [resource.id]: STROKES[resource.id] ?? 'stroke-info' }}
						areas={{ [resource.id]: AREAS[resource.id] ?? 'fill-info/12' }}
						width={230}
						height={118}
						maxLabels={4}
						axisWidth={resource.unit === '%' ? 30 : 42}
						dots={false}
						formatValue={(value) =>
							resource.unit === '%' ? `${Math.round(value)}%` : `${Math.round(value / 1e9)} Gbps`}
					/>
				</div>
			</div>
		{/each}
	</div>
</SectionCard>
