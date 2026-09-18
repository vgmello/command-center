<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import EndpointRateCard from '$lib/components/services/EndpointRateCard.svelte';
	import LatencyHeatmapCard from '$lib/components/services/LatencyHeatmapCard.svelte';
	import MetricChartCard from '$lib/components/services/MetricChartCard.svelte';
	import MetricInsightsCard from '$lib/components/services/MetricInsightsCard.svelte';
	import PanelGap from '$lib/components/PanelGap.svelte';
	import ServiceHeader from '$lib/components/services/ServiceHeader.svelte';
	import ServiceTabs from '$lib/components/services/ServiceTabs.svelte';
	import SloBudgetCard from '$lib/components/services/SloBudgetCard.svelte';
	import StackedMetricCard from '$lib/components/services/StackedMetricCard.svelte';
	import StatTiles from '$lib/components/StatTiles.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getScope } from '$lib/scope.svelte';
	import { getServiceMetrics } from '../../../services.remote';
	import { formatLatency } from '$lib/platform/format';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Panel } from '$lib/platform/sources';

	const scope = getScope();

	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });
	const view = $derived(getServiceMetrics(args));

	$effect(() => {
		if (!scope.autoRefresh) return;
		const timer = setInterval(() => view.refresh(), scope.refreshIntervalMs);
		return () => clearInterval(timer);
	});

	/*
	 * A stroke class per series id. Instance ids are not known until the data arrives,
	 * so that map is built from the response rather than declared — but the palette it
	 * draws from is fixed, and comes from the same tokens every other chart uses.
	 */
	const INSTANCE_STROKES = [
		'stroke-info',
		'stroke-degraded',
		'stroke-violet-400',
		'stroke-healthy'
	];
</script>

<svelte:head><title>Metrics · {slug} · Command Center</title></svelte:head>

