import type { ServiceReading } from '$lib/platform/catalog-merge';
import type {
	ClusterLoad,
	CostBreakdown,
	DatabaseInstance,
	Deployment,
	DeploymentInsight,
	DeploymentPage,
	DeploymentSummary,
	DomainBreakdown,
	DomainVitals,
	ExternalLink,
	FacetOption,
	HealthCheck,
	InfraAlert,
	InfraRegion,
	Incident,
	LatencyHeatmap,
	MessageQueue,
	MetricInsight,
	NodeCounts,
	RateObservation,
	ResourceUsage,
	ServiceDependencies,
	ServiceEndpoint,
	ServiceStat,
	SloBudget,
	StorageClass,
	TimeSeries,
	TrendGrain
} from '$lib/platform/types';
import type { DeploymentQuery } from '$lib/platform/deployments';
import type { LinkView, SourceBinding, SourceContext } from './provider';

/**
 * The three kind contracts.
 *
 * Capability-backed methods are optional: Azure implements nine cloud methods and none
 * of the APM ones, and a contract that required all of them would force every provider
 * to write stubs it can never answer. `capabilities` on the definition is the declared
 * truth, and `capabilityDrift` (Task 6) checks the two match — so a provider
 * that declares `cloud.cost` and forgets `readCost` is a red test, not a runtime hole.
 */
export interface CloudProvider {
	listRegions?(ctx: SourceContext): Promise<InfraRegion[]>;
	readNodeCounts?(ctx: SourceContext): Promise<NodeCounts>;
	listClusters?(ctx: SourceContext, limit: number): Promise<ClusterLoad[]>;
	readUtilization?(ctx: SourceContext): Promise<ResourceUsage[]>;
	readStorage?(ctx: SourceContext): Promise<{ totalBytes: number; classes: StorageClass[] }>;
	listDatabases?(ctx: SourceContext, limit: number): Promise<DatabaseInstance[]>;
	listQueues?(ctx: SourceContext, limit: number): Promise<MessageQueue[]>;
	listAlerts?(ctx: SourceContext, limit: number): Promise<InfraAlert[]>;
	readCost?(ctx: SourceContext): Promise<CostBreakdown>;
	/** Where this resource lives in the provider's own console. */
	resourceLink(binding: SourceBinding | undefined, view: LinkView): ExternalLink | null;
}

export interface ApmProvider {
	readServiceStats?(ctx: SourceContext): Promise<ServiceStat[]>;
	listHealthChecks?(ctx: SourceContext): Promise<HealthCheck[]>;
	readServiceDependencies?(ctx: SourceContext): Promise<ServiceDependencies>;
	readRequestRate?(ctx: SourceContext): Promise<TimeSeries>;
	listEndpoints?(ctx: SourceContext, limit: number): Promise<ServiceEndpoint[]>;
	readMetricSeries?(ctx: SourceContext): Promise<{
		requestRate: TimeSeries;
		p95Latency: TimeSeries;
		errorRate: TimeSeries;
		saturation: TimeSeries[];
		byEndpoint: TimeSeries[];
		byInstance: TimeSeries[];
	}>;
	readSloBudget?(ctx: SourceContext): Promise<SloBudget>;
	readLatencyHeatmap?(ctx: SourceContext): Promise<LatencyHeatmap>;
	listMetricInsights?(ctx: SourceContext): Promise<MetricInsight[]>;
	/**
	 * Findings across every service, which a per-service read cannot produce.
	 *
	 * A service can sit well inside its own range and still be the worst in the estate,
	 * and several services moving together is a different event from one moving alone.
	 * Both are questions about the fleet, so they are asked of the fleet.
	 */
	listPlatformInsights?(ctx: SourceContext): Promise<MetricInsight[]>;

	/**
	 * A reading per service, for every service at once.
	 *
	 * The catalog says which services exist; this says how each is doing, and the two are
	 * joined above. One call rather than one per service: a table of forty rows must not
	 * be forty round trips, and the readings would otherwise come from forty slightly
	 * different moments.
	 */
	readServiceHealth?(ctx: SourceContext): Promise<ServiceReading[]>;
	readDomainVitals?(ctx: SourceContext): Promise<DomainVitals | null>;
	readRates?(ctx: SourceContext): Promise<RateObservation[]>;
	listIncidents?(ctx: SourceContext, limit: number): Promise<Incident[]>;
	resourceLink(binding: SourceBinding | undefined, view: LinkView): ExternalLink | null;
}

export interface DeploymentProvider {
	queryDeployments?(ctx: SourceContext, query: DeploymentQuery): Promise<DeploymentPage>;
	listDeployments?(ctx: SourceContext, limit: number): Promise<Deployment[]>;
	readSummary?(ctx: SourceContext): Promise<DeploymentSummary>;
	readDomainBreakdown?(ctx: SourceContext): Promise<DomainBreakdown>;
	readStatusTrend?(ctx: SourceContext): Promise<TimeSeries[]>;
	readTrends?(
		ctx: SourceContext,
		grain: TrendGrain
	): Promise<{ frequency: TimeSeries; meanDuration: TimeSeries }>;
	listInsights?(ctx: SourceContext): Promise<DeploymentInsight[]>;
	listDeployingDomains?(ctx: SourceContext): Promise<FacetOption[]>;
	resourceLink(binding: SourceBinding | undefined, view: LinkView): ExternalLink | null;
}

export type AnyProvider = CloudProvider | ApmProvider | DeploymentProvider;
