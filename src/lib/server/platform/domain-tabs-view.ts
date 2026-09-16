import type { DomainDeploymentsSnapshot, TrendGrain } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { DeploymentSource, PlatformSource, ServiceSource } from './source';
import { ALL_ENVIRONMENTS, ALL_SERVICES } from '$lib/platform/deployments';
import { rollUpDeployments } from '$lib/platform/domain-deployments';
import { panel } from '../sources/panel';

/**
 * Assembles the domain tabs that are not the overview.
 *
 * One module rather than one per tab: they share the same three ports, the same
 * catalog-first lookup and the same rule about what is a gap and what is a 404, and a
 * file each would copy all three. `domain-view.ts` keeps the overview, which is a
 * different composite with a different shape.
 */

/** How many log rows the tab lists. A page, not the five the overview card shows. */
export const DOMAIN_DEPLOYMENT_PAGE = 20;

/** The grain the tab draws, and therefore the window its figures cover. */
const TAB_GRAIN: TrendGrain = 'daily';

/**
 * How far back the daily grain looks.
 *
 * Restated here rather than imported: the window belongs to the series accumulator, which
 * sits *beneath* the ports, and an assembler reaching down into a router's constants would
 * invert the dependency this layering exists to keep straight. It is the third copy of the
 * same fourteen for the same reason the providers each keep their own.
 */
const TAB_WINDOW_DAYS = 14;

/**
 * A domain's deployment figures, its frequency chart, its per-service breakdown and its log.
 *
 * Returns `null` when there is no such domain, so the route renders a not-found panel
 * inside the shell rather than throwing — a typo in a URL is not an outage.
 *
 * Every source-backed read is wrapped in `panel()`; the catalog reads are not. The catalog
 * is this app's own record, and a domain it does not contain has nothing to hang a gap on.
 */
export async function buildDomainDeploymentsSnapshot(
	platform: PlatformSource,
	services: ServiceSource,
	deployments: DeploymentSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<DomainDeploymentsSnapshot | null> {
	const domain = await platform.findDomain(scope, slug);
	if (!domain) return null;

	// Which services this domain owns is a catalog fact, and the only one the roll-up
	// needs. Started here and awaited inside the panel so it overlaps the trends read
	// rather than serialising in front of it.
	const owned = services.listServices(scope, domain.id);

	const [stats, log] = await Promise.all([
		panel('deployment.serviceTrends', async () => {
			const [rows, catalog] = await Promise.all([
				deployments.readServiceTrends(scope, TAB_GRAIN),
				owned
			]);

			// Summed rather than averaged, and the rate divided after both counts are
			// summed — see `rollUpDeployments`, which is where that arithmetic is argued.
			return {
				data: rollUpDeployments(
					rows,
					catalog.map((one) => one.slug)
				)
			};
		}),
		panel('deployment.log', async () => ({
			data: (
				await deployments.queryDeployments(scope, {
					search: '',
					state: 'all',
					// Pushed down, not filtered here: the source owns paging, and narrowing
					// above it would fetch the estate to show one domain.
					domain: domain.id,
					service: ALL_SERVICES,
					environment: ALL_ENVIRONMENTS,
					window: 'any',
					page: 1,
					pageSize: DOMAIN_DEPLOYMENT_PAGE
				})
			).deployments
		}))
	]);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		domain,
		// Stated, because "34 deploys" means nothing without it — and because the figures
		// come from the grain's own window rather than from the scope's time range, so the
		// picker in the top bar does not describe them.
		windowLabel: `Last ${TAB_WINDOW_DAYS} days`,
		stats,
		log
	};
}
