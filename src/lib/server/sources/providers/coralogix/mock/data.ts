import { hashSeed, seededRandom } from '../../../../platform/series';

/**
 * Seeded, Coralogix-shaped stand-in telemetry.
 *
 * The mock holds *series*, not answers: a set of labelled time series that PromQL
 * expressions are then evaluated against. Returning canned responses per query string
 * would test the adapter against a lookup table and prove nothing about whether its
 * PromQL means what it thinks — the shape of the data is the point.
 *
 * Deterministic, so a chart drawn twice is the same chart.
 */

export interface MockSeries {
	labels: Record<string, string>;
	/** One sample per `stepSeconds`, oldest first. */
	values: number[];
}

export interface CoralogixEstate {
	/** Wall-clock of the newest sample. */
	now: Date;
	stepSeconds: number;
	/** How many samples each series holds. */
	points: number;
	series: MockSeries[];
	events: MockEvent[];
}

export interface MockEvent {
	timestamp: string;
	environment: string;
	severity: 'critical' | 'warning' | 'info';
	service: string;
	domain: string;
	title: string;
	state: 'firing' | 'acknowledged' | 'resolved';
}

const SERVICES: ReadonlyArray<readonly [string, string, string]> = [
	['payment-api', 'payments', 'Payments'],
	['payment-gateway', 'payments', 'Payments'],
	['ledger-worker', 'payments', 'Payments'],
	['auth-service', 'identity', 'Identity'],
	['token-broker', 'identity', 'Identity'],
	['order-service', 'fulfilment', 'Fulfilment'],
	['dispatch-worker', 'fulfilment', 'Fulfilment'],
	['catalogue-api', 'catalogue', 'Catalogue']
];

/**
 * Routes, each with how slow it is relative to the others.
 *
 * The factor bends the latency distribution rather than scaling the traffic. A quantile
 * is scale-invariant, so routes sharing one distribution shape report an identical p95
 * however much traffic each carries — which made every row of the endpoint table read
 * 643ms and every latency share 100%.
 *
 * Below 1 is faster (more mass in the low buckets); above 1 is slower.
 */
const ROUTES: ReadonlyArray<readonly [string, number]> = [
	['/v1/charge', 1.9],
	['/v1/refund', 1.35],
	['/v1/status', 0.7],
	['/health', 0.35]
];
const ENVIRONMENTS = ['production', 'staging', 'development'];

