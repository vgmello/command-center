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
	ClusterLoad,
	CostBreakdown,
	DatabaseInstance,
	HealthCheck,
	InfraAlert,
	LatencyHeatmap,
	MetricInsight,
	InfraRegion,
	MessageQueue,
	NodeCounts,
	RateObservation,
	ResourceUsage,
	Service,
	ServiceDependencies,
	ServiceStat,
	SloBudget,
	StorageClass,
	ServiceEndpoint,
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
 * The service catalog, and what each service is currently doing.
 *
 * A fourth port for the same reason there is a third: a catalog entry — owner, repo,
 * runbook, language — comes from a service registry, not from a metrics pipeline. The
 * two are queried together on this screen and maintained by different teams with
 * different release cadences, which is exactly the case for keeping them separable.
 *
 * A real implementation may well stitch a registry and a metrics backend together
 * behind this interface. That is the point: the stitching is the adapter's problem,
 * not every caller's.
 */
export interface ServiceSource {
	readonly id: string;

	/** Every service, newest catalog entry order. Feeds the index and the sidebar pins. */
	listServices(scope: PlatformScope): Promise<Service[]>;

	/**
	 * One service by slug, or `null` when there is no such service.
	 *
	 * `null` rather than a throw: "no service called this" is an ordinary answer to an
	 * ordinary question — someone edited a URL — and the route turns it into a 404.
	 * A thrown error would make a typo look like an outage.
	 */
	findService(scope: PlatformScope, slug: string): Promise<Service | null>;

	/** The header strip: availability, rates, instances, alerts. */
	readStats(scope: PlatformScope, slug: string): Promise<ServiceStat[]>;

	/** The SLI table, each with its recent shape. */
	listHealthChecks(scope: PlatformScope, slug: string): Promise<HealthCheck[]>;

	/** One hop each way. Not a transitive graph — see `ServiceDependencies`. */
	readDependencies(scope: PlatformScope, slug: string): Promise<ServiceDependencies>;

	/** Requests per second across the scope's window. */
	readRequestRate(scope: PlatformScope, slug: string): Promise<TimeSeries>;

	/** Slowest endpoints first, already ranked and shared out by the source. */
	listEndpoints(scope: PlatformScope, slug: string, limit: number): Promise<ServiceEndpoint[]>;

	/**
	 * The metrics tab's series, in one call.
	 *
	 * Six series drawn from the same window over the same service. Separate reads would
	 * let two charts on one screen describe different minutes, which is the whole
	 * failure a dashboard exists to avoid.
	 */
	readMetricSeries(
		scope: PlatformScope,
		slug: string
	): Promise<{
		requestRate: TimeSeries;
		p95Latency: TimeSeries;
		errorRate: TimeSeries;
		saturation: TimeSeries[];
		byEndpoint: TimeSeries[];
		byInstance: TimeSeries[];
	}>;

	/** The availability objective and what is left of its budget. */
	readSloBudget(scope: PlatformScope, slug: string): Promise<SloBudget>;

	/** P95 bucketed by time and band, with the bands it was bucketed against. */
	readLatencyHeatmap(scope: PlatformScope, slug: string): Promise<LatencyHeatmap>;

	/** Movements worth a reader's attention: anomalies, and merely notable changes. */
	listMetricInsights(scope: PlatformScope, slug: string): Promise<MetricInsight[]>;
}

/**
 * The estate the platform runs on.
 *
 * A fifth port, and the reasoning has not changed: nodes and clusters come from a
 * cluster API, utilisation from a metrics backend, spend from a billing export. They
 * are queried together by one screen and owned by different teams, which is the case
 * for a seam rather than for more methods on a port about business domains.
 *
 * Spend sits here rather than in a port of its own because it is a property of the
 * estate and is read on the same screen. If a finance surface ever wants it on its own
 * terms — budgets, chargeback, per-team allocation — that is when it earns a seam.
 */
export interface InfrastructureSource {
	readonly id: string;

	/** Counts by kind: clusters, nodes, databases, queues. The overview's summary. */
	listGroups(scope: PlatformScope): Promise<InfrastructureGroup[]>;

	/** Where the estate runs, with coordinates so a map can place each region. */
	listRegions(scope: PlatformScope): Promise<InfraRegion[]>;

	/** Nodes per state. An aggregate, not a list of every node. */
	readNodeCounts(scope: PlatformScope): Promise<NodeCounts>;

	/** Busiest clusters first, already ranked by the source. */
	listClusters(scope: PlatformScope, limit: number): Promise<ClusterLoad[]>;

	/** CPU, memory, disk and network across the scope's window. */
	readUtilization(scope: PlatformScope): Promise<ResourceUsage[]>;

	/** Stored bytes by class, with the total the donut prints in its middle. */
	readStorage(scope: PlatformScope): Promise<{ totalBytes: number; classes: StorageClass[] }>;

	listDatabases(scope: PlatformScope, limit: number): Promise<DatabaseInstance[]>;

	listQueues(scope: PlatformScope, limit: number): Promise<MessageQueue[]>;

	/** Alerts raised against infrastructure rather than against a business domain. */
	listAlerts(scope: PlatformScope, limit: number): Promise<InfraAlert[]>;

	/** Month-to-date spend by category, with the daily series behind it. */
	readCost(scope: PlatformScope): Promise<CostBreakdown>;
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
