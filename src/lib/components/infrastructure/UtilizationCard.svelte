<script lang="ts">
	import PanelGap from '../PanelGap.svelte';
	import type { Panel } from '$lib/platform/sources';
	import LineChart from '../LineChart.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { sentimentText } from '../tone';
	import { trendSentiment } from '$lib/platform/format';
	import type { ResourceUsage } from '$lib/platform/types';

	interface Props {
		resources: Panel<ResourceUsage[]>;
		title?: string;
		/** `null` on the domain tab — see `DatabasesCard`. */
		href?: string | null;
	}

	let {
		resources,
		title = 'Resource Utilization',
		href = '/infrastructure/capacity'
	}: Props = $props();

	const rows = $derived(resources.status === 'ok' ? resources.data : []);

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

<SectionCard {title} href={href ?? undefined} viewAllLabel="View all rows">
	<PanelGap panel={resources} noun="utilisation readings" class="px-4 pb-4" />
	<div class="grid gap-4 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each rows as resource (resource.id)}
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
		{:else}
			<!--
				The third state. A gap is PanelGap's above; this is the source answering with
				nothing to measure — a bound domain with no machines — and it must not read
				like a failure. Guarded on `ok` so the two sentences never share the card.
			-->
			{#if resources.status === 'ok'}
				<p class="py-6 text-center text-[12px] text-muted-foreground sm:col-span-2 xl:col-span-4">
					No machines are reporting utilisation.
				</p>
			{/if}
		{/each}
	</div>
</SectionCard>