/** OTel histogram buckets, in seconds, as a real exporter emits them. */
const LE_BUCKETS = ['0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '+Inf'];

/**
 * The share of requests at or below each bucket bound.
 *
 * Front-loaded, the way a healthy service's latency actually is: most requests finish
 * inside 250ms and a thin tail runs long. This is what puts a p95 between 500ms and 1s
 * rather than pinned to the top bucket.
 */
const CDF = [0.42, 0.63, 0.86, 0.94, 0.975, 0.993, 0.998, 1];

function walk(random: () => number, start: number, points: number, drift: number): number[] {
	const values: number[] = [];
	let current = start;

	for (let index = 0; index < points; index++) {
		current = Math.max(0, current + (random() - 0.5) * drift);
		values.push(current);
	}

	return values;
}

/**
 * Build an estate of series.
 *
 * `now` is a parameter rather than a call to `new Date()`, so a test can assert against a
 * fixed window instead of racing the clock.
 */
export function buildEstate(
	options: { now: Date; points?: number; stepSeconds?: number } = { now: new Date() }
): CoralogixEstate {
	const { now, points = 360, stepSeconds = 60 } = options;
	const random = seededRandom(hashSeed('coralogix-mock'));
	const series: MockSeries[] = [];

	for (const [service, domain, domainName] of SERVICES) {
		for (const environment of ENVIRONMENTS) {
			// Production carries the traffic; the lower environments are quieter, which is
			// what makes an environment filter visibly do something.
			const scale = environment === 'production' ? 1 : environment === 'staging' ? 0.2 : 0.05;
			const instances = environment === 'production' ? 3 : 1;

			for (const [route, slowness] of ROUTES) {
				const base = (8 + random() * 40) * scale;
				const ok = walk(random, base, points, base * 0.3);

				series.push({
					labels: {
						__name__: 'http_server_request_duration_count',
						service,
						environment,
						domain,
						domain_name: domainName,
						http_route: route,
						http_response_status_code: '200'
					},
					values: ok
				});

				// A trickle of 5xx on the write paths only, so an error rate is neither
				// uniformly zero nor implausibly high.
				//
				// Derived from the success series rather than walked on its own. An
				// independent walk over a long window wanders: seeded at 1% of traffic it
				// drifted to nearly 4%, which pegged the error budget at zero and made
				// every SLO figure on the page a consequence of the mock's arithmetic
				// rather than of anything a reader could reason about.
				if (route === '/v1/charge' || route === '/v1/refund') {
					const share = 0.002 + random() * 0.004;

					series.push({
						labels: {
							__name__: 'http_server_request_duration_count',
							service,
							environment,
							domain,
							domain_name: domainName,
							http_route: route,
							http_response_status_code: '500'
						},
						values: ok.map((value, index) => value * share * (0.6 + ((index * 37) % 100) / 125))
					});
				}

				// The histogram the p95 is read from. Cumulative, as Prometheus requires:
				// each bucket counts everything at or below its bound.
				//
				// The shape matters as much as the shape of the data structure. A real
				// latency distribution puts most of its mass in the low buckets and a thin
				// tail above — seeding it as a straight line would push the 95th percentile
				// into the top bucket, and every p95 the app printed would be the same
				// number.
				//
				// Emitted per instance as well as per route, because that is how an OTel
				// collector reports it — one histogram per process. Without the instance
				// label, `sum by (le, instance)` collapses to a single series and the
				// per-instance latency heatmap has exactly one row.
				for (let replica = 0; replica < instances; replica++) {
					// One walk for the replica's total, and every bucket derived from it.
					//
					// Walking each bucket independently would let bucket 4 drift below
					// bucket 3 at some timestamp, and a cumulative histogram that is not
					// monotonic makes quantile interpolation meaningless — it read as a
					// four-second p95 against data whose 95th percentile is under a second.
					const totals = walk(random, base / instances, points, base / instances / 3);

					for (let bucket = 0; bucket < LE_BUCKETS.length; bucket++) {
						series.push({
							labels: {
								__name__: 'http_server_request_duration_bucket',
								service,
								environment,
								domain,
								domain_name: domainName,
								http_route: route,
								instance: `${service}-${replica}`,
								le: LE_BUCKETS[bucket]
							},
							// The exponent bends the curve: a slower route holds less of its mass
							// in the low buckets, which pushes its 95th percentile up.
							values: totals.map((total) => total * CDF[bucket] ** slowness)
						});
					}
				}
			}

			for (let index = 0; index < instances; index++) {
				const instance = `${service}-${index}`;

				series.push({
					labels: { __name__: 'up', service, environment, domain, instance },
					// One production instance of the gateway is down, so a degraded rollup
					// has something real behind it.
					values: Array.from({ length: points }, () =>
						service === 'payment-gateway' && environment === 'production' && index === 2 ? 0 : 1
					)
				});

				series.push({
					labels: { __name__: 'process_cpu_utilization', service, environment, domain, instance },
					values: walk(random, 0.25 + random() * 0.3, points, 0.05)
				});

				series.push({
					labels: {
						__name__: 'process_memory_utilization',
						service,
						environment,
						domain,
						instance
					},
					values: walk(random, 0.4 + random() * 0.3, points, 0.03)
				});
			}
		}
	}

	const events: MockEvent[] = [
		{
			timestamp: new Date(now.getTime() - 4 * 60_000).toISOString(),
			severity: 'critical',
			environment: 'production',
			service: 'payment-gateway',
			domain: 'Payments',
			title: 'Elevated 5xx on /v1/charge',
			state: 'firing'
		},
		{
			timestamp: new Date(now.getTime() - 26 * 60_000).toISOString(),
			severity: 'warning',
			environment: 'production',
			service: 'token-broker',
			domain: 'Identity',
			title: 'P95 latency above 1s',
			state: 'acknowledged'
		},
		{
			timestamp: new Date(now.getTime() - 95 * 60_000).toISOString(),
			severity: 'warning',
			environment: 'production',
			service: 'dispatch-worker',
			domain: 'Fulfilment',
			title: 'Queue depth growing',
			state: 'firing'
		},
		{
			timestamp: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
			severity: 'info',
			environment: 'production',
			service: 'catalogue-api',
			domain: 'Catalogue',
			title: 'Search index rebuilt',
			state: 'resolved'
		}
	];

	return { now, stepSeconds, points, series, events };
}
