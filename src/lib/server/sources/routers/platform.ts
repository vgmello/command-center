import type { PlatformSource } from '../../platform/source';
import type { ApmProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';
import type { CatalogSource } from '../../catalog/source';
import { identityFor } from '$lib/platform/catalog';
import { rollUpDomain, type ServiceReading } from '$lib/platform/catalog-merge';
import { queryDomainsInMemory } from '../../platform/in-memory-query';
import type { PlatformScope } from '$lib/platform/query';
import type { Domain } from '$lib/platform/types';

/**
 * `PlatformSource`, split between the catalog and an APM source.
 *
 * The domain catalog is app-owned: which domains exist, what they are called and how
 * they depend on each other is this platform's own model, and no monitoring tool knows
 * it. What a domain is currently *doing* comes from APM. Serving the first from the
 * catalog is why the domains table keeps working with nothing connected.
 */
export function createPlatformRouter(
	deps: RouterDeps,
	catalog: PlatformSource,
	services: CatalogSource
): PlatformSource {
	/** Readings keyed by catalog slug, or empty when nothing answers. */
	async function readings(scope: PlatformScope) {
		try {
			const rows = await fanOut<ServiceReading>(
				deps,
				'apm.serviceHealth',
				scope,
				'',
				(client, ctx) => (client as ApmProvider).readServiceHealth!(ctx)
			);

			return new Map(rows.map((one) => [one.service, one]));
		} catch {
			return new Map<string, ServiceReading>();
		}
	}

	/**
	 * Every domain the catalog declares, rolled up from its own services.
	 *
	 * The service count is the number declared rather than a figure carried beside it,
	 * so the domains table and a domain's own service table cannot disagree.
	 */
	async function domains(scope: PlatformScope): Promise<Domain[]> {
		const [entries, allServices, byService] = await Promise.all([
			services.listDomains(),
			services.listServices(),
			readings(scope)
		]);

		return entries.map((entry) =>
			rollUpDomain(
				entry,
				allServices.filter((one) => one.domainId === entry.id),
				new Map(
					allServices
						.filter((one) => one.domainId === entry.id)
						.flatMap((one) => {
							const reading = byService.get(identityFor(one, 'apm'));
							return reading ? [[one.slug, reading] as const] : [];
						})
				)
			)
		);
	}

	const source: PlatformSource = {
		id: 'routed-platform',

		// Declared by the catalog, rolled up from what the sources report.
		queryDomains: async (scope, query) =>
			// Filtering and paging in memory: the catalog cannot sort by a health score it
			// does not hold, so pushing the query down is impossible in principle. This is
			// one adapter's strategy, not the contract.
			queryDomainsInMemory(await domains(scope), query),

		findDomain: async (scope, slug) =>
			(await domains(scope)).find((one) => one.slug === slug) ?? null,

		readDomainStatusCounts: async (scope) => {
			const counts = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
			for (const domain of await domains(scope)) counts[domain.status]++;
			return counts;
		},

		listOwners: async () => {
			const owners = await services.listOwners();
			// Counted across domains, because that is what the filter narrows.
			const all = await services.listDomains();

			return owners.map((owner) => ({
				id: owner,
				label: owner,
				count: all.filter((one) => one.owner === owner).length
			}));
		},

		// Still the fixture's: a change feed is neither declared nor a reading.
		listRecentChanges: (scope, limit) => catalog.listRecentChanges(scope, limit),
		readDomainDependencies: (scope, slug) => catalog.readDomainDependencies(scope, slug),

		// Source-backed.
		readDomainVitals: (scope, slug) =>
			fanOutSingle(deps, 'apm.domainVitals', scope, `domain=${slug}`, (client, ctx) =>
				(client as ApmProvider).readDomainVitals!({
					...ctx,
					binding: bindingFor(slug)
				})
			),

		/**
		 * Fleet-wide, so it takes no binding — the question is about every service at
		 * once, and a source that cannot answer it says so rather than answering for one.
		 */
		listPlatformInsights: (scope) =>
			fanOut(deps, 'apm.platformInsights', scope, '', (client, ctx) =>
				(client as ApmProvider).listPlatformInsights!(ctx)
			),

		readRates: (scope) =>
			fanOut(deps, 'apm.rates', scope, '', (client, ctx) =>
				(client as ApmProvider).readRates!(ctx)
			),

		listIncidents: (scope, limit) =>
			fanOut(deps, 'apm.incidents', scope, `limit=${limit}`, (client, ctx) =>
				(client as ApmProvider).listIncidents!(ctx, limit)
			)
	};

	return source;
}

/**
 * A binding standing in for the catalog's, until bindings land on domain records.
 *
 * Increment 6 replaces this with the record's own binding. Until then a resource-scoped
 * APM read still needs to say *which* resource, and the slug is what the fixture
 * provider expects.
 */
function bindingFor(slug: string) {
	return { kind: 'apm' as const, connectionId: '', externalId: slug };
}
