import type {
	DependencyNode,
	FavoriteItem,
	HealthCheck,
	Series,
	Service,
	ServiceDependencies,
	ServiceEndpoint,
	ServiceStat,
	TimeSeries
} from '$lib/platform/types';
import { describeInstanceHealth } from '$lib/platform/services';
import { formatChange, formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
import { statusFromScore } from '$lib/platform/health';
import { buildSeries } from './series';
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
	const values = buildSeries(`${slug}:rps`, centre, { volatility: 0.16, floor: 0 }).values.slice(
		0,
		buckets
	);

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

	return shapes.slice(0, limit).map(([method, path, factor]) => {
		const p95LatencyMs = Math.round(slowest * factor);
		return {
			id: `${method} ${path}`,
			method,
			path,
			p95LatencyMs,
			sharePct: Math.round(factor * 100),
			status: statusFromScore(100 - factor * 70)
		};
	});
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
