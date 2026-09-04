import * as v from 'valibot';
import { formatChange, formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
import type {
	HealthCheck,
	Incident,
	LatencyHeatmap,
	RateObservation,
	ServiceEndpoint,
	ServiceStat,
	SloBudget,
	TimeRangeId,
	TimeSeries
} from '$lib/platform/types';
import { defineProvider } from '../../provider';
import type { ApmProvider } from '../../contracts';
import type { LinkView, SourceBinding, SourceContext } from '../../provider';
import { CoralogixClient } from './client';
import {
	LATENCY_BANDS,
	healthFromUp,
	healthOf,
	latencyBand,
	scalarOf,
	scalarsByLabel,
	toSeries,
	toTimeSeries,
	toTimeSeriesByLabel
} from './map';
import {
	DEFAULT_METRICS,
	RANGE_SECONDS,
	availability,
	errorRate,
	instancesUp,
	p95ByInstance,
	p95ByRoute,
	p95Latency,
	rateByRoute,
	requestRate,
	saturation,
	stepFor,
	type MetricNames
} from './promql';

/**
 * The Coralogix provider.
 *
 * Written against the real APIs — Prometheus-compatible metrics and DataPrime over logs.
 * `baseUrl` names a region or a mock, and nothing else changes.
 *
 * **Three capabilities are deliberately not declared**, and the reasons differ:
 *
 * - `apm.dependencies` needs a service map, which is a different Coralogix API than
 *   either of the two this speaks. It is absent rather than approximated, because a
 *   dependency graph guessed from metric labels would be confidently wrong.
 * - `apm.activity` reports deployment counts alongside incident counts. An APM tool does
 *   not know what deployed; that half belongs to a deployment source, and serving it from
 *   here would mean inventing it.
 * - `apm.insights` is editorial. Coralogix reports what happened.
 *
 * The router turns each undeclared capability into a stated gap, which is the whole point
 * of declaring capabilities rather than implementing an interface with stubs.
 */

const environmentLabel = v.optional(v.pipe(v.string(), v.maxLength(120)), 'environment');

export const coralogixSettings = v.object({
	/** The region root, e.g. `https://api.eu2.coralogix.com`, or a mock's URL. */
	baseUrl: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
	apiKey: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
	/**
	 * Which labels carry the service and the environment.
	 *
	 * Configurable because these are conventions, not standards — an account fed by a
	 * hand-rolled exporter may well call them something else, and a provider that assumed
	 * would silently return nothing.
	 */
	serviceLabel: v.optional(v.pipe(v.string(), v.maxLength(120)), 'service'),
	environmentLabel,
	domainLabel: v.optional(v.pipe(v.string(), v.maxLength(120)), 'domain'),
	/** Metric names, defaulting to OpenTelemetry's HTTP semantic conventions. */
	metrics: v.optional(
		v.object({
			requests: v.optional(v.string(), DEFAULT_METRICS.requests),
			duration: v.optional(v.string(), DEFAULT_METRICS.duration),
			errors: v.optional(v.string(), DEFAULT_METRICS.errors),
			cpu: v.optional(v.string(), DEFAULT_METRICS.cpu),
			memory: v.optional(v.string(), DEFAULT_METRICS.memory),
			up: v.optional(v.string(), DEFAULT_METRICS.up)
		}),
		DEFAULT_METRICS
	),
	/** The availability objective the SLO panel measures against, as a percentage. */
	sloTargetPct: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100)), 99.9),
	/** The rolling window the objective is measured over, in days. */
	sloWindowDays: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(90)), 30)
});

export type CoralogixSettings = v.InferOutput<typeof coralogixSettings>;

/** What a Coralogix event looks like once read back out of DataPrime. */
interface CoralogixEvent {
	timestamp: string;
	severity: 'critical' | 'warning' | 'info';
	service: string;
	domain: string;
	title: string;
	state: 'firing' | 'acknowledged' | 'resolved';
}

/**
 * Escape a value interpolated into a DataPrime query.
 *
 * The same reasoning as the PromQL label escaping: a value that reaches a query language
 * unescaped can end the string and have the rest read as query. This one takes only
 * fixed enum values today, which is exactly when the guard is cheapest to add.
 */
