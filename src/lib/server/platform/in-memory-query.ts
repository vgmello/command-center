import type {
	Criticality,
	Deployment,
	DeploymentPage,
	Domain,
	DomainPage
} from '$lib/platform/types';
import {
	ALL_DOMAINS,
	ALL_ENVIRONMENTS,
	ALL_SERVICES,
	DEPLOYMENT_WINDOW_DAYS,
	matchesDeploymentState,
	type DeploymentQuery
} from '$lib/platform/deployments';
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

	return sliceToPage(sorted, query.page, query.pageSize, (domains, page) => ({ domains, page }));
}

/**
 * Filter and slice a deployment log in memory.
 *
 * The same strategy as `queryDomainsInMemory`, and the same caveat: one adapter's
 * approach, not a rule. No sort argument, because a deployment log has exactly one
 * useful order — newest first — and the source hands it over already in it.
 */
export function queryDeploymentsInMemory(
	deployments: Deployment[],
	query: DeploymentQuery,
	now: Date = new Date()
): DeploymentPage {
	const needle = query.search.trim().toLowerCase();
	const days = DEPLOYMENT_WINDOW_DAYS[query.window];
	const since = days === null ? null : now.getTime() - days * 86_400_000;

	const filtered = deployments.filter((deployment) => {
		if (!matchesDeploymentState(deployment.status, query.state)) return false;
		if (query.domain !== ALL_DOMAINS && deployment.domainId !== query.domain) return false;
		if (query.service !== ALL_SERVICES && deployment.service !== query.service) return false;
		if (query.environment !== ALL_ENVIRONMENTS && deployment.environment !== query.environment) {
			return false;
		}
		if (since !== null && Date.parse(deployment.deployedAt) < since) return false;
		if (!needle) return true;
		return (
			deployment.service.toLowerCase().includes(needle) ||
			deployment.version.toLowerCase().includes(needle) ||
			deployment.reference.includes(needle) ||
			deployment.domainName.toLowerCase().includes(needle)
		);
	});

	return sliceToPage(filtered, query.page, query.pageSize, (slice, page) => ({
		deployments: slice,
		page
	}));
}

/**
 * The paging arithmetic both queries share.
 *
 * Clamping the requested page to what exists is the part worth having in one place:
 * a filter that shrinks the result set below the current page must land on the last
 * page, not on an empty one that looks like "no results".
 */
function sliceToPage<Row, Result>(
	rows: Row[],
	requestedPage: number,
	requestedSize: number,
	build: (slice: Row[], page: DomainPage['page']) => Result
): Result {
	const pageSize = Math.max(1, requestedSize);
	const totalItems = rows.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const page = Math.min(Math.max(1, requestedPage), totalPages);
	const offset = (page - 1) * pageSize;
	const slice = rows.slice(offset, offset + pageSize);

	return build(slice, {
		page,
		pageSize,
		totalItems,
		totalPages,
		from: totalItems === 0 ? 0 : offset + 1,
		to: offset + slice.length
	});
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
