import type {
	ActivityCounts,
	CountTile,
	DomainStatusCounts,
	DomainsSnapshot
} from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import { ALL_DOMAINS, ALL_ENVIRONMENTS, ALL_SERVICES } from '$lib/platform/deployments';

/**
 * How many of today's deployments to page in for the tile.
 *
 * The count itself comes from the page total, so this only bounds how many rows are
 * scanned to learn which domains they touched — a number that saturates quickly.
 */
const TODAY_PAGE_SIZE = 200;
import type { DeploymentSource, PlatformSource } from './source';
import { buildDistribution } from '$lib/platform/health';
import { buildCountTiles } from './snapshot';
import { panel } from '../sources/panel';

/**
 * Assembles the domains page from whatever source is configured.
 *
 * A sibling of `snapshot.ts` rather than more functions inside it: the two screens
 * are composed differently and will diverge, and one module that assembles every
 * screen becomes the thing every screen change has to touch.
 *
 * Like the overview assembler, everything here is either a pure transform of what
 * the source returned or the orchestration that fetches it.
 */

/** The domains table shows more rows than the overview's summary of it. */
export const DOMAINS_PAGE_SIZE = 10;

/** How many rows the "Recently Changed" panel shows. The source slices; it does not guess. */
export const RECENT_CHANGE_LIMIT = 5;

/**
 * The domains page's tiles: the four status counts, then the day's activity.
 *
 * Composed from the overview's tiles rather than restating them, so the two pages
 * cannot end up describing "Degraded" differently. The two extra tiles are the ones
 * this screen adds, and they carry captions rather than percentages because a share
 * of the domain total would be a meaningless denominator for a deployment count.
 */
export function buildDomainCountTiles(
	counts: DomainStatusCounts,
	activity: ActivityCounts
): CountTile[] {
	return [
		...buildCountTiles(counts),
		{
			id: 'active-incidents',
			label: 'Active Incidents',
			icon: 'activity',
			value: activity.activeIncidents,
			percentage: null,
			caption: acrossDomains(activity.incidentDomains),
			// No tone when there is no number: an unknown count must not be tinted the
			// healthy green that "zero incidents" earns.
			tone:
				activity.activeIncidents === null ? null : activity.activeIncidents > 0 ? 'down' : 'healthy'
		},
		{
			id: 'deployments-today',
			label: 'Deployments Today',
			icon: 'rocket',
			value: activity.deploymentsToday,
			percentage: null,
			caption: acrossDomains(activity.deploymentDomains),
			tone: null
		}
	];
}

function acrossDomains(count: number | null): string {
	// A caption, not a null: the tile's second line is where a reader looks to find out
	// why the first one is a dash, and an empty string tells them nothing.
	if (count === null) return 'Not reported';
	return `Across ${count} domain${count === 1 ? '' : 's'}`;
}

/**
 * Everything the domains page needs except the paged table.
 *
 * The table is a separate query on purpose: typing in the search box must refetch
 * ten rows, not the tiles, the donut, the incident list and the change feed as well.
 *
 * The reads run concurrently — they are independent, and issuing them in sequence
 * would make the page as slow as the sum of its panels rather than its slowest one.
 */
export async function buildDomainsSnapshot(
	source: PlatformSource,
	deployments: DeploymentSource,
	scope: PlatformScope,
	now: Date = new Date(),
	incidentLimit = RECENT_CHANGE_LIMIT
): Promise<DomainsSnapshot> {
	const [counts, incidents, changes, owners, deployedToday] = await Promise.all([
		// The catalog reads stay unwrapped: they are this app's own record, and without
		// them the page has no rows to hang a gap on.
		source.readDomainStatusCounts(scope),
		panel('apm.incidents', async () => ({
			data: await source.listIncidents(scope, incidentLimit)
		})),
		source.listRecentChanges(scope, RECENT_CHANGE_LIMIT),
		source.listOwners(scope),
		panel('deployment.log', async () => ({
			data: await deployments.queryDeployments(scope, {
				search: '',
				state: 'all',
				domain: ALL_DOMAINS,
				service: ALL_SERVICES,
				environment: ALL_ENVIRONMENTS,
				window: 'today',
				page: 1,
				pageSize: TODAY_PAGE_SIZE
			})
		}))
	]);

	// Derived from the rows already in hand rather than asked of a source.
	//
	// The tile used to come from an `apm.activity` capability, which was wrong twice
	// over: an APM tool cannot know what deployed, and a separately-sourced count can
	// disagree with the very list printed beneath it. Counting what was fetched cannot.
	//
	// A gap therefore propagates as null rather than as zero, for the same reason: the
	// count describes the rows fetched, and no rows were.
	const activity: ActivityCounts = {
		activeIncidents: incidents.status === 'ok' ? incidents.data.length : null,
		incidentDomains:
			incidents.status === 'ok' ? new Set(incidents.data.map((one) => one.domainId)).size : null,
		deploymentsToday: deployedToday.status === 'ok' ? deployedToday.data.page.totalItems : null,
		deploymentDomains:
			deployedToday.status === 'ok'
				? new Set(deployedToday.data.deployments.map((one) => one.domainId)).size
				: null
	};

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		counts: buildDomainCountTiles(counts, activity),
		distribution: buildDistribution(counts),
		incidents,
		changes,
		owners
	};
}
