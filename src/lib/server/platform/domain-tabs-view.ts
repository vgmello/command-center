import type {
	DomainDeploymentsSnapshot,
	DomainSlosSnapshot,
	ServiceSloRow,
	TrendGrain
} from '$lib/platform/types';
import type { Panel } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';
import type { DeploymentSource, PlatformSource, ServiceSource } from './source';
import { ALL_ENVIRONMENTS, ALL_SERVICES } from '$lib/platform/deployments';
import { rollUpDeployments } from '$lib/platform/domain-deployments';
import { panel } from '../sources/panel';
import { CapabilityUnavailableError } from '../sources/errors';
import { listDomainServiceVitals } from './domain-view';

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

/**
 * A domain's SLO compliance, and the per-service budget behind each of its services.
 *
 * Returns `null` when there is no such domain, for the same reason the deployments tab
 * does — a typo in a URL is not an outage.
 *
 * The headline and the table are read as two separate panels, deliberately: `headline`
 * is `DomainVitals.sloCompliancePct`/`sloWindowLabel`, taken whole and never recomputed
 * from the rows below it, because the domain header prints those same two fields from
 * the same read and a tab that derived its own figure would make a reader switching
 * tabs watch the number move for no reason.
 */
export async function buildDomainSlosSnapshot(
	platform: PlatformSource,
	services: ServiceSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<DomainSlosSnapshot | null> {
	const domain = await platform.findDomain(scope, slug);
	if (!domain) return null;

	const headline = await panel('apm.domainVitals', async () => {
		const vitals = await platform.readDomainVitals(scope, slug);

		// A known domain's vitals come back `null` only for a domain the fixture source
		// does not know — already excluded above by `findDomain`. Treated the same as a
		// capability gap: this panel's shape has no slot for "connected, nothing to
		// report" the way `DomainSnapshot.stats` does, because a compliance percentage
		// and a window label are not optional the way a whole tile is.
		if (!vitals) throw new CapabilityUnavailableError('apm.domainVitals', 'no-capability');

		return { data: { compliancePct: vitals.sloCompliancePct, windowLabel: vitals.sloWindowLabel } };
	});

	return {
		generatedAt: now.toISOString(),
		domain,
		headline,
		services: await buildSloRows(platform, services, scope, domain.slug, headline)
	};
}

/**
 * The per-service rows behind the SLOs tab's table.
 *
 * Reuses `listDomainServiceVitals` (Task 8) rather than re-deriving the domain's owned
 * services here, so this tab's row set is exactly the Services tab's — not a second,
 * independently computed list that could disagree with it about which services this
 * domain runs.
 *
 * That reuse has a cost worth stating: `listDomainServiceVitals` needs `DomainVitals` to
 * deal the catalog's services out against the split the domain reports, so when the
 * domain's vitals are a gap it cannot say which services to read budgets for either.
 * A `[]` there would read as "this domain runs no services", which is a different and
 * false statement from "nothing told us which services it runs" — so that case is
 * carried through as the identical gap `headline` already captured (same capability,
 * same scope, same slug — the only reason `listDomainServiceVitals` came back empty),
 * rather than answering `apm.slo` for a read that never happened.
 */
async function buildSloRows(
	platform: PlatformSource,
	services: ServiceSource,
	scope: PlatformScope,
	slug: string,
	headline: Panel<{ compliancePct: number; windowLabel: string }>
): Promise<Panel<ServiceSloRow[]>> {
	const owned = await listDomainServiceVitals(platform, services, scope, slug);

	if (owned === null) {
		// `headline` already carries the exact cause: same capability, same read. Falling
		// back to a generic reason only guards a case the fixture source cannot produce
		// (vitals absent for a domain that is not a gap and not unknown).
		return headline.status === 'ok'
			? {
					status: 'unavailable',
					capability: 'apm.domainVitals',
					kind: 'apm',
					reason: 'no-capability'
				}
			: headline;
	}

	return panel('apm.slo', async () => ({
		data: await Promise.all(
			owned.map(async (one) => ({
				slug: one.slug,
				name: one.name,
				budget: await services.readSloBudget(scope, one.slug)
			}))
		)
	}));
}
