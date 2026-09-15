<script lang="ts">
	import PanelGap from '../PanelGap.svelte';
	import type { Panel } from '$lib/platform/sources';
	import SectionCard from '../SectionCard.svelte';
	import {
		axisTicks,
		niceScale,
		plotStackedBars,
		stackedMax,
		thinLabels
	} from '$lib/platform/chart';
	import type { Plot } from '$lib/platform/chart';
	import { accentDot, accentStroke, sentimentText } from '../tone';
	import { formatChange, formatMoneyAxis, trendSentiment } from '$lib/platform/format';
	import type { CostBreakdownView } from '$lib/platform/types';

	interface Props {
		cost: Panel<CostBreakdownView>;
	}

	let { cost }: Props = $props();

	const spend = $derived(
		cost.status === 'ok'
			? cost.data
			: {
					labels: [],
					categories: [],
					total: 0,
					totalFormatted: '—',
					changePct: 0,
					forecast: 0,
					forecastFormatted: '—',
					forecastChangePct: 0
				}
	);

	const width = 760;
	const height = 190;

	const plot: Plot = {
		width,
		height,
		padLeft: 40,
		padRight: 6,
		padTop: 8,
		padBottom: 20
	};

	const series = $derived(
		spend.categories.map((category) => ({
			id: category.id,
			label: category.label,
			values: category.daily
		}))
	);

	const bounds = $derived(niceScale(stackedMax(series, spend.labels.length), 0, 4));
	const segments = $derived(plotStackedBars(series, spend.labels, plot, bounds));
	const ticks = $derived(axisTicks(bounds));
	const labels = $derived(
		thinLabels(
			spend.labels.map((label) => ({ label, value: 0 })),
			8
		)
	);
	const baseline = $derived(plot.height - plot.padBottom);

	// Fills, not strokes: the accent helpers give a stroke class, and a rect needs a
	// fill. Written out here rather than templated, so Tailwind can see each one.
	const FILLS: Record<string, string> = {
		'stroke-info': 'fill-info',
		'stroke-healthy': 'fill-healthy',
		'stroke-degraded': 'fill-degraded',
		'stroke-down': 'fill-down',
		'stroke-violet-400': 'fill-violet-400',
		'stroke-unknown': 'fill-unknown'
	};

	const fillFor = $derived((id: string) => {
		const category = spend.categories.find((one) => one.id === id);
		return category ? (FILLS[accentStroke(category.accent)] ?? 'fill-info') : 'fill-info';
	});

	const spendSentiment = $derived(
		trendSentiment(spend.changePct > 0 ? 'up' : 'down', 'lower-is-better')
	);
	const forecastSentiment = $derived(
		trendSentiment(spend.forecastChangePct > 0 ? 'up' : 'down', 'lower-is-better')
	);
</script>

<SectionCard
	title="Infrastructure Cost (MTD)"
	href="/infrastructure/costs"
	viewAllLabel="View cost analysis"
>
	<PanelGap panel={cost} noun="spend" class="px-4 pb-4" />
	<div class="grid gap-5 px-4 pb-4 xl:grid-cols-[1fr_auto]">
		<div class="flex min-w-0 gap-4">
			<div class="w-[112px] shrink-0">
				<p class="tabular text-[26px] leading-none font-semibold whitespace-nowrap">
					{spend.totalFormatted}
				</p>
				<p class="mt-1 text-[11px] text-muted-foreground">MTD Spend</p>
				<p class="tabular mt-3 text-[11.5px] {sentimentText(spendSentiment)}">
					{formatChange(spend.changePct, '%', 1)}
				</p>
				<p class="text-[10.5px] text-muted-foreground">vs last month</p>
			</div>

			<div class="min-w-0 flex-1">
				<svg
					viewBox="0 0 {width} {height}"
					class="w-full"
					style="height:{height}px"
					role="img"
					aria-label="Daily infrastructure spend by category"
				>
					{#each ticks as tick (tick)}
						{@const y =
							plot.padTop +
							(baseline - plot.padTop) * (1 - (tick - bounds.min) / (bounds.max - bounds.min || 1))}
						<line
							x1={plot.padLeft}
							x2={width - plot.padRight}
							y1={y}
							y2={y}
							class="stroke-border"
						/>
						<text
							x={plot.padLeft - 6}
							y={y + 3}
							text-anchor="end"
							class="fill-muted-foreground text-[9px] tabular-nums"
						>
							{formatMoneyAxis(tick)}
						</text>
					{/each}

					{#each segments as segment (`${segment.label}:${segment.seriesId}`)}
						<rect
							x={segment.x}
							y={segment.y}
							width={segment.width}
							height={segment.height}
							class={fillFor(segment.seriesId)}
						/>
					{/each}

					{#each labels as label, index (index)}
						{#if label && segments[index * series.length]}
							<text
								x={segments[index * series.length].x + segments[index * series.length].width / 2}
								y={height - 5}
								text-anchor="middle"
								class="fill-muted-foreground text-[9px]"
							>
								{label}
							</text>
						{/if}
					{/each}
				</svg>
			</div>
		</div>

		<div class="flex flex-wrap gap-6 xl:flex-nowrap">
			<ul class="min-w-[188px] space-y-2 self-center">
				{#each spend.categories as category (category.id)}
					<li class="flex items-center gap-2 text-[11.5px]">
						<span
							class="size-2 shrink-0 rounded-full {accentDot(category.accent)}"
							aria-hidden="true"
						></span>
						<span class="min-w-0 flex-1 truncate text-muted-foreground">{category.label}</span>
						<span class="tabular shrink-0 font-medium">{category.formatted}</span>
						<span class="tabular w-[40px] shrink-0 text-right text-muted-foreground">
							{category.percentage}%
						</span>
					</li>
				{/each}
			</ul>

			<div class="self-center border-border xl:border-l xl:pl-6">
				<p class="text-[11px] text-muted-foreground">Forecast (End of Month)</p>
				<p class="tabular mt-1 text-[24px] leading-none font-semibold whitespace-nowrap">
					{spend.forecastFormatted}
				</p>
				<p class="tabular mt-2 text-[11.5px] {sentimentText(forecastSentiment)}">
					{formatChange(spend.forecastChangePct, '%', 1)}
					<span class="ml-1 text-muted-foreground">vs last month</span>
				</p>
			</div>
		</div>
	</div>
</SectionCard>
