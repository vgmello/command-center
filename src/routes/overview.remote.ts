import { query } from '$app/server';
import { domainSortOptions, domainStatusFilterOptions } from '$lib/platform/query';
import { describeHealthThresholds } from '$lib/platform/health';
import { ENVIRONMENTS, NAV_ITEMS, TIME_RANGES } from '$lib/server/platform/fixtures';
import { scopeSchema, scopedDomainQuerySchema } from '$lib/server/api/schemas';
import { workspaceSource } from '$lib/server/platform';
import { DEFAULT_PAGE_SIZE } from '$lib/server/platform/snapshot';
import { readDomainPage, readOverview, readSystemStatus } from '$lib/server/platform/service';

/*
 * The UI's transport.
 *
 * These are public HTTP endpoints, so every argument is validated — against the same
 * schemas the JSON API uses (`$lib/server/api/schemas.ts`), which is what stops the
 * two surfaces disagreeing about what a valid time range is.
 *
 * Each function calls the service in process. It must never fetch `/api/v1/*`: that
 * would add a network hop, throw away end-to-end types, and fail during SSR, where
 * the server would be fetching itself.
 */

/**
 * Chrome that surrounds every page, and the vocabulary its controls are built from:
 * navigation, favourites, the signed-in user, the scope pickers, the domain table's
 * filter and sort options, and the copy explaining the health bands.
 *
 * The option lists travel with the shell so the client never declares its own. The
 * threshold sentence is generated from the constants that actually decide the bands,
 * so it cannot describe a rule the code no longer applies.
 *
 * Split from the overview data because none of it changes when the scope does —
 * switching environment must not re-render the sidebar.
 */
export const getShell = query(async () => {
	const workspace = workspaceSource();
	const [user, favorites] = await Promise.all([
		workspace.readCurrentUser(),
		workspace.listFavorites()
	]);

	return {
		nav: NAV_ITEMS,
		favorites,
		user,
		environments: ENVIRONMENTS,
		timeRanges: TIME_RANGES,
		domainStatusFilters: domainStatusFilterOptions(),
		domainSortOptions: domainSortOptions(),
		healthThresholds: describeHealthThresholds(),
		defaultPageSize: DEFAULT_PAGE_SIZE
	};
});

/** Everything above and beside the domain table, for one environment/time-range scope. */
export const getOverview = query(scopeSchema, async (scope) => readOverview(scope));

/**
 * The aggregate badge in the sidebar footer.
 *
 * Its own query rather than a field on the shell: it reflects live health, so it has
 * to refresh on the same cadence as the overview, while the rest of the shell does not.
 */
export const getSystemStatus = query(scopeSchema, async (scope) => readSystemStatus(scope));

/**
 * One page of the domain health table.
 *
 * Separate from `getOverview` so that typing in the table's search box refetches
 * eight rows rather than the whole page's worth of incidents, deployments and
 * infrastructure counts. Filtering, sorting and paging are pushed into the source.
 */
export const getDomainPage = query(
	scopedDomainQuerySchema,
	async ({ environment, timeRange, ...query }) => readDomainPage({ environment, timeRange }, query)
);
