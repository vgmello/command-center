import * as v from 'valibot';
import { query } from '$app/server';
import {
	CURRENT_USER,
	ENVIRONMENTS,
	NAV_ITEMS,
	TIME_RANGES,
	listDomains,
	listFavorites
} from '$lib/server/platform/fixtures';
import {
	DEFAULT_PAGE_SIZE,
	buildOverview,
	buildSystemStatus,
	queryDomains
} from '$lib/server/platform/snapshot';

/*
 * Remote functions are public HTTP endpoints, so every argument is validated
 * with a Valibot schema. The schemas are local to this file on purpose: only
 * remote functions may be exported from a `.remote.ts` module.
 */

const environmentSchema = v.picklist(['production', 'staging', 'development'] as const);
const timeRangeSchema = v.picklist(['5m', '15m', '1h', '6h', '24h', '7d'] as const);
const statusFilterSchema = v.picklist(['all', 'healthy', 'degraded', 'down', 'unknown'] as const);
const sortSchema = v.picklist([
	'health-score',
	'error-rate',
	'p95-latency',
	'active-incidents',
	'name'
] as const);

const scopeSchema = v.object({
	environment: environmentSchema,
	timeRange: timeRangeSchema
});

const domainQuerySchema = v.object({
	environment: environmentSchema,
	timeRange: timeRangeSchema,
	// Bounded so a long paste cannot turn into an expensive scan.
	search: v.pipe(v.string(), v.maxLength(120)),
	status: statusFilterSchema,
	sort: sortSchema,
	page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)),
	pageSize: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
});

/**
 * Chrome that surrounds every page: navigation, favourites, the signed-in user,
 * and the option lists behind the environment and time-range pickers.
 *
 * Split from the overview data because it does not change when the scope does —
 * switching environment must not re-render the sidebar.
 */
export const getShell = query(async () => ({
	nav: NAV_ITEMS,
	favorites: listFavorites(),
	user: CURRENT_USER,
	environments: ENVIRONMENTS,
	timeRanges: TIME_RANGES,
	system: buildSystemStatus(listDomains()),
	defaultPageSize: DEFAULT_PAGE_SIZE
}));

/** Everything above and beside the domain table, for one environment/time-range scope. */
export const getOverview = query(scopeSchema, async ({ environment, timeRange }) =>
	buildOverview(environment, timeRange)
);

/**
 * One page of the domain health table.
 *
 * Separate from `getOverview` so that typing in the table's search box refetches
 * eight rows rather than the whole page's worth of incidents, deployments and
 * infrastructure counts.
 */
export const getDomainPage = query(domainQuerySchema, async (input) =>
	queryDomains(listDomains(), input)
);