function escapeDataPrime(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const SEVERITY: Record<CoralogixEvent['severity'], Incident['severity']> = {
	critical: 'critical',
	warning: 'warning',
	info: 'info'
};

const STATE: Record<CoralogixEvent['state'], Incident['state']> = {
	firing: 'open',
	acknowledged: 'acknowledged',
	resolved: 'resolved'
};

export const coralogixProvider = defineProvider<ApmProvider>({
	id: 'coralogix',
	kind: 'apm',
	name: 'Coralogix',
	icon: 'activity',
	capabilities: [
		'apm.serviceStats',
		'apm.healthChecks',
		'apm.endpoints',
		'apm.metricSeries',
		'apm.requestRate',
		'apm.slo',
		'apm.latencyHeatmap',
		'apm.domainVitals',
		'apm.rates',
		'apm.incidents'
	],
	settings: coralogixSettings,
	connect: (raw) => {
		const settings = raw as CoralogixSettings;
		const metrics = settings.metrics as MetricNames;
		const client = new CoralogixClient({ baseUrl: settings.baseUrl, apiKey: settings.apiKey });

		/** The label matchers for a call: its environment, and its service if it has one. */
		function labelsFor(ctx: SourceContext, slug?: string): Record<string, string | undefined> {
			return {
				[settings.environmentLabel]: ctx.scope.environment,
				...(slug ? { [settings.serviceLabel]: slug } : {})
			};
		}

		function slugOf(ctx: SourceContext): string | undefined {
			return ctx.binding?.externalId || undefined;
		}

		function window(range: TimeRangeId, now = new Date()) {
			return {
				from: new Date(now.getTime() - RANGE_SECONDS[range] * 1000),
				to: now,
				step: stepFor(range),
				span: RANGE_SECONDS[range]
			};
		}

		/** One range query, as a `TimeSeries`. */
		async function series(
			query: string,
			id: string,
			label: string,
			range: TimeRangeId
		): Promise<TimeSeries> {
			const { from, to, step, span } = window(range);
			return toTimeSeries(await client.range(query, from, to, step), id, label, span);
		}

		return {
			async readRequestRate(ctx) {
				const labels = labelsFor(ctx, slugOf(ctx));
				return series(
					requestRate(metrics, labels, ctx.scope.timeRange),
					'request-rate',
					'Requests / sec',
					ctx.scope.timeRange
				);
			},

			async readMetricSeries(ctx) {
				const range = ctx.scope.timeRange;
				const labels = labelsFor(ctx, slugOf(ctx));
				const { from, to, step, span } = window(range);

				// Issued together: six sequential round trips would make this the slowest
				// panel on the screen for no reason — they share nothing.
				const [rate, p95, errors, cpu, memory, byRoute, byInstance] = await Promise.all([
					series(requestRate(metrics, labels, range), 'request-rate', 'Requests / sec', range),
					series(p95Latency(metrics, labels, range), 'p95', 'P95 latency (ms)', range),
					series(errorRate(metrics, labels, range), 'error-rate', 'Error rate (%)', range),
					series(saturation(metrics, labels, 'cpu'), 'cpu', 'CPU (%)', range),
					series(saturation(metrics, labels, 'memory'), 'memory', 'Memory (%)', range),
					client.range(rateByRoute(metrics, labels, range), from, to, step),
					client.range(p95ByInstance(metrics, labels, range), from, to, step)
				]);

				return {
					requestRate: rate,
					p95Latency: p95,
					errorRate: errors,
					saturation: [cpu, memory],
					byEndpoint: toTimeSeriesByLabel(byRoute, 'http_route', span),
					byInstance: toTimeSeriesByLabel(byInstance, 'instance', span)
				};
			},

			async readServiceStats(ctx) {
				const range = ctx.scope.timeRange;
				const labels = labelsFor(ctx, slugOf(ctx));
				const now = new Date();
				const { from, to, step } = window(range, now);

				const [rateNow, p95Now, errorsNow, rateSeries, p95Series, errorSeries, up] =
					await Promise.all([
						client.instant(requestRate(metrics, labels, range), now),
						client.instant(p95Latency(metrics, labels, range), now),
						client.instant(errorRate(metrics, labels, range), now),
						client.range(requestRate(metrics, labels, range), from, to, step),
						client.range(p95Latency(metrics, labels, range), from, to, step),
						client.range(errorRate(metrics, labels, range), from, to, step),
						client.instant(instancesUp(metrics, labels), now)
					]);

				const rate = scalarOf(rateNow);
				const p95 = scalarOf(p95Now);
				const errors = scalarOf(errorsNow);
				const instances = scalarsByLabel(up, 'instance');
				const answering = [...instances.values()].filter((one) => one > 0).length;

				const latency = formatLatency(p95);
				const rateSamples = toSeries(rateSeries);
				const p95Samples = toSeries(p95Series);
				const errorSamples = toSeries(errorSeries);

				/** First versus last across the window — the change a tile reports. */
				const changeOf = (values: number[]) =>
					values.length < 2 ? 0 : values[values.length - 1] - values[0];

				const stats: ServiceStat[] = [
					{
						kind: 'trend',
						id: 'request-rate',
						label: 'Request rate',
						formatted: formatCompact(rate),
						unit: 'req/s',
						series: rateSamples,
						changeFormatted: formatChange(changeOf(rateSamples.values), 'req/s', 1),
						comparedToLabel: `vs ${range} ago`,
						direction: changeOf(rateSamples.values) >= 0 ? 'up' : 'down',
						polarity: 'neutral',
						tone: null,
						icon: 'activity'
					},
					{
						kind: 'trend',
						id: 'p95-latency',
						label: 'P95 latency',
						formatted: latency.value,
						unit: latency.unit,
						series: p95Samples,
						changeFormatted: formatChange(changeOf(p95Samples.values), 'ms', 0),
						comparedToLabel: `vs ${range} ago`,
						direction: changeOf(p95Samples.values) >= 0 ? 'up' : 'down',
						// Slower is worse, which is the opposite of more traffic being worse.
						polarity: 'lower-is-better',
						tone: p95 >= 1000 ? 'degraded' : null,
						icon: 'timer'
					},
					{
						kind: 'trend',
						id: 'error-rate',
						label: 'Error rate',
						formatted: formatPercent(errors, 2),
						unit: '%',
						series: errorSamples,
						changeFormatted: formatChange(changeOf(errorSamples.values), '%', 2),
						comparedToLabel: `vs ${range} ago`,
						direction: changeOf(errorSamples.values) >= 0 ? 'up' : 'down',
						polarity: 'lower-is-better',
						tone: errors >= 5 ? 'down' : errors >= 1 ? 'degraded' : null,
						icon: 'triangle-alert'
					},
					{
						kind: 'ratio',
						id: 'instances',
						label: 'Instances',
						value: answering,
						total: instances.size,
						caption:
							answering === instances.size ? 'All reporting' : `${instances.size - answering} down`,
						tone: answering === instances.size ? null : 'degraded',
						icon: 'server'
					}
				];

				return stats;
			},

			async listHealthChecks(ctx) {
				const range = ctx.scope.timeRange;
				const labels = labelsFor(ctx, slugOf(ctx));
				const now = new Date();
				const { from, to, step } = window(range, now);

				const [up, p95Now, errorsNow, p95Series, errorSeries, rateSeries] = await Promise.all([
					client.instant(instancesUp(metrics, labels), now),
					client.instant(p95Latency(metrics, labels, range), now),
					client.instant(errorRate(metrics, labels, range), now),
					client.range(p95Latency(metrics, labels, range), from, to, step),
					client.range(errorRate(metrics, labels, range), from, to, step),
					client.range(requestRate(metrics, labels, range), from, to, step)
				]);

				const instances = scalarsByLabel(up, 'instance');
				const p95 = scalarOf(p95Now);
				const errors = scalarOf(errorsNow);
				const latency = formatLatency(p95);

				const checks: HealthCheck[] = [
					{
						id: 'liveness',
						label: 'Liveness',
						icon: 'heart-pulse',
						status: healthFromUp(instances),
						formatted: `${[...instances.values()].filter((one) => one > 0).length}/${instances.size} up`,
						series: toSeries(rateSeries)
					},
					{
						id: 'latency',
						label: 'P95 latency',
						icon: 'timer',
						status: p95 >= 1000 ? 'degraded' : 'healthy',
						formatted: `${latency.value} ${latency.unit}`,
						series: toSeries(p95Series)
					},
					{
						id: 'errors',
						label: 'Error rate',
						icon: 'triangle-alert',
						status: healthOf(errors, 0),
						formatted: formatPercent(errors, 2),
						series: toSeries(errorSeries)
					}
				];

				return checks;
			},

			async listEndpoints(ctx, limit) {
				const range = ctx.scope.timeRange;
				const labels = labelsFor(ctx, slugOf(ctx));
				const now = new Date();

				const [p95ByEndpoint, rateByEndpoint] = await Promise.all([
					client.instant(p95ByRoute(metrics, labels, range), now),
					client.instant(rateByRoute(metrics, labels, range), now)
				]);

				const latencies = scalarsByLabel(p95ByEndpoint, 'http_route');
				const rates = scalarsByLabel(rateByEndpoint, 'http_route');

				const slowest = Math.max(...latencies.values(), 1);
				const totalRate = [...rates.values()].reduce((sum, one) => sum + one, 0) || 1;

				const rows: ServiceEndpoint[] = [...latencies.entries()]
					.map(([route, p95]) => {
						const perSecond = rates.get(route) ?? 0;

						return {
							id: route,
							// The metric carries a route, not a verb. Reporting a method we do not
							// have would be inventing one, so it is stated as unknown.
							method: 'ANY',
							path: route,
							p95LatencyMs: Math.round(p95),
							latencySharePct: Math.round((p95 / slowest) * 1000) / 10,
							requestsPerSecond: Math.round(perSecond * 100) / 100,
							requestSharePct: Math.round((perSecond / totalRate) * 1000) / 10,
							status: healthOf(0, p95)
						};
					})
					.sort((a, b) => b.p95LatencyMs - a.p95LatencyMs)
					.slice(0, limit);

				return rows;
			},

			async readSloBudget(ctx) {
				const labels = labelsFor(ctx, slugOf(ctx));
				const days = settings.sloWindowDays;
				const target = settings.sloTargetPct;
				const now = new Date();

				const [achievedNow, burnSeries] = await Promise.all([
					client.instant(availability(metrics, labels, `${days}d`), now),
					client.range(
						availability(metrics, labels, '1d'),
						new Date(now.getTime() - days * 86_400_000),
						now,
						86_400
					)
				]);

				const achieved = scalarOf(achievedNow, 100);

				// The allowance is what the objective permits, in minutes of the window.
				const allowanceMinutes = ((100 - target) / 100) * days * 24 * 60;
				const spentMinutes = Math.max(0, ((100 - achieved) / 100) * days * 24 * 60);
				const remainingMinutes = Math.max(0, Math.round(allowanceMinutes - spentMinutes));
				const remainingPct =
					allowanceMinutes === 0
						? 100
						: Math.max(0, Math.round((remainingMinutes / allowanceMinutes) * 100));

				const hours = Math.floor(remainingMinutes / 60);
				const minutes = remainingMinutes % 60;

				const budget: SloBudget = {
					label: `Availability (${days}d rolling)`,
					achievedPct: Math.round(achieved * 1000) / 1000,
					targetPct: target,
					remainingPct,
					remainingMinutes,
					// Derived from the number beside it, so the panel and the API cannot round
					// the same figure two different ways.
					remainingLabel: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
					burnPct: Math.round((100 - remainingPct) * 10) / 10,
					burnWindowLabel: `Last ${days} days`,
					burn: toTimeSeries(burnSeries, 'burn', 'Availability (%)', days * 86_400)
				};

				return budget;
			},

			async readLatencyHeatmap(ctx) {
				const range = ctx.scope.timeRange;
				const labels = labelsFor(ctx, slugOf(ctx));
				const { from, to, step, span } = window(range);

				const matrix = await client.range(p95ByInstance(metrics, labels, range), from, to, step);
				const rows = toTimeSeriesByLabel(matrix, 'instance', span, 12);
				const columnLabels = rows[0]?.points.map((one) => one.label) ?? [];

				const heatmap: LatencyHeatmap = {
					columnLabels,
					rowLabels: rows.map((one) => one.label),
					bands: [...LATENCY_BANDS],
					cells: rows.flatMap((row, rowIndex) =>
						row.points.map((point, column) => ({
							column,
							row: rowIndex,
							band: latencyBand(point.value),
							columnLabel: point.label
						}))
					)
				};

				return heatmap;
			},

			async readDomainVitals(ctx) {
				const domain = ctx.binding?.externalId;
				if (!domain) return null;

				const range = ctx.scope.timeRange;
				const labels = {
					[settings.environmentLabel]: ctx.scope.environment,
					[settings.domainLabel]: domain
				};
				const now = new Date();

				const [rate, errors, p95, up] = await Promise.all([
					series(requestRate(metrics, labels, range), 'request-rate', 'Requests / sec', range),
					series(errorRate(metrics, labels, range), 'error-rate', 'Error rate (%)', range),
					series(p95Latency(metrics, labels, range), 'p95', 'P95 latency (ms)', range),
					client.instant(instancesUp(metrics, labels), now)
				]);

				// A domain with no series at all is not a domain this source knows about —
				// answering with zeroes would put an empty panel under a real heading.
				if (rate.points.length === 0 && up.result.length === 0) return null;

				const byService = new Map<string, number[]>();
				for (const row of up.result) {
					const service = row.metric[settings.serviceLabel];
					if (!service) continue;
					byService.set(service, [...(byService.get(service) ?? []), Number(row.value[1])]);
				}

				const counts = { healthy: 0, degraded: 0, down: 0 };
				for (const values of byService.values()) {
					const answering = values.filter((one) => one > 0).length;
					if (answering === 0) counts.down++;
					else if (answering < values.length) counts.degraded++;
					else counts.healthy++;
				}

				const achieved = await client.instant(
					availability(metrics, labels, `${settings.sloWindowDays}d`),
					now
				);

				return {
					requestRate: rate,
					errorRate: errors,
					p95Latency: p95,
					serviceCounts: counts,
					sloCompliancePct: Math.round(scalarOf(achieved, 100) * 100) / 100,
					sloWindowLabel: `${settings.sloWindowDays}d rolling`
				};
			},

			async readRates(ctx) {
				const range = ctx.scope.timeRange;
				const labels = labelsFor(ctx);
				const now = new Date();
				const { from, to, step } = window(range, now);

				const [rateNow, p95Now, errorsNow, rateSeries, p95Series, errorSeries] = await Promise.all([
					client.instant(requestRate(metrics, labels, range), now),
					client.instant(p95Latency(metrics, labels, range), now),
					client.instant(errorRate(metrics, labels, range), now),
					client.range(requestRate(metrics, labels, range), from, to, step),
					client.range(p95Latency(metrics, labels, range), from, to, step),
					client.range(errorRate(metrics, labels, range), from, to, step)
				]);

				const change = (values: number[]) =>
					values.length < 2 ? 0 : values[values.length - 1] - values[0];

				const rateSamples = toSeries(rateSeries).values;
				const p95Samples = toSeries(p95Series).values;
				const errorSamples = toSeries(errorSeries).values;

				const observations: RateObservation[] = [
					{
						id: 'request-rate',
						label: 'Request rate',
						value: scalarOf(rateNow),
						kind: 'rate',
						unit: 'req/s',
						samples: rateSamples,
						change: change(rateSamples),
						polarity: 'neutral'
					},
					{
						id: 'p95-latency',
						label: 'P95 latency',
						value: scalarOf(p95Now),
						kind: 'duration-ms',
						unit: 'ms',
						samples: p95Samples,
						change: change(p95Samples),
						polarity: 'lower-is-better'
					},
					{
						id: 'error-rate',
						label: 'Error rate',
						value: scalarOf(errorsNow),
						kind: 'percent',
						unit: '%',
						samples: errorSamples,
						change: change(errorSamples),
						polarity: 'lower-is-better'
					}
				];

				return observations;
			},

			async listIncidents(ctx, limit) {
				const now = new Date();
				const from = new Date(now.getTime() - RANGE_SECONDS['7d'] * 1000);

				// DataPrime, not PromQL: an incident is an event, and events are logs.
				//
				// Scoped to the environment like every other read on the page. An incident
				// list that ignored the scope would show staging alerts on a production
				// dashboard, which is how an on-call engineer chases a problem that is not
				// theirs.
				const rows = await client.dataprime(
					`source logs | filter $d.severity != 'info' && $d.environment == '${escapeDataPrime(ctx.scope.environment)}' | sort $m.timestamp desc`,
					from,
					now,
					limit
				);

				const incidents: Incident[] = [];

				for (const row of rows) {
					if (!row.userData) continue;

					let event: CoralogixEvent;
					try {
						event = JSON.parse(row.userData) as CoralogixEvent;
					} catch {
						// One unreadable row must not discard the rest of the list.
						continue;
					}

					if (!event.title || !event.timestamp) continue;

					incidents.push({
						id: `${event.service}-${event.timestamp}`,
						title: event.title,
						domainId: event.domain.toLowerCase(),
						domainName: event.domain,
						severity: SEVERITY[event.severity] ?? 'info',
						state: STATE[event.state] ?? 'investigating',
						openedAt: event.timestamp
					});
				}

				return incidents.slice(0, limit);
			},

			/**
			 * A link into Coralogix's own UI.
			 *
			 * The explore view for logs, the dashboard otherwise — where an engineer
			 * chasing this particular thing actually wants to land.
			 */
			resourceLink(binding: SourceBinding | undefined, view: LinkView) {
				if (!binding) return null;

				const base = client.baseUrl.replace('//api.', '//');
				const href =
					view === 'logs'
						? `${base}/#/query-new/logs?query=${encodeURIComponent(`source logs | filter $d.service == '${binding.externalId}'`)}`
						: `${base}/#/apm/services/${encodeURIComponent(binding.externalId)}`;

				return { label: 'Show in Coralogix', href };
			}
		};
	}
});
