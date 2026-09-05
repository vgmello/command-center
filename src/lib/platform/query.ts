import type { EnvironmentId, TimeRangeId } from './types';

/**
 * How you ask for domains.
 *
 * The closed sets live here as `as const` arrays rather than as bare union types,
 * because two very different consumers need the same list at runtime: the Valibot
 * picklists that guard the remote endpoint, and the select controls in the toolbar.
 * Declaring the union twice is how those two silently drift apart — the UI offers a
 * sort the server rejects, and nothing catches it until someone clicks it.
 */

export const DOMAIN_SORT_KEYS = [
	'health-score',
	'error-rate',
	'p95-latency',
	'active-incidents',
	'name'
] as const;

export type DomainSortKey = (typeof DOMAIN_SORT_KEYS)[number];

export const DOMAIN_SORT_LABELS: Record<DomainSortKey, string> = {
	'health-score': 'Health Score',
	'error-rate': 'Error Rate',
	'p95-latency': 'P95 Latency',
	'active-incidents': 'Active Incidents',
	name: 'Name'
};

/** `all` is a filter value, not a health state, which is why it is not in `HealthStatus`. */
export const DOMAIN_STATUS_FILTERS = ['all', 'healthy', 'degraded', 'down', 'unknown'] as const;

export type DomainStatusFilter = (typeof DOMAIN_STATUS_FILTERS)[number];

export const DOMAIN_STATUS_FILTER_LABELS: Record<DomainStatusFilter, string> = {
	all: 'All',
	healthy: 'Healthy',
	degraded: 'Degraded',
	down: 'Down',
	unknown: 'Unknown'
};

/**
 * The owner filter's "no filter" value.
 *
 * A sentinel string rather than an empty string or `undefined`, because it travels
 * through a URL query string where all three would be indistinguishable from a team
 * literally called "". Owners are an open set, so this cannot be a picklist member.
 */
export const ALL_OWNERS = 'all';

/**
 * Rows per page the table offers.
 *
 * Every value must satisfy the `pageSize` schema's cap, which is what stops one
 * request asking an adapter for the whole table.
 */
export const DOMAIN_PAGE_SIZES = [10, 25, 50] as const;

export type DomainPageSize = (typeof DOMAIN_PAGE_SIZES)[number];

export interface SelectOption<Value extends string> {
	value: Value;
	label: string;
}

/**
 * Options for the toolbar's selects, built from the same arrays the schemas use.
 *
 * `unknown` is filtered out of the status list: nothing currently reports it, and an
 * option that always returns nothing is a dead control.
 */
export function domainSortOptions(): SelectOption<DomainSortKey>[] {
	return DOMAIN_SORT_KEYS.map((value) => ({ value, label: DOMAIN_SORT_LABELS[value] }));
}

export function domainStatusFilterOptions(): SelectOption<DomainStatusFilter>[] {
	return DOMAIN_STATUS_FILTERS.filter((value) => value !== 'unknown').map((value) => ({
		value,
		label: DOMAIN_STATUS_FILTER_LABELS[value]
	}));
}

/** Page-size options, labelled the way the control reads: "10 per page". */
export function domainPageSizeOptions(): SelectOption<string>[] {
	return DOMAIN_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} per page` }));
}

/** Filter, sort and paging state for one request for domains. Mirrors the toolbar. */
export interface DomainQuery {
	search: string;
	status: DomainStatusFilter;
	/** An owner id, or `ALL_OWNERS`. Open set, so validated as a bounded string. */
	owner: string;
	sort: DomainSortKey;
	page: number;
	pageSize: number;
}

/** Everything a source needs to know about *which* data is being asked for. */
export interface PlatformScope {
	environment: EnvironmentId;
	timeRange: TimeRangeId;
}
