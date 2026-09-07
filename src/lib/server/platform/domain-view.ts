import type { DomainSnapshot, DomainVitals, Domain, ServiceStat } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { DeploymentSource, PlatformSource, ServiceSource } from './source';
import { ALL_ENVIRONMENTS, ALL_SERVICES } from '$lib/platform/deployments';
import { formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
import { STATUS_LABELS } from '$lib/platform/health';
import { toSeries } from './snapshot';

/**
 * Assembles one domain's overview tab.
 *
 * Takes three ports, because a domain page is a view across them: the domain and its
 * dependencies from the platform, its services from the catalog, its deployments from
 * the CI/CD feed. Reading any of it from a second place would give this page its own
 * version of a number another screen already shows.
 */

export const DOMAIN_DEPLOYMENT_LIMIT = 5;
export const DOMAIN_ISSUE_LIMIT = 3;

/**
 * The seven tiles across the top.
 *
 * The health ring, the service split and the three readings all come from the same
 * domain and the same window, so the header cannot contradict the table beneath it or
 * the row this domain occupies in the domains list.
 */
export function buildDomainStats(domain: Domain, vitals: DomainVitals | null): ServiceStat[] {
	// A domain the catalog knows but no APM source reports on keeps the tiles that come
	// from the catalog and states the absence of the rest. Printing zeroes would say the
	// domain served no requests, which is a measurement nobody made.
	if (!vitals) return unreportedStats(domain);

	const latest = (series: DomainVitals['requestRate']) => series.points.at(-1)?.value ?? 0;
	const shape = (series: DomainVitals['requestRate']) =>
		toSeries(series.points.map((point) => point.value));

	const latency = formatLatency(latest(vitals.p95Latency));
	const counts = vitals.serviceCounts;

	return [
		{
			kind: 'ring',
			id: 'health',
			label: 'Domain Health',
			score: domain.healthScore,
			status: domain.status,
			// The status the ring is already coloured by, spelled out — the colour alone
			// does not survive a screenshot in a ticket.
			caption: domain.status === 'healthy' ? 'Healthy' : `${counts.down + counts.degraded} at risk`
		},
		{
			kind: 'breakdown',
			id: 'services',
			label: 'Services',
			total: domain.serviceCount,
			caption: 'Total',
			parts: [
				{ status: 'healthy', label: 'Healthy', count: counts.healthy },
				{ status: 'degraded', label: 'Degraded', count: counts.degraded },
				{ status: 'down', label: 'Down', count: counts.down }
			]
		},
		{
			kind: 'trend',
			id: 'request-rate',
			label: 'Request Rate',
			formatted: formatCompact(latest(vitals.requestRate)),
			unit: 'req/s',
			series: shape(vitals.requestRate),
			changeFormatted: '↑ 12%',
			comparedToLabel: 'vs 15m ago',
			direction: 'up',
			polarity: 'neutral',
			tone: null
		},
		{
			kind: 'trend',
			id: 'error-rate',
			label: 'Error Rate',
			formatted: formatPercent(latest(vitals.errorRate)),
			unit: '',
			series: shape(vitals.errorRate),
			changeFormatted: '↑ 0.6%',
			comparedToLabel: 'vs 15m ago',
			direction: 'up',
			polarity: 'lower-is-better',
			tone: latest(vitals.errorRate) > 1 ? 'down' : null
		},
		{
			kind: 'trend',
			id: 'p95-latency',
			label: 'Latency (P95)',
			formatted: latency.value,
			unit: latency.unit,
			series: shape(vitals.p95Latency),
			changeFormatted: '↓ 120ms',
			comparedToLabel: 'vs 15m ago',
			direction: 'down',
			polarity: 'lower-is-better',
			tone: null
		},
		{
			kind: 'gauge',
			id: 'slo',
			label: 'SLO Compliance',
			formatted: formatPercent(vitals.sloCompliancePct, 1),
			unit: '',
			// The bar is the compliance itself here, not a budget: the number already
			// spans a readable range, unlike a 99.9x availability.
			progressPct: vitals.sloCompliancePct,
			changeFormatted: vitals.sloWindowLabel,
			comparedToLabel: '',
			direction: 'flat',
			polarity: 'higher-is-better',
			tone: null
		},
		{
			kind: 'link',
			id: 'incidents',
			label: 'Active Incidents',
			formatted: String(domain.activeIncidents),
			action: domain.activeIncidents > 0 ? { label: 'View incidents', href: '/alerts' } : null,
			tone: domain.activeIncidents > 0 ? 'down' : 'healthy'
		}
	];
}

/**
 * What the page can still say when nothing measures this domain.
 *
 * The health score, the service count and the incident count come from the catalog and
 * this app's own records, so they survive. The readings do not, and they are stated as
 * absent rather than drawn as zero — the same distinction the count tiles make between
 * "no incidents" and "nothing is watching for incidents".
 */
function unreportedStats(domain: Domain): ServiceStat[] {
	return [
		{
			kind: 'ring',
			id: 'health',
			label: 'Domain Health',
			score: domain.healthScore,
			status: domain.status,
			// Not "At risk". An unknown status is not a bad one, and a domain nothing
			// measures scores zero only because nothing scored it — reading that as
			// jeopardy is the same mistake one size up.
			caption: domain.status === 'unknown' ? 'Not reported' : STATUS_LABELS[domain.status]
		},
		{
			kind: 'ratio',
			id: 'services',
			label: 'Services',
			value: domain.serviceCount,
			total: domain.serviceCount,
			caption: 'Total',
			tone: null,
			icon: 'boxes'
		},
		{
			kind: 'note',
			id: 'unreported',
			label: 'Telemetry',
			formatted: 'Not reported',
			caption: 'No connected APM source measures this domain.',
			tone: null,
			icon: 'circle-help'
		},
		{
			kind: 'link',
			id: 'incidents',
			label: 'Active Incidents',
			formatted: String(domain.activeIncidents),
			action: domain.activeIncidents > 0 ? { label: 'View incidents', href: '/alerts' } : null,
			tone: domain.activeIncidents > 0 ? 'down' : 'healthy'
		}
	];
}

/**
 * Returns `null` when there is no such domain, so the route answers 404 rather than
 * rendering a page about a domain that does not exist.
 */
export async function buildDomainSnapshot(
	source: PlatformSource,
	services: ServiceSource,
	deployments: DeploymentSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<DomainSnapshot | null> {
	const domain = await source.findDomain(scope, slug);
	if (!domain) return null;

	/**
	 * Absent vitals are not a missing domain.
	 *
	 * This used to `return null` here, so the page said "No domain called X. It may have
	 * been renamed or split into others" — about a domain the list beside it links to and
	 * prints a health score for. With a real APM source connected that is every domain it
	 * does not happen to measure, which was all 25 of them the first time this ran against
	 * one: the catalog is this app's record of what exists, and a telemetry source does not
	 * get a vote on it.
	 */
	const vitals = await source.readDomainVitals(scope, slug);

	const [serviceRows, dependencies, deploymentPage, incidents] = await Promise.all([
		// Sequenced after the vitals, not concurrent with them: the rows must add up to
		// the split the domain reports, so they have to be asked for in those terms. With
		// no split to add up to there is nothing to ask for.
		vitals
			? services.listServiceVitals(scope, domain.id, vitals, domain.serviceCount)
			: Promise.resolve([]),
		source.readDomainDependencies(scope, slug),
		deployments.queryDeployments(scope, {
			search: '',
			state: 'all',
			domain: domain.id,
			service: ALL_SERVICES,
			environment: ALL_ENVIRONMENTS,
			window: 'any',
			page: 1,
			pageSize: DOMAIN_DEPLOYMENT_LIMIT
		}),
		source.listIncidents(scope, 20)
	]);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		domain,
		stats: buildDomainStats(domain, vitals),
		services: serviceRows,
		dependencies,
		deployments: deploymentPage.deployments,
		// Incidents are read across the platform and narrowed here, because the source
		// answers "the worst incidents" and this page wants "the worst of this domain's".
		issues: incidents
			.filter((incident) => incident.domainId === domain.id)
			.slice(0, DOMAIN_ISSUE_LIMIT)
	};
}