{#snippet gapCard(title: string, panel: Panel<unknown>, noun: string)}
	<!--
		The chart's own frame, minus the chart: six panels come off one `apm.metricSeries`
		read (plus the SLO, the heatmap and the endpoint list, each its own capability),
		and any one of them can be a gap on its own. A blank chart with a flat line would
		say "zero", which nobody measured. Declared outside `<svelte:boundary>` because a
		snippet nested anywhere inside one is read as an attempt to satisfy its
		`pending`/`failed`/`onerror` props, not as an ordinary renderable.
	-->
	<section class="rounded-xl border border-border bg-card p-4">
		<h2 class="text-[13.5px] font-semibold tracking-tight">{title}</h2>
		<PanelGap {panel} {noun} class="mt-2" />
	</section>
{/snippet}

<div class="space-y-4 p-5">
	<svelte:boundary>
		{@const snapshot = await getServiceMetrics(args)}

		{#if !snapshot}
			<div class="flex flex-col items-center justify-center gap-2 py-24 text-center">
				<p class="text-[15px] font-medium">No service called “{slug}”.</p>
				<a
					href={resolve('/services')}
					class="text-[13px] font-medium text-primary hover:text-primary/80"
				>
					Back to all services
				</a>
			</div>
		{:else}
			{@const byInstance = snapshot.byInstance.status === 'ok' ? snapshot.byInstance.data : []}
			{@const instanceStrokes = Object.fromEntries(
				byInstance.map((one, index) => [one.id, INSTANCE_STROKES[index % INSTANCE_STROKES.length]])
			)}

			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: snapshot.service.domainName, href: `/domains/${snapshot.service.domainId}` },
					{ label: 'Services', href: '/services' },
					{ label: snapshot.service.name, href: `/services/${snapshot.service.slug}` },
					{ label: 'Metrics' }
				]}
			/>

			<ServiceHeader service={snapshot.service} />
			<ServiceTabs
				slug={snapshot.service.slug}
				active="metrics"
				badges={{ alerts: snapshot.service.activeAlerts }}
			/>

			<StatTiles stats={snapshot.stats} />

			<div class="grid gap-4 xl:grid-cols-[1fr_1fr_0.85fr]">
				{#if snapshot.requestRate.status === 'ok'}
					{@const requestRate = snapshot.requestRate.data}
					<MetricChartCard
						title="Request Rate"
						unit="req/s"
						series={[requestRate]}
						strokes={{ [requestRate.id]: 'stroke-info' }}
						areas={{ [requestRate.id]: 'fill-info/12' }}
						width={400}
					/>
				{:else}
					{@render gapCard('Request Rate', snapshot.requestRate, 'request rate')}
				{/if}

				{#if snapshot.p95Latency.status === 'ok'}
					{@const p95Latency = snapshot.p95Latency.data}
					<MetricChartCard
						title="P95 Latency"
						unit="ms"
						series={[p95Latency]}
						strokes={{ [p95Latency.id]: 'stroke-info' }}
						areas={{ [p95Latency.id]: 'fill-info/12' }}
						width={400}
						axisWidth={40}
					/>
				{:else}
					{@render gapCard('P95 Latency', snapshot.p95Latency, 'latency')}
				{/if}

				{#if snapshot.slo.status === 'ok'}
					<SloBudgetCard slo={snapshot.slo.data} />
				{:else}
					{@render gapCard('SLO / Error Budget', snapshot.slo, 'the error budget')}
				{/if}
			</div>

			<div class="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_1.1fr]">
				{#if snapshot.errorRate.status === 'ok'}
					{@const errorRate = snapshot.errorRate.data}
					<MetricChartCard
						title="Error Rate (5m)"
						unit="%"
						series={[errorRate]}
						strokes={{ [errorRate.id]: 'stroke-down' }}
						areas={{ [errorRate.id]: 'fill-down/10' }}
						width={300}
						height={150}
						axisWidth={36}
						formatValue={(value) => value.toFixed(2)}
					/>
				{:else}
					{@render gapCard('Error Rate (5m)', snapshot.errorRate, 'error rate')}
				{/if}

				{#if snapshot.saturation.status === 'ok'}
					<MetricChartCard
						title="Saturation"
						unit="%"
						series={snapshot.saturation.data}
						strokes={{ cpu: 'stroke-violet-400', memory: 'stroke-healthy' }}
						width={300}
						height={150}
					/>
				{:else}
					{@render gapCard('Saturation', snapshot.saturation, 'saturation')}
				{/if}

				{#if snapshot.byEndpoint.status === 'ok'}
					<StackedMetricCard
						title="Request Rate by Endpoint"
						unit="req/s"
						series={snapshot.byEndpoint.data}
						width={300}
						height={150}
					/>
				{:else}
					{@render gapCard(
						'Request Rate by Endpoint',
						snapshot.byEndpoint,
						'request rate by endpoint'
					)}
				{/if}

				{#if snapshot.endpoints.status === 'ok'}
					<EndpointRateCard endpoints={snapshot.endpoints.data} />
				{:else}
					{@render gapCard('Top Endpoints by Request Rate', snapshot.endpoints, 'endpoints')}
				{/if}
			</div>

			<div class="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
				{#if snapshot.heatmap.status === 'ok'}
					<LatencyHeatmapCard heatmap={snapshot.heatmap.data} />
				{:else}
					{@render gapCard('Latency Heatmap', snapshot.heatmap, 'a latency heatmap')}
				{/if}

				{#if snapshot.byInstance.status === 'ok'}
					<MetricChartCard
						title="Latency by Instance (P95)"
						unit="ms"
						series={snapshot.byInstance.data}
						strokes={instanceStrokes}
						width={400}
						height={150}
						axisWidth={40}
						formatValue={(value) => formatLatency(value).value}
					/>
				{:else}
					{@render gapCard(
						'Latency by Instance (P95)',
						snapshot.byInstance,
						'per-instance latency'
					)}
				{/if}
			</div>

			<MetricInsightsCard insights={snapshot.insights} />
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[360px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[42px] rounded-xl" />
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
				{#each ['a', 'b', 'c', 'd', 'e', 'f'] as key (key)}
					<Skeleton class="h-[124px] rounded-xl" />
				{/each}
			</div>
			<div class="grid gap-4 xl:grid-cols-3">
				<Skeleton class="h-[236px] rounded-xl" />
				<Skeleton class="h-[236px] rounded-xl" />
				<Skeleton class="h-[236px] rounded-xl" />
			</div>
		{/snippet}
	</svelte:boundary>
</div>
