import type { Criticality, Domain, DomainPage } from '$lib/platform/types';
import { ALL_OWNERS, type DomainQuery } from '$lib/platform/query';

/**
 * Filter, sort and slice a domain list in memory.
 *
 * This is one adapter's *strategy*, not a shared rule: a database-backed source
 * would express the same query as SQL and never load the full list. It lives here
 * so any in-memory implementation — fixtures now, a cached snapshot later — can
 * reuse it, and so it can be tested without a source at all.
 */

/** Attention order: a mission-critical wobble outranks a standard-tier outage. */
const CRITICALITY_WEIGHT: Record<Criticality, number> = {
	'mission-critical': 0,
	'business-critical': 1,
	important: 2,
	standard: 3
};

export function queryDomainsInMemory(domains: Domain[], query: DomainQuery): DomainPage {
	const needle = query.search.trim().toLowerCase();

	const filtered = domains.filter((domain) => {
		if (query.status !== 'all' && domain.status !== query.status) return false;
		if (query.owner !== ALL_OWNERS && domain.owner !== query.owner) return false;
		if (!needle) return true;
		return (
			domain.name.toLowerCase().includes(needle) ||
			domain.slug.includes(needle) ||
			domain.owner.toLowerCase().includes(needle)
		);
	});

	const sorted = [...filtered].sort(comparatorFor(query.sort));

	const pageSize = Math.max(1, query.pageSize);
	const totalItems = sorted.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const page = Math.min(Math.max(1, query.page), totalPages);
	const offset = (page - 1) * pageSize;
	const slice = sorted.slice(offset, offset + pageSize);

	return {
		domains: slice,
		page: {
			page,
			pageSize,
			totalItems,
			totalPages,
			from: totalItems === 0 ? 0 : offset + 1,
			to: offset + slice.length
		}
	};
}

function comparatorFor(sort: DomainQuery['sort']): (a: Domain, b: Domain) => number {
	switch (sort) {
		case 'error-rate':
			return (a, b) => b.errorRatePct - a.errorRatePct;
		case 'p95-latency':
			return (a, b) => b.p95LatencyMs - a.p95LatencyMs;
		case 'active-incidents':
			return (a, b) => b.activeIncidents - a.activeIncidents || a.healthScore - b.healthScore;
		case 'name':
			return (a, b) => a.name.localeCompare(b.name);
		case 'health-score':
		default:
			// Criticality-weighted: a mission-critical domain at 74 is a bigger problem
			// than a standard-tier one at 38, so the tier leads and the score breaks ties.
			return (a, b) =>
				CRITICALITY_WEIGHT[a.criticality] - CRITICALITY_WEIGHT[b.criticality] ||
				a.healthScore - b.healthScore;
	}
}
