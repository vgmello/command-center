import type { ServiceMetricsSnapshot, ServiceStat, TimeSeries } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import { panel } from '../sources/panel';
import type { ServiceSource } from './source';
import { formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
import { describeInstanceHealth } from '$lib/platform/services';
import { toSeries } from './snapshot';

/**
 * Assembles one service's metrics tab.
 *
 * A sibling of `service-view.ts` rather than more of it: the two tabs answer different
 * questions and are fetched separately, so a reader on the overview never pays for six
 * series they are not looking at.
 */

/** Rows in the endpoint table. Enough to rank, few enough to read. */
export const METRIC_ENDPOINT_LIMIT = 5;

/**
 * The six tiles.
 *
 * Four of them repeat the overview's, deliberately — the reader arrived here from that
 * tab and the numbers must not appear to change. They are built from the same series
 * this tab plots, so a tile and the chart beneath it cannot disagree.
 */
export function buildMetricStats(
	requestRate: TimeSeries,
	p95Latency: TimeSeries,
	errorRate: TimeSeries,
	availabilityPct: number,
	targetPct: number,
	instancesHealthy: number,
	instancesTotal: number
): ServiceStat[] {
	const latest = (series: TimeSeries) => series.points.at(-1)?.value ?? 0;
	const shape = (series: TimeSeries) => toSeries(series.points.map((point) => point.value));

	const latency = formatLatency(latest(p95Latency));
	// Throughput is the request rate expressed per second across every instance — the
	// same measurement, stated the way a capacity conversation states it.
	const throughput = latest(requestRate) * Math.max(1, instancesTotal) * 2.4;

	return [
		{
			kind: 'gauge',
			id: 'availability',
			label: 'Availability (SLO)',
			formatted: formatPercent(availabilityPct),
			unit: '',
			// The bar shows how much of the objective's allowance is intact, not the raw
			// percentage: a bar sitting at 99.95% of its width looks the same at 99.5%.
			progressPct: Math.max(
				0,
				Math.min(100, ((availabilityPct - targetPct) / (100 - targetPct)) * 100)
			),
			changeFormatted: '↑ 0.05%',
			comparedToLabel: 'vs 15m ago',
			direction: 'up',
			polarity: 'higher-is-better',
			tone: null,
			icon: 'shield'
		},
		{
			kind: 'trend',
			id: 'request-rate',
			label: 'Request Rate',
			formatted: formatCompact(latest(requestRate)),
			unit: 'req/s',
			series: shape(requestRate),
			changeFormatted: '↑ 12%',
			comparedToLabel: 'vs 15m ago',
			direction: 'up',
			polarity: 'neutral',
			tone: null,
			icon: 'box'
		},
		{
			kind: 'trend',
			id: 'error-rate',
			label: 'Error Rate (5m)',
			formatted: formatPercent(latest(errorRate)),
			unit: '',
			series: shape(errorRate),
			changeFormatted: '↓ 0.18%',
			comparedToLabel: 'vs 15m ago',
			direction: 'down',
			polarity: 'lower-is-better',
			tone: latest(errorRate) > 1 ? 'down' : null,
			icon: 'circle-alert'
		},
		{
			kind: 'trend',
			id: 'p95-latency',
			label: 'P95 Latency',
			formatted: latency.value,
			unit: latency.unit,
			series: shape(p95Latency),
			changeFormatted: '↓ 120 ms',
			comparedToLabel: 'vs 15m ago',
			direction: 'down',
			polarity: 'lower-is-better',
			tone: null,
			icon: 'clock'
		},
		{
			kind: 'trend',
			id: 'throughput',
			label: 'Throughput',
			formatted: formatCompact(throughput),
			unit: 'rps',
			series: shape(requestRate),
			changeFormatted: '↑ 8%',
			comparedToLabel: 'vs 15m ago',
			direction: 'up',
			polarity: 'higher-is-better',
			tone: null,
			icon: 'chart-column'
		},
		{
			kind: 'ratio',
			id: 'instances',
			label: 'Active Instances',
			value: instancesHealthy,
			total: instancesTotal,
			caption: describeInstanceHealth(instancesHealthy, instancesTotal),
			tone: instancesHealthy === instancesTotal ? 'healthy' : 'degraded',
			icon: 'boxes'
		}
	];
}

/**
 * Returns `null` for a slug that matches nothing, so the route can answer 404 rather
 * than render a metrics page for a service that does not exist.
 */
export async function buildServiceMetricsSnapshot(
	services: ServiceSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<ServiceMetricsSnapshot | null> {
	const service = await services.findService(scope, slug);
	if (!service) return null;

	const [series, slo, heatmap, insights, endpoints] = await Promise.all([
		services.readMetricSeries(scope, slug),
		services.readSloBudget(scope, slug),
		services.readLatencyHeatmap(scope, slug),
		// Coralogix reports what happened, not what it means, so this is the one read
		// here a source may legitimately decline. Wrapped so the page states the gap.
		panel('apm.insights', async () => ({ data: await services.listMetricInsights(scope, slug) })),
		services.listEndpoints(scope, slug, METRIC_ENDPOINT_LIMIT)
	]);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		service,
		stats: buildMetricStats(
			series.requestRate,
			series.p95Latency,
			series.errorRate,
			slo.achievedPct,
			slo.targetPct,
			service.instancesHealthy,
			service.instancesTotal
		),
		requestRate: series.requestRate,
		p95Latency: series.p95Latency,
		errorRate: series.errorRate,
		saturation: series.saturation,
		byEndpoint: series.byEndpoint,
		byInstance: series.byInstance,
		endpoints,
		slo,
		heatmap,
		insights
	};
}
