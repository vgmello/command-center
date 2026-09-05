import type {
	CountTile,
	DeploymentSummary,
	DeploymentsSnapshot,
	RateTile,
	TrendGrain
} from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { DeploymentSource } from './source';
import { panel } from '../sources/panel';
import { formatChange } from '$lib/platform/format';
import { formatDuration } from '$lib/platform/deployments';

/**
 * Assembles the deployments page from whatever CI/CD source is configured.
 *
 * One assembler per screen, like `snapshot.ts` and `domains-view.ts`. Everything here
 * is either a pure transform of what the source returned or the orchestration that
 * fetches it — no invented numbers, no I/O of its own.
 */

export const DEPLOYMENTS_PAGE_SIZE = 8;

/** How many cards the "Recently Deployed Services" strip shows. */
export const RECENT_DEPLOYMENT_LIMIT = 8;

/**
 * The six tiles across the top.
 *
 * All six are derived from one summary, so the counts, the percentages and the rate
 * cannot tell different stories about the same set of runs. The three status tiles
 * carry a share; the two rate tiles carry a signed change instead, because a share of
 * the deployment total is a denominator neither of them is measured against.
 */
export function buildDeploymentTiles(summary: DeploymentSummary): CountTile[] {
	const share = (count: number) =>
		summary.total === 0 ? 0 : Math.round((count / summary.total) * 1000) / 10;

	return [
		{
			id: 'total',
			label: 'Deployments Today',
			icon: 'rocket',
			value: summary.total,
			percentage: null,
			caption: `Across ${summary.domainCount} domain${summary.domainCount === 1 ? '' : 's'}`,
			tone: null
		},
		{
			id: 'successful',
			label: 'Successful',
			icon: 'circle-check',
			value: summary.successful,
			percentage: share(summary.successful),
			caption: null,
			tone: 'healthy'
		},
		{
			id: 'in-progress',
			label: 'In Progress',
			icon: 'refresh-cw',
			value: summary.inProgress,
			percentage: share(summary.inProgress),
			caption: null,
			// `info`, not a health state: a run in flight has not reached an outcome, and
			// tinting it green or red would claim one.
			tone: 'info'
		},
		{
			id: 'failed',
			label: 'Failed',
			icon: 'circle-x',
			value: summary.failed,
			percentage: share(summary.failed),
			caption: null,
			tone: summary.failed > 0 ? 'down' : 'healthy'
		}
	];
}

/**
 * The two rate tiles.
 *
 * Built here rather than in the page, because everything the client renders arrives
 * from the server — and because this module is under `$lib/server`, a component that
 * called it would drag server code into the browser bundle.
 */
export function buildRateTiles(summary: DeploymentSummary): RateTile[] {
	const duration = formatDuration(summary.meanDurationSeconds);

	return [
		{
			id: 'mean-duration',
			label: 'Mean Deploy Time',
			icon: 'clock',
			formatted: duration,
			unit: '',
			changeFormatted: formatChange(summary.meanDurationChangePct, '%', 0),
			comparedToLabel: 'vs yesterday',
			polarity: 'lower-is-better',
			direction: directionOf(summary.meanDurationChangePct)
		},
		{
			id: 'change-failure-rate',
			label: 'Change Failure Rate',
			icon: 'shield',
			formatted: `${summary.changeFailureRatePct.toFixed(1)}%`,
			unit: '',
			changeFormatted: formatChange(summary.changeFailureRateChangePct, '%', 1),
			comparedToLabel: 'vs yesterday',
			polarity: 'lower-is-better',
			direction: directionOf(summary.changeFailureRateChangePct)
		}
	];
}

function directionOf(change: number): 'up' | 'down' | 'flat' {
	return change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
}

/**
 * Everything the deployments page needs except the paged table.
 *
 * The table is a separate query so that typing in its search box, or switching tabs,
 * refetches eight rows rather than three charts, a donut and a card strip as well.
 *
 * The reads run concurrently — they are independent, and in sequence the page would
 * be as slow as the sum of its panels rather than its slowest one.
 */
export async function buildDeploymentsSnapshot(
	source: DeploymentSource,
	scope: PlatformScope,
	grain: TrendGrain = 'daily',
	now: Date = new Date()
): Promise<DeploymentsSnapshot> {
	const [summary, statusTrend, byDomain, trends, insights, recent, domains] = await Promise.all([
		source.readSummary(scope),
		source.readStatusTrend(scope),
		source.readDomainBreakdown(scope),
		source.readTrends(scope, grain),
		// The one read on this screen a source may legitimately not answer: Octopus
		// reports what ran, not what it means. Wrapped so the page states the gap instead
		// of dying on it.
		panel('deployment.insights', async () => ({ data: await source.listInsights(scope) })),
		source.listDeployments(scope, RECENT_DEPLOYMENT_LIMIT),
		source.listDeployingDomains(scope)
	]);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		counts: buildDeploymentTiles(summary),
		rates: buildRateTiles(summary),
		statusTrend,
		byDomain,
		insights,
		frequency: trends.frequency,
		meanDuration: trends.meanDuration,
		summary,
		recent,
		domains
	};
}
