import type {
	ActivitySummary,
	CurrentUser,
	Deployment,
	DeploymentInsight,
	DeploymentSummary,
	DeploymentTrigger,
	Domain,
	DomainBreakdown,
	DomainChange,
	EnvironmentId,
	EnvironmentOption,
	FacetOption,
	Incident,
	InfrastructureGroup,
	NavItem,
	TimeRangeOption,
	TimeSeries,
	TrendGrain
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
		accent: 'violet',
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
		accent: 'amber',
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
		accent: 'slate',
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

/**
 * The day's deployment log.
 *
 * Twenty-nine runs so the page's paging, tabs and per-domain donut all have something
 * real to divide up — a five-row fixture makes every one of those look correct by
 * accident. Each seed is `[service, version, domain, environment, status, trigger,
 * minutes ago, duration seconds]`; `null` duration means it is still running.
 */
type DeploymentSeed = [
	string,
	string,
	string,
	EnvironmentId,
	Deployment['status'],
	DeploymentTrigger,
	number,
	number | null
];

const DEPLOYMENT_SEEDS: DeploymentSeed[] = [
	['payment-api', 'v2.4.2', 'Payment Domain', 'production', 'success', 'ci-cd', 2, 204],
	['order-service', 'v1.8.4', 'Order Domain', 'production', 'success', 'ci-cd', 15, 138],
	['user-profile', 'v1.9.1', 'User Domain', 'staging', 'success', 'ci-cd', 22, 165],
	[
		'inventory-service',
		'v1.6.4',
		'Inventory Domain',
		'production',
		'in-progress',
		'ci-cd',
		25,
		null
	],
	['notification-worker', 'v1.2.8', 'Notification Domain', 'production', 'failed', 'ci-cd', 35, 72],
	['payment-gateway', 'v1.6.3', 'Payment Domain', 'production', 'success', 'gitops', 45, 242],
	['email-service', 'v2.1.0', 'Shared Domain', 'production', 'success', 'ci-cd', 60, 125],
	['order-worker', 'v1.3.6', 'Order Domain', 'staging', 'failed', 'ci-cd', 75, 58],
	['payment-reconciler', 'v3.0.1', 'Payment Domain', 'production', 'success', 'ci-cd', 92, 311],
	['user-auth', 'v2.2.0', 'User Domain', 'production', 'success', 'gitops', 108, 187],
	['inventory-sync', 'v1.1.9', 'Inventory Domain', 'staging', 'success', 'ci-cd', 121, 96],
	['order-api', 'v1.8.4', 'Order Domain', 'production', 'in-progress', 'ci-cd', 134, null],
	['payment-ledger', 'v2.0.5', 'Payment Domain', 'staging', 'success', 'ci-cd', 150, 221],
	['notification-api', 'v1.4.2', 'Notification Domain', 'staging', 'success', 'manual', 168, 143],
	['user-preferences', 'v1.0.7', 'User Domain', 'development', 'success', 'ci-cd', 185, 88],
	['order-events', 'v2.3.1', 'Order Domain', 'production', 'success', 'gitops', 201, 176],
	['payment-webhooks', 'v1.9.4', 'Payment Domain', 'production', 'success', 'ci-cd', 218, 154],
	['inventory-api', 'v1.6.4', 'Inventory Domain', 'production', 'success', 'ci-cd', 236, 209],
	['shared-config', 'v4.1.0', 'Shared Domain', 'production', 'success', 'gitops', 255, 64],
	['user-sessions', 'v2.2.1', 'User Domain', 'staging', 'success', 'ci-cd', 271, 118],
	['payment-api', 'v2.4.1', 'Payment Domain', 'staging', 'success', 'ci-cd', 288, 198],
	['order-fulfilment', 'v1.5.2', 'Order Domain', 'production', 'success', 'ci-cd', 305, 262],
	[
		'payment-fraud-check',
		'v1.2.0',
		'Payment Domain',
		'production',
		'in-progress',
		'ci-cd',
		322,
		null
	],
	['user-profile', 'v1.9.0', 'User Domain', 'production', 'success', 'ci-cd', 340, 171],
	['inventory-reserve', 'v1.0.3', 'Inventory Domain', 'development', 'success', 'manual', 358, 79],
	['order-service', 'v1.8.3', 'Order Domain', 'development', 'success', 'ci-cd', 372, 131],
	['payment-refunds', 'v1.7.8', 'Payment Domain', 'production', 'success', 'gitops', 390, 233],
	['payment-settlements', 'v2.1.4', 'Payment Domain', 'production', 'success', 'ci-cd', 408, 285],
	['order-pricing', 'v1.4.0', 'Order Domain', 'staging', 'success', 'ci-cd', 425, 147],
	['payment-api', 'v2.4.0', 'Payment Domain', 'staging', 'success', 'ci-cd', 2880, 192],
	['payment-api', 'v2.3.9', 'Payment Domain', 'production', 'failed', 'ci-cd', 8640, 96],
	['payment-api', 'v2.3.8', 'Payment Domain', 'production', 'success', 'ci-cd', 10080, 186]
];

/** Who ran it. A pipeline for automated triggers, a person for a manual one. */
const TRIGGER_ACTORS: Record<DeploymentTrigger, string> = {
	'ci-cd': 'CI/CD Pipeline',
	gitops: 'GitOps',
	manual: 'Alex Morgan',
	rollback: 'CI/CD Pipeline'
};

/**
 * Materialise the seeds into full deployments.
 *
 * References count down from a fixed number in the same order as the seeds, so
 * `#17892` is always the newest run and the list reads like a real build log.
 */
function listDeploymentLog(now: Date): Deployment[] {
	const icons = new Map(listDomains().map((domain) => [domain.id, domain.icon]));

	return DEPLOYMENT_SEEDS.map(
		([service, version, domainName, environment, status, trigger, minutes, duration], index) => {
			const domainId = slugify(domainName);

			return {
				id: `dep-${17892 - index}`,
				reference: `#${17892 - index}`,
				service,
				version,
				domainId,
				domainName,
				icon: icons.get(domainId) ?? 'package',
				environment,
				status,
				trigger,
				deployedBy: TRIGGER_ACTORS[trigger],
				deployedAt: minutesAgo(now, minutes),
				durationSeconds: duration
			};
		}
	);
}

/** Newest first, which is the only order a deployment log is ever read in. */
export function listDeployments(now: Date): Deployment[] {
	return listDeploymentLog(now).sort((a, b) => Date.parse(b.deployedAt) - Date.parse(a.deployedAt));
}

/**
 * Points for the status-over-time chart.
 *
 * Seeded like every other fixture: a chart that redraws differently on each refresh
 * reports change that did not happen, which undermines the numbers printed beside it.
 */
export function buildStatusTrend(now: Date, buckets = 16): TimeSeries[] {
	const shapes: Array<[string, string, number, number]> = [
		['successful', 'Successful', 24, 0.14],
		['in-progress', 'In Progress', 8, 0.3],
		['failed', 'Failed', 2, 0.5]
	];

	return shapes.map(([id, label, centre, volatility]) => {
		const values = buildSeries(`deploy:${id}`, centre, { volatility, floor: 0 }).values.slice(
			0,
			buckets
		);

		return {
			id,
			label,
			points: values.map((value, index) => ({
				label: clockLabel(now, (buckets - 1 - index) * 5),
				value: Math.round(value)
			})),
			min: Math.min(...values),
			max: Math.max(...values)
		};
	});
}

/** "09:15" for a point five-minute buckets back. */
function clockLabel(now: Date, minutesBack: number): string {
	const at = new Date(now.getTime() - minutesBack * 60_000);
	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** "May 14" for a whole day back. */
function dayLabel(now: Date, daysBack: number): string {
	const at = new Date(now.getTime() - daysBack * 86_400_000);
	return at.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

const GRAIN_DAYS: Record<TrendGrain, number> = { daily: 1, weekly: 7, monthly: 30 };

/**
 * Deployment count and mean duration bucketed at the requested grain.
 *
 * The newest bucket is pinned to today's actual totals so the charts and the tiles
 * above them cannot print different numbers for the same day.
 */
export function buildDeploymentTrends(
	now: Date,
	grain: TrendGrain,
	buckets = 7
): { frequency: TimeSeries; meanDuration: TimeSeries } {
	const log = listDeploymentLog(now);
	const today = log.length;
	const finished = log.filter((one) => one.durationSeconds !== null);
	const meanToday = Math.round(
		finished.reduce((sum, one) => sum + (one.durationSeconds ?? 0), 0) / (finished.length || 1)
	);

	const counts = buildSeries(`deploy:frequency:${grain}`, today, {
		volatility: 0.18,
		floor: 1
	}).values.slice(0, buckets);
	const durations = buildSeries(`deploy:duration:${grain}`, meanToday, {
		volatility: 0.12,
		drift: -0.2,
		floor: 30
	}).values.slice(0, buckets);

	const step = GRAIN_DAYS[grain];
	const labels = Array.from({ length: buckets }, (_, index) =>
		dayLabel(now, (buckets - 1 - index) * step)
	);

	const frequency = toTrend('frequency', 'Deployments', labels, counts.map(Math.round));
	const meanDuration = toTrend('mean-duration', 'Mean time', labels, durations.map(Math.round));

	// Pin the last bucket so the chart agrees with the tiles above it.
	frequency.points[frequency.points.length - 1].value = today;
	meanDuration.points[meanDuration.points.length - 1].value = meanToday;

	return { frequency: rebound(frequency), meanDuration: rebound(meanDuration) };
}

function toTrend(id: string, label: string, labels: string[], values: number[]): TimeSeries {
	return {
		id,
		label,
		points: labels.map((point, index) => ({ label: point, value: values[index] ?? 0 })),
		min: 0,
		max: 0
	};
}

/** Recompute bounds after a point was pinned, so the chart still scales to fit. */
function rebound(series: TimeSeries): TimeSeries {
	const values = series.points.map((point) => point.value);
	return { ...series, min: Math.min(...values), max: Math.max(...values) };
}

/**
 * The day's counts and rates, computed off the log.
 *
 * Derived rather than seeded so the six tiles cannot disagree with the twenty-nine
 * rows below them — the commonest way a dashboard tells two stories at once.
 *
 * The against-yesterday figures are seeded, because a one-day fixture has no
 * yesterday to compare with. They are the only invented numbers here.
 */
export function readDeploymentSummary(now: Date): DeploymentSummary {
	const log = listDeploymentLog(now);
	const count = (...statuses: Deployment['status'][]) =>
		log.filter((one) => statuses.includes(one.status)).length;

	const finished = log.filter((one) => one.durationSeconds !== null);
	const failed = count('failed', 'rolled-back');

	return {
		total: log.length,
		domainCount: new Set(log.map((one) => one.domainId)).size,
		successful: count('success'),
		inProgress: count('in-progress'),
		failed,
		meanDurationSeconds: Math.round(
			finished.reduce((sum, one) => sum + (one.durationSeconds ?? 0), 0) / (finished.length || 1)
		),
		changeFailureRatePct: log.length === 0 ? 0 : (failed / log.length) * 100,
		meanDurationChangePct: -18,
		changeFailureRateChangePct: -0.6,
		totalChangePct: 26
	};
}

/**
 * Deployments per domain, worst-represented last.
 *
 * The accent comes from the domain itself, so the donut and the legend cannot tint
 * the same domain differently — identity, not health, exactly as on the domain table.
 */
export function readDeploymentBreakdown(now: Date): DomainBreakdown {
	const accents = new Map(listDomains().map((domain) => [domain.id, domain.accent]));
	const log = listDeploymentLog(now);

	const grouped = new Map<string, { label: string; count: number }>();
	for (const one of log) {
		const entry = grouped.get(one.domainId) ?? { label: one.domainName, count: 0 };
		entry.count += 1;
		grouped.set(one.domainId, entry);
	}

	const slices = [...grouped.entries()]
		.map(([domainId, entry]) => ({
			domainId,
			label: entry.label,
			accent: accents.get(domainId) ?? 'slate',
			count: entry.count,
			// One decimal: with 29 runs, whole percents put two different counts on the
			// same number and the legend stops adding up.
			percentage: log.length === 0 ? 0 : Math.round((entry.count / log.length) * 1000) / 10
		}))
		.sort((a, b) => b.count - a.count);

	return { total: log.length, slices };
}

/**
 * The domain filter's options, counted over deployments rather than domains.
 *
 * A domain with no deployments today is deliberately absent: an option that always
 * returns an empty table is a dead control.
 */
export function listDeployingDomains(now: Date): FacetOption[] {
	return readDeploymentBreakdown(now)
		.slices.map((slice) => ({ id: slice.domainId, label: slice.label, count: slice.count }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Patterns worth a reader's attention.
 *
 * Each is derived from the log and states the number that triggered it, so an
 * insight cannot outlive the condition it describes.
 */
export function listDeploymentInsights(now: Date): DeploymentInsight[] {
	const log = listDeploymentLog(now);
	const summary = readDeploymentSummary(now);
	const insights: DeploymentInsight[] = [];

	const FAILURE_THRESHOLD_PCT = 1;
	if (summary.changeFailureRatePct > FAILURE_THRESHOLD_PCT) {
		insights.push({
			id: 'change-failure-rate',
			title: 'High Change Failure Rate',
			detail: `${summary.changeFailureRatePct.toFixed(1)}% failure rate is above the ${FAILURE_THRESHOLD_PCT}% threshold`,
			severity: 'critical',
			icon: 'shield-alert'
		});
	}

	const SLOW_SECONDS = 300;
	const slow = new Set(
		log.filter((one) => (one.durationSeconds ?? 0) > SLOW_SECONDS).map((one) => one.service)
	);
	if (slow.size > 0) {
		insights.push({
			id: 'slow-deployments',
			title: 'Slowest Deployments',
			detail: `${slow.size} service${slow.size === 1 ? ' has' : 's have'} deployment time > ${SLOW_SECONDS / 60}m`,
			severity: 'warning',
			icon: 'gauge'
		});
	}

	const failures = new Map<string, number>();
	for (const one of log) {
		if (one.status !== 'failed') continue;
		failures.set(one.service, (failures.get(one.service) ?? 0) + 1);
	}
	const repeat = [...failures.values()].filter((count) => count >= 1).length;
	if (repeat > 0) {
		insights.push({
			id: 'frequent-failures',
			title: 'Frequent Failures',
			detail: `${repeat} service${repeat === 1 ? '' : 's'} failed today`,
			severity: 'info',
			icon: 'repeat'
		});
	}

	return insights;
}

export function listOwners(): FacetOption[] {
	const counts = new Map<string, number>();
	for (const domain of listDomains()) {
		counts.set(domain.owner, (counts.get(domain.owner) ?? 0) + 1);
	}

	return [...counts.entries()]
		.map(([owner, count]) => ({ id: owner, label: owner, count }))
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
export function listActivitySummary(now: Date = new Date()): ActivitySummary {
	const domains = listDomains();
	const withIncidents = domains.filter((domain) => domain.activeIncidents > 0);
	const log = listDeploymentLog(now);

	return {
		activeIncidents: withIncidents.reduce((sum, domain) => sum + domain.activeIncidents, 0),
		incidentDomains: withIncidents.length,
		// Counted off the same log the deployment summary counts, not seeded. Two
		// endpoints publishing different totals for one day is the failure the whole
		// derive-rather-than-store rule exists to prevent — and adding three rows to
		// the log is all it took to expose it.
		deploymentsToday: log.length,
		deploymentDomains: new Set(log.map((one) => one.domainId)).size
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
export const CURRENT_USER: CurrentUser = {
	name: 'Alex Morgan',
	role: 'Platform Admin',
	initials: 'AM',
	unreadNotifications: 3
};
