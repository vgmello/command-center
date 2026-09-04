import type {
	ActivitySummary,
	CurrentUser,
	Deployment,
	Domain,
	DomainChange,
	DomainOwner,
	EnvironmentOption,
	FavoriteItem,
	Incident,
	InfrastructureGroup,
	NavItem,
	TimeRangeOption
} from '$lib/platform/types';
import { healthChangeDirection, statusFromScore } from '$lib/platform/health';
import { buildSeries } from './series';

/**
 * The stand-in platform inventory.
 *
 * Everything here is a fixture, but it is shaped exactly like the real feed will
 * be: one row per domain with the observations already rolled up. When live
 * telemetry lands, this file is what gets replaced — the snapshot builder, the
 * remote functions, and the UI above it do not change.
 */

/** Seed row: the observed facts. Derived fields (status, series) are computed below. */
interface DomainSeed {
	name: string;
	icon: Domain['icon'];
	accent: Domain['accent'];
	criticality: Domain['criticality'];
	healthScore: number;
	serviceCount: number;
	errorRatePct: number;
	p95LatencyMs: number;
	activeIncidents: number;
	owner: string;
	availability7dPct: number;
	favorite?: boolean;
}

const DOMAIN_SEEDS: DomainSeed[] = [
	{
		name: 'Payment Domain',
		icon: 'landmark',
		accent: 'blue',
		criticality: 'mission-critical',
		healthScore: 74,
		serviceCount: 24,
		errorRatePct: 2.48,
		p95LatencyMs: 820,
		activeIncidents: 2,
		owner: '@payments-team',
		availability7dPct: 99.95,
		favorite: true
	},
	{
		name: 'Order Domain',
		icon: 'shopping-cart',
		accent: 'green',
		criticality: 'business-critical',
		healthScore: 86,
		serviceCount: 28,
		errorRatePct: 0.32,
		p95LatencyMs: 210,
		activeIncidents: 0,
		owner: '@order-team',
		availability7dPct: 99.93,
		favorite: true
	},
	{
		name: 'User Domain',
		icon: 'users',
		accent: 'slate',
		criticality: 'business-critical',
		healthScore: 92,
		serviceCount: 22,
		errorRatePct: 0.18,
		p95LatencyMs: 180,
		activeIncidents: 0,
		owner: '@user-team',
		availability7dPct: 99.91,
		favorite: true
	},
	{
		name: 'Inventory Domain',
		icon: 'package',
		accent: 'red',
		criticality: 'business-critical',
		healthScore: 68,
		serviceCount: 18,
		errorRatePct: 1.82,
		p95LatencyMs: 540,
		activeIncidents: 1,
		owner: '@inventory-team',
		availability7dPct: 98.21
	},
	{
		name: 'Notification Domain',
		icon: 'bell',
		accent: 'slate',
		criticality: 'important',
		healthScore: 45,
		serviceCount: 16,
		errorRatePct: 8.62,
		p95LatencyMs: 1820,
		activeIncidents: 1,
		owner: '@notify-team',
		availability7dPct: 98.76
	},
	{
		name: 'Shared Domain',
		icon: 'share-2',
		accent: 'green',
		criticality: 'important',
		healthScore: 90,
		serviceCount: 34,
		errorRatePct: 0.28,
		p95LatencyMs: 160,
		activeIncidents: 0,
		owner: '@platform-team',
		availability7dPct: 99.98
	},
	{
		name: 'Pricing Domain',
		icon: 'tag',
		accent: 'slate',
		criticality: 'important',
		healthScore: 78,
		serviceCount: 12,
		errorRatePct: 0.45,
		p95LatencyMs: 230,
		activeIncidents: 0,
		owner: '@pricing-team',
		availability7dPct: 99.72
	},
	{
		name: 'Analytics Domain',
		icon: 'chart-column',
		accent: 'amber',
		criticality: 'important',
		healthScore: 63,
		serviceCount: 20,
		errorRatePct: 1.25,
		p95LatencyMs: 620,
		activeIncidents: 1,
		owner: '@data-team',
		availability7dPct: 99.64
	},
	{
		name: 'Shipping Domain',
		icon: 'truck',
		accent: 'blue',
		criticality: 'standard',
		healthScore: 88,
		serviceCount: 19,
		errorRatePct: 0.34,
		p95LatencyMs: 240,
		activeIncidents: 0,
		owner: '@logistics-team',
		availability7dPct: 99.41
	},
	{
		name: 'Catalog Domain',
		icon: 'library',
		accent: 'violet',
		criticality: 'standard',
		healthScore: 91,
		serviceCount: 26,
		errorRatePct: 0.21,
		p95LatencyMs: 190,
		activeIncidents: 0,
		owner: '@catalog-team',
		availability7dPct: 99.87
	},
	{
		name: 'Search Domain',
		icon: 'search',
		accent: 'red',
		criticality: 'standard',
		healthScore: 38,
		serviceCount: 14,
		errorRatePct: 11.4,
		p95LatencyMs: 2450,
		activeIncidents: 1,
		owner: '@search-team',
		availability7dPct: 98.02
	},
	{
		name: 'Identity Domain',
		icon: 'shield',
		accent: 'green',
		criticality: 'standard',
		healthScore: 94,
		serviceCount: 17,
		errorRatePct: 0.12,
		p95LatencyMs: 140,
		activeIncidents: 0,
		owner: '@user-team',
		availability7dPct: 99.96
	},
	{
		name: 'Billing Domain',
		icon: 'receipt',
		accent: 'blue',
		criticality: 'standard',
		healthScore: 83,
		serviceCount: 21,
		errorRatePct: 0.62,
		p95LatencyMs: 310,
		activeIncidents: 0,
		owner: '@payments-team',
		availability7dPct: 98.44
	},
	{
		name: 'Fraud Domain',
		icon: 'shield-alert',
		accent: 'amber',
		criticality: 'standard',
		healthScore: 66,
		serviceCount: 11,
		errorRatePct: 1.94,
		p95LatencyMs: 680,
		activeIncidents: 0,
		owner: '@fraud-team',
		availability7dPct: 94.38
	},
	{
		name: 'Reporting Domain',
		icon: 'file-chart-column',
		accent: 'slate',
		criticality: 'standard',
		healthScore: 87,
		serviceCount: 9,
		errorRatePct: 0.4,
		p95LatencyMs: 260,
		activeIncidents: 0,
		owner: '@data-team',
		availability7dPct: 98.63
	},
	{
		name: 'Loyalty Domain',
		icon: 'gift',
		accent: 'red',
		criticality: 'standard',
		healthScore: 41,
		serviceCount: 8,
		errorRatePct: 9.75,
		p95LatencyMs: 1960,
		activeIncidents: 1,
		owner: '@growth-team',
		availability7dPct: 99.55
	},
	{
		name: 'Returns Domain',
		icon: 'undo-2',
		accent: 'green',
		criticality: 'standard',
		healthScore: 89,
		serviceCount: 10,
		errorRatePct: 0.29,
		p95LatencyMs: 220,
		activeIncidents: 0,
		owner: '@logistics-team',
		availability7dPct: 99.12
	},
	{
		name: 'Warehouse Domain',
		icon: 'warehouse',
		accent: 'violet',
		criticality: 'standard',
		healthScore: 82,
		serviceCount: 23,
		errorRatePct: 0.71,
		p95LatencyMs: 330,
		activeIncidents: 0,
		owner: '@logistics-team',
		availability7dPct: 99.33
	},
	{
		name: 'Tax Domain',
		icon: 'percent',
		accent: 'slate',
		criticality: 'standard',
		healthScore: 93,
		serviceCount: 7,
		errorRatePct: 0.15,
		p95LatencyMs: 170,
		activeIncidents: 0,
		owner: '@finance-team',
		availability7dPct: 99.81
	},
	{
		name: 'Subscription Domain',
		icon: 'repeat',
		accent: 'blue',
		criticality: 'standard',
		healthScore: 85,
		serviceCount: 15,
		errorRatePct: 0.38,
		p95LatencyMs: 250,
		activeIncidents: 0,
		owner: '@growth-team',
		availability7dPct: 99.28
	},
	{
		name: 'Content Domain',
		icon: 'file-text',
		accent: 'violet',
		criticality: 'standard',
		healthScore: 90,
		serviceCount: 13,
		errorRatePct: 0.24,
		p95LatencyMs: 200,
		activeIncidents: 0,
		owner: '@catalog-team',
		availability7dPct: 99.74
	},
	{
		name: 'Partner Domain',
		icon: 'handshake',
		accent: 'amber',
		criticality: 'standard',
		healthScore: 79,
		serviceCount: 12,
		errorRatePct: 0.58,
		p95LatencyMs: 290,
		activeIncidents: 0,
		owner: '@partner-team',
		availability7dPct: 98.9
	},
	{
		name: 'Messaging Domain',
		icon: 'message-square',
		accent: 'green',
		criticality: 'standard',
		healthScore: 84,
		serviceCount: 18,
		errorRatePct: 0.44,
		p95LatencyMs: 270,
		activeIncidents: 0,
		owner: '@notify-team',
		availability7dPct: 99.07
	},
	{
		name: 'Audit Domain',
		icon: 'clipboard-check',
		accent: 'slate',
		criticality: 'standard',
		healthScore: 95,
		serviceCount: 6,
		errorRatePct: 0.09,
		p95LatencyMs: 130,
		activeIncidents: 0,
		owner: '@platform-team',
		availability7dPct: 99.89
	},
	{
		name: 'Recommendation Domain',
		icon: 'sparkles',
		accent: 'violet',
		criticality: 'standard',
		healthScore: 81,
		serviceCount: 16,
		errorRatePct: 0.66,
		p95LatencyMs: 350,
		activeIncidents: 0,
		owner: '@data-team',
		availability7dPct: 98.55
	}
];

