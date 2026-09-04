import type { TimeRangeId } from '$lib/platform/types';

/**
 * The PromQL this provider sends.
 *
 * Kept apart from the client and from the mapping so the expressions can be read — and
 * asserted — without a server. A query built by string concatenation inside a fetch call
 * is a query nobody ever checks.
 *
 * Metric names follow OpenTelemetry's HTTP semantic conventions, which is what a
 * Coralogix account fed by OTel collectors actually holds. A deployment using different
 * names configures them; the defaults are not a guess about one customer's setup.
 */

export interface MetricNames {
	requests: string;
	duration: string;
	errors: string;
	cpu: string;
	memory: string;
	up: string;
}

export const DEFAULT_METRICS: MetricNames = {
	requests: 'http_server_request_duration_count',
	duration: 'http_server_request_duration_bucket',
	errors: 'http_server_request_duration_count',
	cpu: 'process_cpu_utilization',
	memory: 'process_memory_utilization',
	up: 'up'
};

/**
 * Escape a label value for a PromQL matcher.
 *
 * A service slug arrives from a URL anyone can edit. Without this, a slug containing a
 * quote would close the matcher and the rest would be read as PromQL — the query-language
 * equivalent of an injection, against an API that will happily run what it is given.
 */
export function escapeLabel(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** `{service="payment-api", environment="production"}`, safely quoted. */
export function selector(labels: Record<string, string | undefined>): string {
	const pairs = Object.entries(labels)
		.filter(([, value]) => value !== undefined && value !== '')
		.map(([key, value]) => `${key}="${escapeLabel(value as string)}"`);

	return `{${pairs.join(',')}}`;
}

/**
 * The lookback each time range uses inside `rate()`.
 *
 * A rate window shorter than the scrape interval yields nothing, and one much longer
 * flattens exactly the spike a reader opened the page to see. These track the range.
 */
export const RATE_WINDOW: Record<TimeRangeId, string> = {
	'5m': '1m',
	'15m': '1m',
	'1h': '5m',
	'6h': '10m',
	'24h': '15m',
	'7d': '1h'
};

/** How far back each range looks, in seconds. */
export const RANGE_SECONDS: Record<TimeRangeId, number> = {
	'5m': 5 * 60,
	'15m': 15 * 60,
	'1h': 60 * 60,
	'6h': 6 * 60 * 60,
	'24h': 24 * 60 * 60,
	'7d': 7 * 24 * 60 * 60
};

/**
 * The step for a range query, chosen to land near `points` samples.
 *
 * Prometheus rejects a query whose window divided by its step exceeds its point limit,
 * so the step is derived from the window rather than fixed — a 7-day range at a 60-second
 * step is ten thousand points nobody can read and many servers refuse.
 */
export function stepFor(range: TimeRangeId, points = 24): number {
	return Math.max(15, Math.round(RANGE_SECONDS[range] / points));
}

export function requestRate(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	range: TimeRangeId
): string {
	return `sum(rate(${metrics.requests}${selector(labels)}[${RATE_WINDOW[range]}]))`;
}

export function errorRate(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	range: TimeRangeId
): string {
	const failing = selector({ ...labels, http_response_status_code: undefined });
	const errors = `sum(rate(${metrics.errors}${failing.slice(0, -1)},http_response_status_code=~"5.."}[${RATE_WINDOW[range]}]))`;
	const total = `sum(rate(${metrics.requests}${selector(labels)}[${RATE_WINDOW[range]}]))`;

	// `or vector(0)` so a service with no errors reports zero rather than an empty
	// series. An absent line and a flat zero mean different things to a reader.
	return `(${errors} or vector(0)) / clamp_min(${total}, 1) * 100`;
}

/** P95 from a histogram, which is how OTel records duration. */
export function p95Latency(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	range: TimeRangeId
): string {
	return `histogram_quantile(0.95, sum by (le) (rate(${metrics.duration}${selector(labels)}[${RATE_WINDOW[range]}]))) * 1000`;
}

/** P95 split by endpoint route, for the endpoint table and the stacked chart. */
export function p95ByRoute(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	range: TimeRangeId
): string {
	return `histogram_quantile(0.95, sum by (le,http_route) (rate(${metrics.duration}${selector(labels)}[${RATE_WINDOW[range]}]))) * 1000`;
}

export function rateByRoute(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	range: TimeRangeId
): string {
	return `sum by (http_route) (rate(${metrics.requests}${selector(labels)}[${RATE_WINDOW[range]}]))`;
}

/** P95 split by instance, to show whether one pod is the problem. */
export function p95ByInstance(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	range: TimeRangeId
): string {
	return `histogram_quantile(0.95, sum by (le,instance) (rate(${metrics.duration}${selector(labels)}[${RATE_WINDOW[range]}]))) * 1000`;
}

export function saturation(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	kind: 'cpu' | 'memory'
): string {
	return `avg(${kind === 'cpu' ? metrics.cpu : metrics.memory}${selector(labels)}) * 100`;
}

/** Availability over a window, as a percentage — the SLO's achieved figure. */
export function availability(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	window: string
): string {
	const failing = selector(labels);
	const errors = `sum(increase(${metrics.errors}${failing.slice(0, -1)},http_response_status_code=~"5.."}[${window}]))`;
	const total = `sum(increase(${metrics.requests}${selector(labels)}[${window}]))`;

	return `(1 - (${errors} or vector(0)) / clamp_min(${total}, 1)) * 100`;
}

/** Whether each instance is answering, for the health-check panel. */
export function instancesUp(
	metrics: MetricNames,
	labels: Record<string, string | undefined>
): string {
	return `${metrics.up}${selector(labels)}`;
}

/** Request rate per service, for the domain and overview rollups. */
export function rateByService(
	metrics: MetricNames,
	labels: Record<string, string | undefined>,
	range: TimeRangeId
): string {
	return `sum by (service) (rate(${metrics.requests}${selector(labels)}[${RATE_WINDOW[range]}]))`;
}
