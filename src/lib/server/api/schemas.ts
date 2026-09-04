import * as v from 'valibot';
import { ALL_OWNERS, DOMAIN_SORT_KEYS, DOMAIN_STATUS_FILTERS } from '$lib/platform/query';
import {
	ALL_ENVIRONMENTS,
	DEPLOYMENT_STATES,
	DEPLOYMENT_WINDOWS,
	TREND_GRAINS
} from '$lib/platform/deployments';

/**
 * The one definition of a valid argument, shared by both transports.
 *
 * The UI's remote functions and the public JSON API validate against the same
 * schemas, so "what counts as a valid time range" cannot drift between them. The
 * picklists are built from the arrays the UI's select controls are also built from.
 *
 * These live here rather than in a `.remote.ts` because only remote functions may be
 * exported from those modules.
 */

export const environmentSchema = v.picklist(['production', 'staging', 'development'] as const);
export const timeRangeSchema = v.picklist(['5m', '15m', '1h', '6h', '24h', '7d'] as const);

export const scopeSchema = v.object({
	environment: environmentSchema,
	timeRange: timeRangeSchema
});

/** Filter, sort and paging, without the scope — the two are supplied separately. */
export const domainQuerySchema = v.object({
	// Bounded so a long paste cannot turn into an expensive scan.
	search: v.pipe(v.string(), v.maxLength(120)),
	status: v.picklist(DOMAIN_STATUS_FILTERS),
	/*
	 * A bounded string, not a picklist: owners are org data that changes without a
	 * deploy, so the valid set is not knowable at schema-compile time. An owner that
	 * no longer exists simply matches nothing — the same outcome as a stale picklist
	 * member, without a deploy being required to add a new team.
	 */
	owner: v.pipe(v.string(), v.maxLength(120)),
	sort: v.picklist(DOMAIN_SORT_KEYS),
	page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)),
	// Capped so one request cannot ask an adapter for the whole table.
	pageSize: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
});

/** What the UI's remote functions take: scope and query in one object. */
export const scopedDomainQuerySchema = v.object({
	...scopeSchema.entries,
	...domainQuerySchema.entries
});

/** Filter and paging for the deployment log. */
export const deploymentQuerySchema = v.object({
	search: v.pipe(v.string(), v.maxLength(120)),
	state: v.picklist(DEPLOYMENT_STATES),
	// Open sets, so bounded strings rather than picklists — same reasoning as `owner`.
	domain: v.pipe(v.string(), v.maxLength(120)),
	service: v.pipe(v.string(), v.maxLength(120)),
	environment: v.union([environmentSchema, v.literal(ALL_ENVIRONMENTS)]),
	window: v.picklist(DEPLOYMENT_WINDOWS),
	page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)),
	pageSize: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
});

/**
 * Nested rather than spread, unlike the domain equivalent.
 *
 * Both halves carry an `environment` and they mean different things: the scope's is
 * which environment the whole page reports on, the query's is a further narrowing of
 * the table below it — the top bar says Production while the toolbar still offers All
 * Environments. Flattening them would silently drop one.
 */
export const scopedDeploymentQuerySchema = v.object({
	scope: scopeSchema,
	query: deploymentQuerySchema
});

export const trendGrainSchema = v.picklist(TREND_GRAINS);

/**
 * A service slug from the URL.
 *
 * Bounded and character-restricted rather than a free string: it is interpolated into
 * a lookup by an adapter that may not be an in-memory array, and "as long as you like,
 * any bytes" is not a shape a query builder should be handed.
 */
export const serviceSlugSchema = v.pipe(
	v.string(),
	v.minLength(1),
	v.maxLength(120),
	v.regex(/^[a-z0-9][a-z0-9-]*$/, 'Must be a lowercase slug.')
);

export const scopedServiceSchema = v.object({
	...scopeSchema.entries,
	slug: serviceSlugSchema
});

/** The deployments page asks for its scope and the grain its two charts bucket at. */
export const scopedTrendSchema = v.object({
	...scopeSchema.entries,
	grain: trendGrainSchema
});

export const DEFAULT_API_PAGE_SIZE = 25;

/**
 * Parse a scope out of a URL's query string.
 *
 * Separate from the schema because an HTTP client sends strings and omits what it
 * does not care about, while the UI sends a complete typed object. Defaults are
 * applied here, then the result goes through the same schema the UI uses.
 */
export function parseScope(params: URLSearchParams) {
	return v.parse(scopeSchema, {
		environment: params.get('environment') ?? 'production',
		timeRange: params.get('timeRange') ?? '15m'
	});
}

export function parseDomainQuery(params: URLSearchParams) {
	return v.parse(domainQuerySchema, {
		search: params.get('search') ?? '',
		status: params.get('status') ?? 'all',
		owner: params.get('owner') ?? ALL_OWNERS,
		sort: params.get('sort') ?? 'health-score',
		page: toInteger(params.get('page'), 1),
		pageSize: toInteger(params.get('pageSize'), DEFAULT_API_PAGE_SIZE)
	});
}

/**
 * Returns the raw value when it is not an integer, so the schema reports the problem
 * rather than this helper silently substituting a default for `page=banana`.
 */
function toInteger(value: string | null, fallback: number): number | string {
	if (value === null || value.trim() === '') return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : value;
}
