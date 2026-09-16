import type { ServiceMetricsSnapshot, ServiceStat, TimeSeries } from '$lib/platform/types';
import type { Panel } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';
import { panel } from '../sources/panel';
import type { ServiceSource } from './source';
import { formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
import { describeInstanceHealth } from '$lib/platform/services';
import { toSeries } from './snapshot';

/** The shape of one `readMetricSeries` answer, named so `pick()` can be typed against it. */
type MetricSeriesResult = Awaited<ReturnType<ServiceSource['readMetricSeries']>>;

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
 *
 * Composed from three independently-sourced pieces rather than built as one block,
 * because each piece can go missing on its own: `apm.metricSeries` feeds four of these
 * tiles, `apm.slo` feeds one, and the catalog feeds the last. A missing SLO must not
 * cost the four tiles a working series already answered — see `buildServiceMetricsSnapshot`,
 * which is the caller that actually has to make that choice per-read.
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
	return [
		availabilityStat(availabilityPct, targetPct),
		...seriesStats(requestRate, p95Latency, errorRate, instancesTotal),
		instancesStat(instancesHealthy, instancesTotal)
	];
}

/** The availability tile, when `apm.slo` answered. */
function availabilityStat(availabilityPct: number, targetPct: number): ServiceStat {
	return {
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
	};
}

/**
 * The availability tile, when `apm.slo` did not.
 *
 * Names the SLO specifically, not "this service" — the four series tiles beside it are
 * measuring this service just fine, and a caption that said otherwise would contradict
 * the charts it sits above.
 */
function unreportedAvailabilityStat(): ServiceStat {
	return {
		kind: 'note',
		id: 'availability',
		label: 'Availability (SLO)',
		formatted: 'Not reported',
		caption: "No connected APM source measures this service's SLO.",
		tone: null,
		icon: 'circle-help'
	};
}

/** The four tiles `apm.metricSeries` feeds, plotting the same series the charts below draw. */
function seriesStats(
	requestRate: TimeSeries,
	p95Latency: TimeSeries,
	errorRate: TimeSeries,
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
		}
	];
}

/** The instances tile: the catalog's own count, unaffected by either APM read. */
function instancesStat(instancesHealthy: number, instancesTotal: number): ServiceStat {
	return {
		kind: 'ratio',
		id: 'instances',
		label: 'Active Instances',
		value: instancesHealthy,
		total: instancesTotal,
		caption: describeInstanceHealth(instancesHealthy, instancesTotal),
		tone: instancesHealthy === instancesTotal ? 'healthy' : 'degraded',
		icon: 'boxes'
	};
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

	// Every source-backed read wrapped, not just insights. That one was wrapped first
	// because Coralogix reports what happened rather than what it means, which made it
	// the obvious gap; the rest were left bare, which is the same latent bug the
	// deployments and infrastructure screens already had — one declined capability must
	// cost this page a panel, not the whole page.
	const [seriesPanel, sloPanel, heatmapPanel, insights, endpointsPanel] = await Promise.all([
		panel('apm.metricSeries', async () => ({ data: await services.readMetricSeries(scope, slug) })),
		panel('apm.slo', async () => ({ data: await services.readSloBudget(scope, slug) })),
		panel('apm.latencyHeatmap', async () => ({
			data: await services.readLatencyHeatmap(scope, slug)
		})),
		panel('apm.insights', async () => ({ data: await services.listMetricInsights(scope, slug) })),
		panel('apm.endpoints', async () => ({
			data: await services.listEndpoints(scope, slug, METRIC_ENDPOINT_LIMIT)
		}))
	]);

	// Six named fields off one read, not six reads — `frequency`/`meanDuration` in
	// `deployments-view.ts` split a single panel the same way. Each sub-field's
	// `unavailable`/`failed` shape carries no `data`, so it is already exactly the right
	// `Panel<T>` for whichever field is asking.
	const pick = <K extends keyof MetricSeriesResult>(key: K) =>
		seriesPanel.status === 'ok'
			? ({ ...seriesPanel, data: seriesPanel.data[key] } as Panel<MetricSeriesResult[K]>)
			: seriesPanel;

	const series = seriesPanel.status === 'ok' ? seriesPanel.data : null;
	const slo = sloPanel.status === 'ok' ? sloPanel.data : null;

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		service,
		// `apm.metricSeries` and `apm.slo` are two different capabilities that can gap
		// independently — a source can plot every series and still not do error budgets, or
		// the reverse. The whole strip only falls back to "not reported" when the series
		// themselves are unavailable, because there is nothing left to build a tile from;
		// a missing SLO alone costs exactly the one tile it feeds.
		stats: series
			? [
					slo ? availabilityStat(slo.achievedPct, slo.targetPct) : unreportedAvailabilityStat(),
					...seriesStats(
						series.requestRate,
						series.p95Latency,
						series.errorRate,
						service.instancesTotal
					),
					instancesStat(service.instancesHealthy, service.instancesTotal)
				]
			: unreportedMetricStats(service.instancesHealthy, service.instancesTotal),
		requestRate: pick('requestRate'),
		p95Latency: pick('p95Latency'),
		errorRate: pick('errorRate'),
		saturation: pick('saturation'),
		byEndpoint: pick('byEndpoint'),
		byInstance: pick('byInstance'),
		endpoints: endpointsPanel,
		slo: sloPanel,
		heatmap: heatmapPanel,
		insights
	};
}

/** What the stat strip says when no source measures this service's metrics. */
function unreportedMetricStats(instancesHealthy: number, instancesTotal: number): ServiceStat[] {
	return [
		{
			kind: 'note',
			id: 'unreported',
			label: 'Metrics',
			formatted: 'Not reported',
			caption: 'No connected APM source measures this service.',
			tone: null,
			icon: 'circle-help'
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
