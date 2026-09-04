<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import EndpointRateCard from '$lib/components/services/EndpointRateCard.svelte';
	import LatencyHeatmapCard from '$lib/components/services/LatencyHeatmapCard.svelte';
	import MetricChartCard from '$lib/components/services/MetricChartCard.svelte';
	import MetricInsightsCard from '$lib/components/services/MetricInsightsCard.svelte';
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
			{@const instanceStrokes = Object.fromEntries(
				snapshot.byInstance.map((one, index) => [
					one.id,
					INSTANCE_STROKES[index % INSTANCE_STROKES.length]
				])
			)}

			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: snapshot.service.domainName },
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
				<MetricChartCard
					title="Request Rate"
					unit="req/s"
					series={[snapshot.requestRate]}
					strokes={{ [snapshot.requestRate.id]: 'stroke-info' }}
					areas={{ [snapshot.requestRate.id]: 'fill-info/12' }}
					width={400}
				/>
				<MetricChartCard
					title="P95 Latency"
					unit="ms"
					series={[snapshot.p95Latency]}
					strokes={{ [snapshot.p95Latency.id]: 'stroke-info' }}
					areas={{ [snapshot.p95Latency.id]: 'fill-info/12' }}
					width={400}
					axisWidth={40}
				/>
				<SloBudgetCard slo={snapshot.slo} />
			</div>

			<div class="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_1.1fr]">
				<MetricChartCard
					title="Error Rate (5m)"
					unit="%"
					series={[snapshot.errorRate]}
					strokes={{ [snapshot.errorRate.id]: 'stroke-down' }}
					areas={{ [snapshot.errorRate.id]: 'fill-down/10' }}
					width={300}
					height={150}
					axisWidth={36}
					formatValue={(value) => value.toFixed(2)}
				/>
				<MetricChartCard
					title="Saturation"
					unit="%"
					series={snapshot.saturation}
					strokes={{ cpu: 'stroke-violet-400', memory: 'stroke-healthy' }}
					width={300}
					height={150}
				/>
				<StackedMetricCard
					title="Request Rate by Endpoint"
					unit="req/s"
					series={snapshot.byEndpoint}
					width={300}
					height={150}
				/>
				<EndpointRateCard endpoints={snapshot.endpoints} />
			</div>

			<div class="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
				<LatencyHeatmapCard heatmap={snapshot.heatmap} />
				<MetricChartCard
					title="Latency by Instance (P95)"
					unit="ms"
					series={snapshot.byInstance}
					strokes={instanceStrokes}
					width={400}
					height={150}
					axisWidth={40}
					formatValue={(value) => formatLatency(value).value}
				/>
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