/**
 * Drop the category suffix these fixtures all carry.
 *
 * A fixture's habit, not a rule: a real source reads the short name from wherever the
 * org records it, which is why the field exists on the domain rather than as a helper
 * the UI calls.
 */
function shorten(name: string): string {
	return name.replace(/\s+Domain$/, '');
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * Materialise the seeds into full domains.
 *
 * `status` is derived from `healthScore` rather than stored, so the badge in the
 * table can never contradict the number printed beside it.
 */
export function listDomains(): Domain[] {
	return DOMAIN_SEEDS.map((seed) => {
		const slug = slugify(seed.name);
		const status = statusFromScore(seed.healthScore);

		return {
			id: slug,
			slug,
			name: seed.name,
			shortName: shorten(seed.name),
			icon: seed.icon,
			accent: seed.accent,
			criticality: seed.criticality,
			healthScore: seed.healthScore,
			status,
			serviceCount: seed.serviceCount,
			errorRatePct: seed.errorRatePct,
			p95LatencyMs: seed.p95LatencyMs,
			activeIncidents: seed.activeIncidents,
			owner: seed.owner,
			availability7dPct: seed.availability7dPct,
			errorTrend: buildSeries(`${slug}:errors`, seed.errorRatePct, {
				volatility: 0.35,
				// A domain in trouble is trending the wrong way; a healthy one is drifting down.
				drift: status === 'healthy' ? -0.25 : 0.45
			}),
			healthTrend: buildSeries(`${slug}:health`, seed.healthScore, {
				volatility: 0.05,
				drift: status === 'down' ? -0.2 : 0.04,
				floor: 1
			}),
			favorite: seed.favorite ?? false
		};
	});
}

/** Minutes ago → ISO timestamp, so fixtures read as relative ages. */
function minutesAgo(now: Date, minutes: number): string {
	return new Date(now.getTime() - minutes * 60_000).toISOString();
}

export function listIncidents(now: Date): Incident[] {
	const seeds: Array<[string, string, string, Incident['severity'], Incident['state'], number]> = [
		['inc-4821', 'High error rate in payment-gateway', 'Payment Domain', 'critical', 'open', 2],
		[
			'inc-4820',
			'Elevated latency in payment-reconciliation',
			'Payment Domain',
			'warning',
			'acknowledged',
			12
		],
		[
			'inc-4819',
			'Queue depth high in email-notification',
			'Notification Domain',
			'warning',
			'open',
			18
		],
		[
			'inc-4818',
			'Increased timeouts calling external PSP',
			'Payment Domain',
			'info',
			'acknowledged',
			28
		],
		['inc-4817', 'Inventory sync lag detected', 'Inventory Domain', 'info', 'mitigated', 35]
	];

	return seeds.map(([id, title, domainName, severity, state, minutes]) => ({
		id,
		title,
		domainId: slugify(domainName),
		domainName,
		severity,
		state,
		openedAt: minutesAgo(now, minutes)
	}));
}

export function listDeployments(now: Date): Deployment[] {
	const seeds: Array<[string, string, string, string, Deployment['status'], number]> = [
		['payment-api', 'v2.4.1', 'Payment Domain', 'landmark', 'success', 2],
		['order-service', 'v1.8.3', 'Order Domain', 'shopping-cart', 'success', 15],
		['user-profile', 'v1.9.0', 'User Domain', 'users', 'success', 22],
		['notification-worker', 'v1.2.7', 'Notification Domain', 'bell', 'failed', 60],
		['inventory-service', 'v1.6.3', 'Inventory Domain', 'package', 'success', 37]
	];

	return seeds.map(([service, version, domainName, icon, status, minutes]) => ({
		id: `${service}@${version}`,
		service,
		version,
		domainId: slugify(domainName),
		domainName,
		icon,
		status,
		deployedAt: minutesAgo(now, minutes)
	}));
}

/**
 * The owner filter's options, grouped out of the domain list.
 *
 * A real adapter answers this with `GROUP BY owner`; doing it here keeps the shape
 * of that answer — id, label, count — rather than making the caller group rows.
 */
export function listOwners(): DomainOwner[] {
	const counts = new Map<string, number>();
	for (const domain of listDomains()) {
		counts.set(domain.owner, (counts.get(domain.owner) ?? 0) + 1);
	}

	return [...counts.entries()]
		.map(([owner, domainCount]) => ({ id: owner, label: owner, domainCount }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Domains whose health score moved, newest first.
 *
 * The deltas are seeded rather than computed from the current scores, because a
 * change is a fact about two points in time and this fixture only holds one. When a
 * real source lands it reads both from history; the shape does not move.
 */
export function listRecentChanges(now: Date): DomainChange[] {
	const seeds: Array<[string, number, number]> = [
		['Catalog Domain', 72, 2],
		['Billing Domain', 58, 8],
		['Shipping Domain', 69, 15],
		['Analytics Domain', 81, 22],
		['Reporting Domain', 55, 28]
	];

	const byId = new Map(listDomains().map((domain) => [domain.id, domain]));

	return seeds.flatMap(([name, previousScore, minutes]) => {
		const domain = byId.get(slugify(name));
		if (!domain) return [];

		return [
			{
				id: `${domain.id}@${minutes}`,
				domainId: domain.id,
				name: domain.name,
				icon: domain.icon,
				accent: domain.accent,
				healthScore: domain.healthScore,
				previousScore,
				direction: healthChangeDirection(previousScore, domain.healthScore),
				changedAt: minutesAgo(now, minutes)
			}
		];
	});
}

/**
 * Incident and deployment counts for the day.
 *
 * The incident numbers are counted off the domain list so the "Active Incidents"
 * tile cannot disagree with the per-domain column beside it. Deployments have no
 * per-domain field to count, so they are seeded.
 */
export function listActivitySummary(): ActivitySummary {
	const domains = listDomains();
	const withIncidents = domains.filter((domain) => domain.activeIncidents > 0);

	return {
		activeIncidents: withIncidents.reduce((sum, domain) => sum + domain.activeIncidents, 0),
		incidentDomains: withIncidents.length,
		deploymentsToday: 29,
		deploymentDomains: 6
	};
}

export function listInfrastructure(): InfrastructureGroup[] {
	return [
		{
			id: 'clusters',
			label: 'Clusters',
			icon: 'boxes',
			count: 6,
			status: 'healthy',
			statusLabel: 'Healthy'
		},
		{
			id: 'nodes',
			label: 'Nodes',
			icon: 'server',
			count: 48,
			status: 'healthy',
			statusLabel: 'Healthy'
		},
		{
			id: 'databases',
			label: 'Databases',
			icon: 'database',
			count: 12,
			status: 'healthy',
			statusLabel: 'Healthy'
		},
		{
			id: 'queues',
			label: 'Queues',
			icon: 'layers',
			count: 18,
			status: 'healthy',
			statusLabel: 'Healthy'
		}
	];
}

export const ENVIRONMENTS: EnvironmentOption[] = [
	{ id: 'production', label: 'Production' },
	{ id: 'staging', label: 'Staging' },
	{ id: 'development', label: 'Development' }
];

export const TIME_RANGES: TimeRangeOption[] = [
	{ id: '5m', label: 'Last 5 minutes', seconds: 300 },
	{ id: '15m', label: 'Last 15 minutes', seconds: 900 },
	{ id: '1h', label: 'Last hour', seconds: 3600 },
	{ id: '6h', label: 'Last 6 hours', seconds: 21600 },
	{ id: '24h', label: 'Last 24 hours', seconds: 86400 },
	{ id: '7d', label: 'Last 7 days', seconds: 604800 }
];

export const NAV_ITEMS: NavItem[] = [
	{ id: 'overview', label: 'Overview', href: '/', icon: 'gauge' },
	{ id: 'domains', label: 'Domains', href: '/domains', icon: 'network' },
	{ id: 'services', label: 'Services', href: '/services', icon: 'boxes' },
	{ id: 'deployments', label: 'Deployments', href: '/deployments', icon: 'rocket' },
	{ id: 'infrastructure', label: 'Infrastructure', href: '/infrastructure', icon: 'server' },
	{ id: 'alerts', label: 'Alerts', href: '/alerts', icon: 'triangle-alert', badge: 3 },
	{ id: 'logs', label: 'Logs', href: '/logs', icon: 'scroll-text' },
	{ id: 'traces', label: 'Traces', href: '/traces', icon: 'git-branch' },
	{ id: 'reports', label: 'Reports', href: '/reports', icon: 'file-chart-column' },
	{ id: 'settings', label: 'Settings', href: '/settings', icon: 'settings' }
];

/** Favourites are pinned by the user; the dot reflects the pin, not the health. */
export function listFavorites(): FavoriteItem[] {
	return listDomains()
		.filter((domain) => domain.favorite)
		.map((domain, index) => ({
			id: domain.id,
			label: domain.name,
			href: `/domains?domain=${domain.slug}`,
			status: domain.status,
			pinned: index === 0
		}));
}

export const CURRENT_USER: CurrentUser = {
	name: 'Alex Morgan',
	role: 'Platform Admin',
	initials: 'AM',
	unreadNotifications: 3
};
