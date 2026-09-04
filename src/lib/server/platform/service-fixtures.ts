import type {
	DependencyNode,
	DomainVitals,
	FavoriteItem,
	LatencyHeatmap,
	MetricInsight,
	SloBudget,
	HealthCheck,
	Series,
	Service,
	ServiceDependencies,
	ServiceEndpoint,
	ServiceStat,
	ServiceVitals,
	TimeSeries
} from '$lib/platform/types';
import { describeInstanceHealth } from '$lib/platform/services';
import { formatChange, formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
import { statusFromScore } from '$lib/platform/health';
import { bandFor } from '$lib/platform/chart';
import { buildSeries, hashSeed, seededRandom } from './series';
import { listDomains } from './fixtures';

/**
 * The stand-in service catalog and its telemetry.
 *
 * Its own file rather than more of `fixtures.ts`: that file is the platform's inventory
 * and this is a different upstream, mirroring the split between `PlatformSource` and
 * `ServiceSource`. When a real registry lands, this is what gets deleted.
 *
 * Everything is seeded from the slug, so a service's numbers are stable across
 * refreshes — a sparkline that redraws differently every time reports change that did
 * not happen.
 */

interface ServiceSeed {
	name: string;
	domainName: string;
	description: string;
	serviceType: string;
	language: string;
	runtime: string;
	healthScore: number;
	instancesHealthy: number;
	instancesTotal: number;
	activeAlerts: number;
	requestRate: number;
	errorRatePct: number;
	p95LatencyMs: number;
	availabilityPct: number;
}

const SERVICE_SEEDS: ServiceSeed[] = [
	{
		name: 'payment-api',
		domainName: 'Payment Domain',
		description: 'API Gateway service for payment processing',
		serviceType: 'API Gateway',
		language: '.NET 8',
		runtime: 'Container',
		healthScore: 92,
		instancesHealthy: 3,
		instancesTotal: 3,
		activeAlerts: 1,
		requestRate: 450,
		errorRatePct: 0.42,
		p95LatencyMs: 820,
		availabilityPct: 99.95
	},
	{
		name: 'payment-gateway',
		domainName: 'Payment Domain',
		description: 'Outbound integration with external payment providers',
		serviceType: 'Integration',
		language: 'Go 1.22',
		runtime: 'Container',
		healthScore: 68,
		instancesHealthy: 2,
		instancesTotal: 3,
		activeAlerts: 2,
		requestRate: 180,
		errorRatePct: 2.4,
		p95LatencyMs: 1240,
		availabilityPct: 99.12
	},
	{
		name: 'order-service',
		domainName: 'Order Domain',
		description: 'Order lifecycle and fulfilment orchestration',
		serviceType: 'Domain Service',
		language: '.NET 8',
		runtime: 'Container',
		healthScore: 88,
		instancesHealthy: 4,
		instancesTotal: 4,
		activeAlerts: 0,
		requestRate: 620,
		errorRatePct: 0.32,
		p95LatencyMs: 210,
		availabilityPct: 99.93
	},
	{
		name: 'user-profile',
		domainName: 'User Domain',
		description: 'Profile, preferences and identity attributes',
		serviceType: 'Domain Service',
		language: 'TypeScript',
		runtime: 'Container',
		healthScore: 94,
		instancesHealthy: 2,
		instancesTotal: 2,
		activeAlerts: 0,
		requestRate: 310,
		errorRatePct: 0.18,
		p95LatencyMs: 180,
		availabilityPct: 99.97
	},
	{
		name: 'inventory-service',
		domainName: 'Inventory Domain',
		description: 'Stock levels, reservations and warehouse sync',
		serviceType: 'Domain Service',
		language: 'Java 21',
		runtime: 'Container',
		healthScore: 66,
		instancesHealthy: 3,
		instancesTotal: 4,
		activeAlerts: 2,
		requestRate: 240,
		errorRatePct: 1.82,
		p95LatencyMs: 540,
		availabilityPct: 98.21
	},
	{
		name: 'notification-worker',
		domainName: 'Notification Domain',
		description: 'Email, SMS and push delivery queue consumer',
		serviceType: 'Worker',
		language: 'Python 3.12',
		runtime: 'Container',
		healthScore: 42,
		instancesHealthy: 1,
		instancesTotal: 3,
		activeAlerts: 3,
		requestRate: 90,
		errorRatePct: 8.62,
		p95LatencyMs: 1820,
		availabilityPct: 97.4
	}
];

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * Materialise the seeds.
 *
 * `status` is derived from `healthScore` with the same function the domain table uses,
 * so a service badge and a domain badge cannot mean different things by "degraded".
 * Icon and accent are inherited from the owning domain: a service belongs to a domain,
 * and giving it a colour of its own would break that at a glance.
 */
export function listServices(): Service[] {
	const domains = new Map(listDomains().map((domain) => [domain.id, domain]));

	return SERVICE_SEEDS.map((seed) => {
		const slug = slugify(seed.name);
		const domainId = slugify(seed.domainName);
		const domain = domains.get(domainId);

		return {
			id: slug,
			slug,
			name: seed.name,
			description: seed.description,
			icon: 'code',
			accent: domain?.accent ?? 'slate',
			status: statusFromScore(seed.healthScore),
			domainId,
			domainName: seed.domainName,
			owner: domain?.owner ?? '@platform-team',
			serviceType: seed.serviceType,
			language: seed.language,
			runtime: seed.runtime,
			repository: {
				label: `company/${seed.name}`,
				href: `https://github.com/company/${seed.name}`
			},
			chatChannel: {
				label: `#svc-${seed.name}`,
				href: `https://chat.example.com/svc-${seed.name}`
			},
			runbook: { label: 'View runbook', href: `https://runbooks.example.com/${slug}` },
			dashboard: {
				label: 'View in Grafana',
				href: `https://grafana.example.com/d/${slug}`
			},
			instancesHealthy: seed.instancesHealthy,
			instancesTotal: seed.instancesTotal,
			activeAlerts: seed.activeAlerts
		};
	});
}

/**
 * Suffixes a generated service is named with, in the order they are used.
 *
 * A domain's first services are the ones written by hand in `SERVICE_SEEDS`; the rest
 * are generated to reach the count the domain states. Without that, a domain claiming
 * twenty-four services would list two — and the header tile and the table beneath it
 * would describe different platforms.
 */
const SERVICE_SUFFIXES = [
	'api',
	'worker',
	'gateway',
	'reconciliation',
	'notification',
	'processor',
	'sync',
	'scheduler',
	'validator',
	'projector',
	'archiver',
	'exporter',
	'importer',
	'auditor',
	'router',
	'cache',
	'indexer',
	'reporter',
	'webhook',
	'migrator',
	'cleaner',
	'sampler',
	'replayer',
	'reaper',
	'collector',
	'dispatcher',
	'resolver',
	'enricher',
	'throttler',
	'balancer',
	'watcher',
	'pruner',
	'sealer',
	'signer'
];

const SERVICE_KINDS = [
	'API Gateway',
	'Background Worker',
	'External Gateway',
	'Batch Job',
	'Event Processor',
	'Domain Service'
];

/**
 * One row per service in a domain.
 *
 * The list is exactly as long as the domain says it is, and the statuses are dealt out
 * to match the split the domain's vitals report — so the header tile, the bar under it
 * and this table are three renderings of one set of facts rather than three guesses.
 *
 * Readings for a hand-written service come from its own seed, so a service's error rate
 * is the same number here, on its page and on its metrics tab.
 */
export function listServiceVitals(domainId: string, vitals: DomainVitals, total: number) {
	const catalogued = listServices().filter((service) => service.domainId === domainId);
	const domainPrefix = domainId.replace(/-domain$/, '');

	const rows: ServiceVitals[] = [];
	const used = new Set(catalogued.map((service) => service.slug));

	for (let index = 0; rows.length < total; index++) {
		const fromCatalog = catalogued[index];
		if (fromCatalog) {
			const seed = SERVICE_SEEDS.find((one) => slugify(one.name) === fromCatalog.slug);
			rows.push({
				id: fromCatalog.id,
				slug: fromCatalog.slug,
				name: fromCatalog.name,
				kind: fromCatalog.serviceType,
				icon: fromCatalog.icon,
				accent: fromCatalog.accent,
				status: fromCatalog.status,
				requestsPerSecond: seed?.requestRate ?? 0,
				errorRatePct: seed?.errorRatePct ?? 0,
				p95LatencyMs: seed?.p95LatencyMs ?? 0,
				instancesHealthy: fromCatalog.instancesHealthy,
				instancesTotal: fromCatalog.instancesTotal,
				trend: buildSeries(`${fromCatalog.slug}:vitals`, seed?.requestRate ?? 100, {
					points: 20,
					volatility: 0.16
				})
			});
			continue;
		}

		const suffix = SERVICE_SUFFIXES[(index - catalogued.length) % SERVICE_SUFFIXES.length];
		const name = `${domainPrefix}-${suffix}`;
		if (used.has(name)) continue;
		used.add(name);

		const random = seededRandom(hashSeed(`${domainId}:${name}`));
		const requestRate = Math.round(60 + random() * 460);
		const instancesTotal = 1 + Math.floor(random() * 3);

		rows.push({
			id: name,
			slug: name,
			name,
			kind: SERVICE_KINDS[Math.floor(random() * SERVICE_KINDS.length)],
			icon: 'code',
			accent: catalogued[0]?.accent ?? 'slate',
			// Overwritten below; dealt out so the counts match what the domain states.
			status: 'healthy',
			requestsPerSecond: requestRate,
			errorRatePct: Math.round(random() * 90) / 100,
			p95LatencyMs: Math.round(90 + random() * 520),
			instancesHealthy: instancesTotal,
			instancesTotal,
			trend: buildSeries(`${name}:vitals`, requestRate, { points: 20, volatility: 0.16 })
		});
	}

	/*
	 * Deal the states out to match the domain's split exactly.
	 *
	 * Worst first, and skipping the hand-written services, whose status is a fact of
	 * their own catalog entry rather than this domain's arithmetic.
	 */
	const generated = rows.filter((row) => !catalogued.some((one) => one.slug === row.slug));
	const already = { healthy: 0, degraded: 0, down: 0 };
	for (const row of rows) {
		if (row.status === 'down') already.down++;
		else if (row.status === 'degraded') already.degraded++;
		else already.healthy++;
	}

	let cursor = 0;
	for (const state of ['down', 'degraded'] as const) {
		const wanted = Math.max(0, vitals.serviceCounts[state] - already[state]);
		for (let taken = 0; taken < wanted && cursor < generated.length; taken++, cursor++) {
			generated[cursor].status = state;
			generated[cursor].instancesHealthy = Math.max(
				state === 'down' ? 0 : 1,
				generated[cursor].instancesTotal - 1
			);
		}
	}

	return rows;
}

export function findService(slug: string): Service | null {
	return listServices().find((service) => service.slug === slug) ?? null;
}

function seedFor(slug: string): ServiceSeed | undefined {
	return SERVICE_SEEDS.find((seed) => slugify(seed.name) === slug);
}

/**
 * The header strip.
 *
 * Each tile is formatted here rather than in the component, because the unit differs
 * per tile and the pure layer is where "how a number reads" lives. What travels is the
 * reading plus the facts a UI needs to tint it — never a colour.
 */
export function readServiceStats(slug: string): ServiceStat[] {
	const seed = seedFor(slug);
	if (!seed) return [];

	const trend = (id: string, centre: number, options: Parameters<typeof buildSeries>[2]): Series =>
		buildSeries(`${slug}:${id}`, centre, options);

	return [
		{
			kind: 'gauge',
			id: 'availability',
			label: 'Availability (SLO)',
			formatted: formatPercent(seed.availabilityPct),
			unit: '',
			// The bar shows the SLO budget consumed, not the raw percentage: a bar that
			// sits at 99.95% of its width looks identical at 99.5% and at 100%.
			progressPct: Math.max(0, Math.min(100, (seed.availabilityPct - 99) * 100)),
			changeFormatted: formatChange(0.05, '%', 2),
			comparedToLabel: 'vs 15m ago',
			direction: 'up',
			polarity: 'higher-is-better',
			tone: null
		},
		{
			kind: 'trend',
			id: 'request-rate',
			label: 'Request Rate',
			formatted: formatCompact(seed.requestRate),
			unit: 'req/s',
			series: trend('requests', seed.requestRate, { volatility: 0.12, drift: 0.1 }),
			changeFormatted: formatChange(12, '%', 0),
			comparedToLabel: 'vs 15m ago',
			direction: 'up',
			polarity: 'neutral',
			tone: null
		},
		{
			kind: 'trend',
			id: 'error-rate',
			label: 'Error Rate (5m)',
			formatted: formatPercent(seed.errorRatePct),
			unit: '',
			series: trend('errors', seed.errorRatePct, { volatility: 0.28, drift: -0.15, floor: 0 }),
			changeFormatted: formatChange(-0.18, '%', 2),
			comparedToLabel: 'vs 15m ago',
			direction: 'down',
			polarity: 'lower-is-better',
			tone: seed.errorRatePct > 1 ? 'down' : null
		},
		{
			kind: 'trend',
			id: 'p95-latency',
			label: 'P95 Latency',
			formatted: formatLatency(seed.p95LatencyMs).value,
			unit: formatLatency(seed.p95LatencyMs).unit,
			series: trend('latency', seed.p95LatencyMs, { volatility: 0.1, drift: -0.12 }),
			changeFormatted: formatChange(-120, 'ms', 0),
			comparedToLabel: 'vs 15m ago',
			direction: 'down',
			polarity: 'lower-is-better',
			tone: null
		},
		{
			kind: 'ratio',
			id: 'instances',
			label: 'Active Instances',
			value: seed.instancesHealthy,
			total: seed.instancesTotal,
			caption: describeInstanceHealth(seed.instancesHealthy, seed.instancesTotal),
			tone: seed.instancesHealthy === seed.instancesTotal ? 'healthy' : 'degraded'
		},
		{
			kind: 'link',
			id: 'alerts',
			label: 'Active Alerts',
			formatted: String(seed.activeAlerts),
			// Only offered when there is something to look at, and only to a route that
			// exists. A "View alerts" link on zero alerts is a dead end with a number on it.
			action: seed.activeAlerts > 0 ? { label: 'View alerts', href: '/alerts' } : null,
			tone: seed.activeAlerts > 0 ? 'degraded' : 'healthy'
		}
	];
}

/**
 * The SLI table.
 *
 * Every row states its own formatted value because the units differ — a percentage, a
 * duration, a saturation share — and a table that formatted them itself would have to
 * know which row it was on.
 */
export function listHealthChecks(slug: string): HealthCheck[] {
	const seed = seedFor(slug);
	if (!seed) return [];

	const rows: Array<[string, string, string, number, string, number]> = [
		['http-errors', 'HTTP 5xx Error Rate', 'shield-alert', seed.errorRatePct, 'percent', 0.3],
		['http-latency', 'HTTP Latency (P95)', 'clock', seed.p95LatencyMs * 0.63, 'ms', 0.12],
		['dep-errors', 'Dependency Error Rate', 'share-2', seed.errorRatePct * 0.38, 'percent', 0.3],
		['dep-latency', 'Dependency Latency (P95)', 'clock', seed.p95LatencyMs * 0.26, 'ms', 0.15],
		['cpu', 'Saturation (CPU)', 'gauge', 42, 'percent-int', 0.1],
		['memory', 'Saturation (Memory)', 'gauge', 58, 'percent-int', 0.08]
	];

	return rows.map(([id, label, icon, value, unit, volatility]) => ({
		id,
		label,
		icon,
		// A check is healthy unless the service it measures is not: the rows describe
		// one service, and a green table on a red service would be a lie.
		status: seed.healthScore >= 75 ? 'healthy' : statusFromScore(seed.healthScore),
		formatted: formatCheckValue(value, unit),
		series: buildSeries(`${slug}:${id}`, value, { volatility, floor: 0 })
	}));
}

function formatCheckValue(value: number, unit: string): string {
	if (unit === 'percent') return formatPercent(value);
	if (unit === 'percent-int') return `${Math.round(value)}%`;
	const latency = formatLatency(value);
	return `${latency.value} ${latency.unit}`;
}

/** One hop each way, with the protocol each edge speaks. */
export function readDependencies(slug: string): ServiceDependencies {
	const service = findService(slug);
	if (!service) return { upstream: [], downstream: [] };

	const shapes: Record<string, ServiceDependencies> = {
		'payment-api': {
			upstream: [node('payment-web', 'HTTP', 'healthy'), node('mobile-app', 'HTTP', 'healthy')],
			downstream: [
				node('payment-db', 'PostgreSQL', 'healthy'),
				node('fraud-service', 'gRPC', 'healthy'),
				node('notification-svc', 'HTTP', 'degraded')
			]
		}
	};

	return (
		shapes[slug] ?? {
			upstream: [node('api-gateway', 'HTTP', 'healthy')],
			downstream: [
				node(`${slug}-db`, 'PostgreSQL', 'healthy'),
				node('shared-cache', 'Redis', service.status === 'down' ? 'degraded' : 'healthy')
			]
		}
	);
}

function node(name: string, protocol: string, status: DependencyNode['status']): DependencyNode {
	return { id: slugify(name), name, protocol, status };
}

/** Requests per second across the window, labelled with wall-clock buckets. */
export function readRequestRate(slug: string, now: Date, buckets = 18): TimeSeries {
	const seed = seedFor(slug);
	const centre = seed?.requestRate ?? 100;
	const values = buildSeries(`${slug}:rps`, centre, {
		points: buckets,
		volatility: 0.16,
		floor: 0
	}).values;

	return {
		id: 'request-rate',
		label: 'Request Rate',
		points: values.map((value, index) => {
			const at = new Date(now.getTime() - (buckets - 1 - index) * 5 * 60_000);
			return {
				label: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
				value: Math.round(value)
			};
		}),
		min: Math.min(...values),
		max: Math.max(...values)
	};
}

/**
 * Slowest endpoints first, with each bar's share worked out here.
 *
 * The share is against the slowest endpoint rather than against the total, because the
 * question the panel answers is "which one is worst", and shares of a sum make the
 * slowest look small as soon as there are ten of them.
 */
export function listEndpoints(slug: string, limit: number): ServiceEndpoint[] {
	const seed = seedFor(slug);
	if (!seed) return [];

	const shapes: Array<[string, string, number]> = [
		['POST', '/v1/payments', 1],
		['GET', '/v1/payments/{id}', 0.67],
		['POST', '/v1/refunds', 0.47],
		['GET', '/v1/customers/{id}', 0.34],
		['GET', '/v1/health', 0.05]
	];

	const slowest = seed.p95LatencyMs * 1.12;
	// Traffic is not proportional to latency: the health check is the fastest endpoint
	// and among the least called, which is exactly why the two shares are separate.
	const traffic = [0.267, 0.189, 0.133, 0.1, 0.04];
	const rows = shapes.slice(0, limit);
	const trafficTotal = traffic.slice(0, rows.length).reduce((sum, share) => sum + share, 0);

	return rows.map(([method, path, factor], index) => {
		const requestShare = traffic[index] / trafficTotal;

		return {
			id: `${method} ${path}`,
			method,
			path,
			p95LatencyMs: Math.round(slowest * factor),
			latencySharePct: Math.round(factor * 100),
			requestsPerSecond: Math.round(seed.requestRate * requestShare),
			requestSharePct: Math.round(traffic[index] * 1000) / 10,
			status: statusFromScore(100 - factor * 70)
		};
	});
}

/** Buckets across the window, labelled with wall-clock times. */
function clockPoints(now: Date, values: number[], stepMinutes = 1) {
	return values.map((value, index) => {
		const at = new Date(now.getTime() - (values.length - 1 - index) * stepMinutes * 60_000);
		return {
			label: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
			value: Math.round(value * 100) / 100
		};
	});
}

function series(id: string, label: string, points: ReturnType<typeof clockPoints>): TimeSeries {
	const values = points.map((point) => point.value);
	return { id, label, points, min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Every series the metrics tab plots, from one window.
 *
 * Built together rather than one call per chart, so two panels on the same screen
 * cannot describe different minutes — the failure a dashboard exists to avoid.
 */
export function readMetricSeries(slug: string, now: Date, buckets = 32) {
	const seed = seedFor(slug);
	const centre = seed ?? {
		requestRate: 100,
		p95LatencyMs: 200,
		errorRatePct: 0.5,
		instancesTotal: 1
	};

	const shape = (id: string, value: number, volatility: number, floor = 0) =>
		buildSeries(`${slug}:m:${id}`, value, { points: buckets, volatility, floor }).values;

	const endpoints = listEndpoints(slug, 5);
	const instances = Array.from(
		{ length: Math.max(1, centre.instancesTotal) },
		(_, index) => `${slug}-6c7f9d7c4b-1a2${'bcdefgh'[index] ?? index}`
	);

	/*
	 * The newest bucket is pinned to the service's stated reading.
	 *
	 * Without it the tile above a chart shows the last sample of a wandering series
	 * while the Overview tab shows the catalog's figure, and a reader switching tabs
	 * watches P95 change by a hundred milliseconds for no reason.
	 */
	const pinned = (id: string, label: string, values: number[], reading: number) => {
		const points = clockPoints(now, values);
		if (points.length > 0) points[points.length - 1].value = Math.round(reading * 100) / 100;
		return series(id, label, points);
	};

	return {
		requestRate: pinned(
			'request-rate',
			'Total',
			shape('rps', centre.requestRate, 0.14),
			centre.requestRate
		),
		p95Latency: pinned(
			'p95',
			'P95 Latency',
			shape('p95', centre.p95LatencyMs, 0.12),
			centre.p95LatencyMs
		),
		errorRate: pinned(
			'error-rate',
			'Error Rate',
			shape('errors', centre.errorRatePct, 0.26),
			centre.errorRatePct
		),
		saturation: [
			series('cpu', 'CPU', clockPoints(now, shape('cpu', 42, 0.08))),
			series('memory', 'Memory', clockPoints(now, shape('memory', 58, 0.06)))
		],
		// One band per endpoint, each a share of the same total the line chart plots.
		byEndpoint: endpoints.map((endpoint) =>
			series(
				endpoint.id,
				`${endpoint.path}`,
				clockPoints(
					now,
					shape(`ep:${endpoint.id}`, centre.requestRate * (endpoint.requestSharePct / 100), 0.18)
				)
			)
		),
		byInstance: instances.map((name, index) =>
			series(name, name, clockPoints(now, shape(`inst:${index}`, centre.p95LatencyMs, 0.16)))
		)
	};
}

/**
 * The availability objective.
 *
 * The budget is worked out from the objective rather than stated: an allowance is a
 * consequence of a target and a window, and stating it separately is how the two end
 * up disagreeing.
 */
export function readSloBudget(slug: string, now: Date): SloBudget {
	const seed = seedFor(slug);
	const achievedPct = seed?.availabilityPct ?? 99.9;
	const targetPct = 99.9;
	const windowDays = 30;

	const allowanceMinutes = ((100 - targetPct) / 100) * windowDays * 24 * 60;
	const spentMinutes = ((100 - achievedPct) / 100) * windowDays * 24 * 60;
	const remainingMinutes = Math.max(0, allowanceMinutes - spentMinutes);
	const remainingPct = allowanceMinutes === 0 ? 0 : (remainingMinutes / allowanceMinutes) * 100;

	const burn = buildSeries(`${slug}:burn`, 1.2, { points: 28, volatility: 0.5, floor: 0 }).values;

	return {
		label: `Availability (${windowDays}d rolling)`,
		achievedPct,
		targetPct,
		remainingPct,
		remainingLabel: formatMinutes(remainingMinutes),
		burnPct: Math.round((spentMinutes / allowanceMinutes) * 1000) / 10,
		burnWindowLabel: `of the ${windowDays}-day budget`,
		burn: {
			id: 'burn',
			label: 'Budget burn',
			// Dated, not indexed: the bars carry a tooltip, and "12" is not an answer to
			// "which day was that".
			points: burn.map((value, index) => ({
				label: new Date(now.getTime() - (burn.length - 1 - index) * 86_400_000).toLocaleDateString(
					'en-GB',
					{ month: 'short', day: 'numeric' }
				),
				value
			})),
			min: Math.min(...burn),
			max: Math.max(...burn)
		}
	};
}

/** "21h 36m" — an allowance stated as time somebody can spend. */
function formatMinutes(minutes: number): string {
	const whole = Math.floor(minutes);
	const hours = Math.floor(whole / 60);
	if (hours === 0) return `${whole}m`;
	return `${hours}h ${String(whole % 60).padStart(2, '0')}m`;
}

/** Upper bounds in milliseconds, worst first. The legend reads off these. */
const LATENCY_BANDS = [2000, 1000, 500, 200, 100];

const LATENCY_BAND_LABELS = [
	'> 2s',
	'1s – 2s',
	'500ms – 1s',
	'200ms – 500ms',
	'100ms – 200ms',
	'< 100ms'
];

/**
 * P95 bucketed by time and by percentile row.
 *
 * Rows are latency percentiles rather than instances: the question the heatmap answers
 * is "how wide is the tail", and one row per instance answers a different one — which
 * is what the chart beside it is for.
 */
export function readLatencyHeatmap(
	slug: string,
	now: Date,
	columns = 32,
	rows = 8
): LatencyHeatmap {
	const seed = seedFor(slug);
	const centre = seed?.p95LatencyMs ?? 200;

	const columnLabels = Array.from({ length: columns }, (_, index) => {
		const at = new Date(now.getTime() - (columns - 1 - index) * 60_000);
		return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
	});

	// Each row is a slice of the distribution: the top row is the slow tail.
	const rowLabels = Array.from({ length: rows }, (_, index) => `p${99 - index * 6}`);

	const cells = [];
	for (let row = 0; row < rows; row++) {
		/*
		 * Latency percentiles are not linear. A service whose P95 is 820ms has a P57
		 * around 100ms, not 300 — the tail is where the time goes. A straight line
		 * between the two paints every row amber and makes a healthy service look sick.
		 */
		const position = (rows - 1 - row) / Math.max(1, rows - 1);
		const rowCentre = centre * (0.12 + 1.9 * position ** 2.5);
		const values = buildSeries(`${slug}:heat:${row}`, rowCentre, {
			points: columns,
			volatility: 0.22,
			floor: 10
		}).values;

		for (let column = 0; column < columns; column++) {
			cells.push({
				column,
				row,
				band: bandFor(values[column], LATENCY_BANDS),
				columnLabel: columnLabels[column]
			});
		}
	}

	return { columnLabels, rowLabels, bands: LATENCY_BAND_LABELS, cells };
}

/**
 * Flagged movements.
 *
 * Each states the number that triggered it and the range it left, so an insight cannot
 * outlive the condition it describes — and a reader can judge it without opening it.
 */
export function listMetricInsights(slug: string, now: Date): MetricInsight[] {
	const seed = seedFor(slug);
	if (!seed) return [];

	const insights: MetricInsight[] = [];
	const NORMAL_ERROR_RANGE = { low: 0.05, high: 0.2 };

	if (seed.errorRatePct > NORMAL_ERROR_RANGE.high) {
		insights.push({
			id: 'error-rate',
			kind: 'anomaly',
			severity: 'critical',
			title: 'High Error Rate',
			detail: `Error rate is ${formatPercent(seed.errorRatePct)}, outside the normal range (${formatPercent(NORMAL_ERROR_RANGE.low)} – ${formatPercent(NORMAL_ERROR_RANGE.high)})`,
			affects: '/v1/payments',
			startedAt: new Date(now.getTime() - 5 * 60_000).toISOString()
		});
	}

	const usualLatency = Math.round(seed.p95LatencyMs / 1.35);
	insights.push({
		id: 'latency',
		kind: 'anomaly',
		severity: 'warning',
		title: 'Latency Increased',
		detail: `P95 latency is ${seed.p95LatencyMs}ms, 35% higher than usual (avg ${usualLatency}ms)`,
		affects: '/v1/payments',
		startedAt: new Date(now.getTime() - 8 * 60_000).toISOString()
	});

	insights.push({
		id: 'traffic',
		kind: 'insight',
		severity: 'info',
		title: 'Traffic Spike',
		detail: `Request rate increased by 12% to ${seed.requestRate} req/s`,
		affects: 'Normal',
		startedAt: new Date(now.getTime() - 10 * 60_000).toISOString()
	});

	return insights;
}

/**
 * Pinned services.
 *
 * Services rather than domains, now that a service has a page of its own: a pin is a
 * shortcut to somewhere, and `/domains?domain=…` was a filter, not a destination.
 */
export function listFavorites(): FavoriteItem[] {
	return listServices()
		.slice(0, 3)
		.map((service, index) => ({
			id: service.id,
			label: service.name,
			href: `/services/${service.slug}`,
			status: service.status,
			pinned: index === 0
		}));
}
