import type {
	ActivitySummary,
	CurrentUser,
	DeploymentInsight,
	DeploymentPage,
	DeploymentSummary,
	Deployment,
	DomainBreakdown,
	DomainChange,
	DomainPage,
	DomainStatusCounts,
	FacetOption,
	FavoriteItem,
	Incident,
	InfrastructureGroup,
	RateObservation,
	TimeSeries,
	TrendGrain
} from '$lib/platform/types';
import type { DomainQuery, PlatformScope } from '$lib/platform/query';
import type { DeploymentQuery } from '$lib/platform/deployments';

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

	/** Infrastructure counts by kind. */
	listInfrastructure(scope: PlatformScope): Promise<InfrastructureGroup[]>;

	/**
	 * The teams that own domains, with how many each owns.
	 *
	 * A read rather than a constant because owners are org data: teams are created,
	 * merged and renamed without a deploy. A hardcoded list would offer a filter that
	 * matches nothing the week after a reorg.
	 */
	listOwners(scope: PlatformScope): Promise<FacetOption[]>;

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
 * What has shipped, and how it went.
 *
 * A third port rather than more methods on `PlatformSource`, for the same reason
 * `WorkspaceSource` is separate: this data comes from a CI/CD system, which is a
 * different upstream on a different release cycle from the telemetry pipeline and
 * will be replaced independently of it. Folding the two together would force a
 * change to either to move both, and would push `PlatformSource` past the point
 * where its method list still describes one responsibility.
 *
 * The same two rules shape it: ask for the answer rather than the rows, and push
 * filtering and paging down.
 */
export interface DeploymentSource {
	readonly id: string;

	/** One page of deployments, already filtered and sliced by the source. */
	queryDeployments(scope: PlatformScope, query: DeploymentQuery): Promise<DeploymentPage>;

	/** Most recent deployments, newest first. Feeds the overview and the recent strip. */
	listDeployments(scope: PlatformScope, limit: number): Promise<Deployment[]>;

	/**
	 * The period's counts and rates in one call.
	 *
	 * One aggregation over one set of runs. Six separate reads would make an adapter
	 * scan the same rows six times to answer questions that always render together.
	 */
	readSummary(scope: PlatformScope): Promise<DeploymentSummary>;

	/** Deployments per domain, for the donut and its legend. */
	readDomainBreakdown(scope: PlatformScope): Promise<DomainBreakdown>;

	/** Successful / in-progress / failed plotted across the scope's window. */
	readStatusTrend(scope: PlatformScope): Promise<TimeSeries[]>;

	/**
	 * Deployment count and mean duration over time, at the requested grain.
	 *
	 * Both in one call because they are the same bucketing of the same runs, differing
	 * only in what is measured per bucket.
	 */
	readTrends(
		scope: PlatformScope,
		grain: TrendGrain
	): Promise<{ frequency: TimeSeries; meanDuration: TimeSeries }>;

	/** Patterns worth flagging: failure rate, slow services, repeat offenders. */
	listInsights(scope: PlatformScope): Promise<DeploymentInsight[]>;

	/** The domain filter's options, counted over deployments rather than domains. */
	listDeployingDomains(scope: PlatformScope): Promise<FacetOption[]>;
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
