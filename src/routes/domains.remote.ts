import { query } from '$app/server';
import { scopeSchema, scopedDomainQuerySchema } from '$lib/server/api/schemas';
import { readDomainPage, readDomainsView } from '$lib/server/platform/service';

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
