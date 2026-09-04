import type { PlatformSource } from '../../platform/source';
import type { ApmProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

/**
 * `PlatformSource`, split between the catalog and an APM source.
 *
 * The domain catalog is app-owned: which domains exist, what they are called and how
 * they depend on each other is this platform's own model, and no monitoring tool knows
 * it. What a domain is currently *doing* comes from APM. Serving the first from the
 * catalog is why the domains table keeps working with nothing connected.
 */
export function createPlatformRouter(deps: RouterDeps, catalog: PlatformSource): PlatformSource {
	const source: PlatformSource = {
		id: 'routed',

		// App-owned: delegated to the catalog unchanged.
		queryDomains: (scope, query) => catalog.queryDomains(scope, query),
		findDomain: (scope, slug) => catalog.findDomain(scope, slug),
		readDomainStatusCounts: (scope) => catalog.readDomainStatusCounts(scope),
		listOwners: (scope) => catalog.listOwners(scope),
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

		readRates: (scope) =>
			fanOut(deps, 'apm.rates', scope, '', (client, ctx) =>
				(client as ApmProvider).readRates!(ctx)
			),

		listIncidents: (scope, limit) =>
			fanOut(deps, 'apm.incidents', scope, `limit=${limit}`, (client, ctx) =>
				(client as ApmProvider).listIncidents!(ctx, limit)
			),

		readActivitySummary: (scope) =>
			fanOutSingle(deps, 'apm.activity', scope, '', (client, ctx) =>
				(client as ApmProvider).readActivitySummary!(ctx)
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
