import * as v from 'valibot';
import { query } from '$app/server';
import {
	DOMAIN_SORT_KEYS,
	DOMAIN_STATUS_FILTERS,
	domainSortOptions,
	domainStatusFilterOptions
} from '$lib/platform/query';
import { describeHealthThresholds } from '$lib/platform/health';
import { ENVIRONMENTS, NAV_ITEMS, TIME_RANGES } from '$lib/server/platform/fixtures';
import { platformSource, workspaceSource } from '$lib/server/platform';
import { DEFAULT_PAGE_SIZE, buildOverview, buildSystemStatus } from '$lib/server/platform/snapshot';

/*
 * Remote functions are public HTTP endpoints, so every argument is validated with a
 * Valibot schema. The picklists are built from the same arrays the UI's select
 * controls are built from — declaring the allowed values twice is how a control ends
 * up offering a sort the endpoint rejects.
 *
 * Schemas stay local to this file: only remote functions may be exported from a
 * `.remote.ts` module.
 */

const environmentSchema = v.picklist(['production', 'staging', 'development'] as const);
const timeRangeSchema = v.picklist(['5m', '15m', '1h', '6h', '24h', '7d'] as const);

const scopeSchema = v.object({
	environment: environmentSchema,
	timeRange: timeRangeSchema
});

const domainQuerySchema = v.object({
	environment: environmentSchema,
	timeRange: timeRangeSchema,
	// Bounded so a long paste cannot turn into an expensive scan.
	search: v.pipe(v.string(), v.maxLength(120)),
	status: v.picklist(DOMAIN_STATUS_FILTERS),
	sort: v.picklist(DOMAIN_SORT_KEYS),
	page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)),
	pageSize: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
});

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
export const getOverview = query(scopeSchema, async (scope) =>
	buildOverview(platformSource(), scope)
);

/**
 * The aggregate badge in the sidebar footer.
 *
 * Its own query rather than a field on the shell: it reflects live health, so it has
 * to refresh on the same cadence as the overview, while the rest of the shell does not.
 */
export const getSystemStatus = query(scopeSchema, async (scope) =>
	buildSystemStatus(await platformSource().readDomainStatusCounts(scope))
);

/**
 * One page of the domain health table.
 *
 * Separate from `getOverview` so that typing in the table's search box refetches
 * eight rows rather than the whole page's worth of incidents, deployments and
 * infrastructure counts. Filtering, sorting and paging are pushed into the source.
 */
export const getDomainPage = query(
	domainQuerySchema,
	async ({ environment, timeRange, ...query }) =>
		platformSource().queryDomains({ environment, timeRange }, query)
);
