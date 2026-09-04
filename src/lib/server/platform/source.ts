import type {
	ActivitySummary,
	CurrentUser,
	Deployment,
	DomainChange,
	DomainOwner,
	DomainPage,
	DomainStatusCounts,
	FavoriteItem,
	Incident,
	InfrastructureGroup,
	RateObservation
} from '$lib/platform/types';
import type { DomainQuery, PlatformScope } from '$lib/platform/query';

/**
 * The seam between this app and wherever the observations actually come from.
 *
 * Everything above this interface — the snapshot assembler, the remote functions,
 * every component — depends on the capability, not on the implementation. Plugging
 * in real telemetry means writing one more implementation and pointing the resolver
 * at it; nothing above changes.
 *
 * Two rules shaped the method list:
 *
 *  - **Ask for the answer, not the raw rows.** `readDomainStatusCounts` returns
 *    counts rather than every domain, because a real backend answers that with one
 *    aggregate query. Pulling ten thousand rows to count four statuses in JavaScript
 *    is a fixture's habit, not a contract.
 *  - **Push filtering, sorting and paging down.** `queryDomains` takes the whole
 *    query so a SQL or API adapter can translate it. Doing it in memory above the
 *    interface would force every adapter to over-fetch.
 *
 * Methods return facts. Formatting, deriving status from score, rolling counts into
 * percentages — all of that stays in the pure layer above.
 */
export interface PlatformSource {
	/** Identifies the implementation in logs and in the health endpoint. */
	readonly id: string;

	/** Domains per status across the whole scope. Feeds the count tiles and the donut. */
	readDomainStatusCounts(scope: PlatformScope): Promise<DomainStatusCounts>;

	/** One page of domains, already filtered, sorted and sliced by the source. */
	queryDomains(scope: PlatformScope, query: DomainQuery): Promise<DomainPage>;

	/** Headline rates, as observed. The pure layer decides how they are printed. */
	readRates(scope: PlatformScope): Promise<RateObservation[]>;

	/** Most recent open incidents, worst first. */
	listIncidents(scope: PlatformScope, limit: number): Promise<Incident[]>;

	/** Most recent deployments, newest first. */
	listDeployments(scope: PlatformScope, limit: number): Promise<Deployment[]>;

	/** Infrastructure counts by kind. */
	listInfrastructure(scope: PlatformScope): Promise<InfrastructureGroup[]>;

	/**
	 * The teams that own domains, with how many each owns.
	 *
	 * A read rather than a constant because owners are org data: teams are created,
	 * merged and renamed without a deploy. A hardcoded list would offer a filter that
	 * matches nothing the week after a reorg.
	 */
	listOwners(scope: PlatformScope): Promise<DomainOwner[]>;

	/** Domains whose health score moved most recently, newest first. */
	listRecentChanges(scope: PlatformScope, limit: number): Promise<DomainChange[]>;

	/**
	 * Incident and deployment activity as counts.
	 *
	 * One call for both because the two tiles it feeds always render together, and
	 * because a backend answers them from the same activity store. Splitting it would
	 * buy an adapter nothing and cost it a second round trip.
	 */
	readActivitySummary(scope: PlatformScope): Promise<ActivitySummary>;
}

/**
 * Who is looking, and what they pinned.
 *
 * Deliberately a second interface. This data comes from authentication and a
 * preferences store — a different upstream on a different release cycle from the
 * telemetry pipeline, and it will be replaced independently of it. One combined
 * interface would force both to move together.
 */
export interface WorkspaceSource {
	readonly id: string;
	readCurrentUser(): Promise<CurrentUser>;
	listFavorites(): Promise<FavoriteItem[]>;
}
