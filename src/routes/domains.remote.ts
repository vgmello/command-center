import { query } from '$app/server';
import { scopeSchema, scopedDomainQuerySchema, scopedServiceSchema } from '$lib/server/api/schemas';
import {
	readDomain,
	readDomainDependencies,
	readDomainPage,
	readDomainView,
	readDomainsView
} from '$lib/server/platform/service';

/*
 * The domain table's transport, shared by the overview (which shows a summary of it)
 * and the domains page (which is built around it).
 *
 * These are public HTTP endpoints, so every argument is validated — against the same
 * schemas the JSON API uses, which is what stops the two surfaces disagreeing about
 * what a valid sort key is.
 *
 * Each function calls the service in process. It must never fetch `/api/v1/*`: that
 * would add a network hop for nothing, throw away end-to-end types, and fail during
 * SSR, where the server would be fetching itself.
 */

/**
 * One page of domains.
 *
 * Its own query so that typing in the table's search box refetches rows rather than
 * the whole page's worth of tiles, incidents and change history. Filtering, sorting
 * and paging are pushed into the source.
 */
export const getDomainPage = query(
	scopedDomainQuerySchema,
	async ({ environment, timeRange, ...query }) => readDomainPage({ environment, timeRange }, query)
);

/**
 * Everything on the domains page except the table: the count tiles, the health
 * distribution, the active incidents, the recent score changes, and the owner
 * filter's options.
 *
 * One query rather than five because all of it changes on the same cadence — the
 * scope, or the refresh tick. The table is the one thing that does not, which is why
 * it is the one thing split out.
 */
export const getDomainsView = query(scopeSchema, async (scope) => readDomainsView(scope));

/**
 * One domain's overview tab.
 *
 * Resolves to `null` for a slug that matches nothing, which the page turns into a
 * not-found panel. `scopedServiceSchema` validates the slug — it is the same shape,
 * and a second identical schema is a second thing to keep in step.
 */
export const getDomainView = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomainView(scope, slug)
);

/**
 * The domain header, shared by every tab.
 *
 * Its own query because it is identical on all of them and changes only with the scope,
 * so a reader moving between tabs refetches the tab's own payload and nothing else,
 * rather than the overview composite's service table, deployment log and incident list.
 *
 * Calls `readDomain` directly — the same lookup `/api/v1/domains/[slug]` uses. The name
 * at this layer already says what it's for; a second service-layer function with the
 * same body would be indirection with no behavioural difference to justify it.
 */
export const getDomainHeader = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomain(scope, slug)
);

/**
 * The dependency graph for one domain.
 *
 * Split from the header for the same reason: the graph and the breadcrumb change on
 * different schedules from nothing here, but they are two different facts and a reader
 * on another tab should not pay for a graph they are not looking at.
 */
export const getDomainDependencies = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomainDependencies(scope, slug)
);
