import type {
	CurrentUser,
	Deployment,
	DeploymentInsight,
	DeploymentPage,
	DeploymentSummary,
	DomainBreakdown,
	Domain,
	DomainChange,
	DomainDependencies,
	DomainPage,
	DomainVitals,
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
	InfraRegion,
	LatencyHeatmap,
	MessageQueue,
	MetricInsight,
	NodeCounts,
	RateObservation,
	ResourceUsage,
	StorageClass,
	Service,
	ServiceDependencies,
	ServiceEndpoint,
	ServiceStat,
	ServiceVitals,
	SloBudget,
	TimeSeries,
	TrendGrain
} from '$lib/platform/types';
import type { DomainQuery, PlatformScope } from '$lib/platform/query';
import type { DeploymentQuery } from '$lib/platform/deployments';
import type {
	DeploymentSource,
	InfrastructureSource,
	PlatformSource,
	ServiceSource,
	WorkspaceSource
} from './source';
import {
	CURRENT_USER,
	findDomain,
	readDomainDependencies,
	readDomainVitals,
	buildDeploymentTrends,
	buildStatusTrend,
	listDeployingDomains,
	listDeploymentInsights,
	listDeployments,
	listDomains,
	listIncidents,
	listOwners,
	listRecentChanges,
	readDeploymentBreakdown,
	readDeploymentSummary,
	readPlatformRates
} from './fixtures';
import { queryDeploymentsInMemory, queryDomainsInMemory } from './in-memory-query';
import * as estate from './infrastructure-fixtures';
import {
	findService,
	listFavorites,
	listServiceVitals,
	listEndpoints,
	listMetricInsights,
	listPlatformInsights,
	readLatencyHeatmap,
	readMetricSeries,
	readSloBudget,
	listHealthChecks,
	listServices,
	readDependencies,
	readRequestRate,
	readServiceStats
} from './service-fixtures';

/**
 * The stand-in implementation: seeded fixtures, no I/O.
 *
 * Every method is `async` even though nothing here awaits. That is the point — the
 * interface is shaped for a real backend, so the day one arrives, no caller changes.
 * A synchronous port would have forced every consumer to be rewritten instead.
 */

const INCIDENT_SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

export class FixturePlatformSource implements PlatformSource {
	readonly id = 'fixture';

	async readDomainStatusCounts(_scope: PlatformScope): Promise<DomainStatusCounts> {
		const counts: DomainStatusCounts = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
		for (const domain of listDomains()) counts[domain.status]++;
		return counts;
	}

	async queryDomains(_scope: PlatformScope, query: DomainQuery): Promise<DomainPage> {
		return queryDomainsInMemory(listDomains(), query);
	}

	async findDomain(_scope: PlatformScope, slug: string): Promise<Domain | null> {
		return findDomain(slug);
	}

	async readDomainVitals(_scope: PlatformScope, slug: string): Promise<DomainVitals | null> {
		return readDomainVitals(slug, new Date());
	}

	async readDomainDependencies(_scope: PlatformScope, slug: string): Promise<DomainDependencies> {
		return readDomainDependencies(slug);
	}

	/**
	 * The headline rates.
	 *
	 * Delegates to `readPlatformRates` in `fixtures.ts` so the class and the fixture
	 * APM provider (Task 7) read one definition instead of two copies drifting apart.
	 */
	async listPlatformInsights(scope: PlatformScope): Promise<MetricInsight[]> {
		return listPlatformInsights(scope, new Date());
	}

	async readRates(scope: PlatformScope): Promise<RateObservation[]> {
		return readPlatformRates(scope.timeRange);
	}

	async listIncidents(_scope: PlatformScope, limit: number): Promise<Incident[]> {
		return listIncidents(new Date())
			.sort(
				(a, b) =>
					INCIDENT_SEVERITY_ORDER[a.severity] - INCIDENT_SEVERITY_ORDER[b.severity] ||
					Date.parse(b.openedAt) - Date.parse(a.openedAt)
			)
			.slice(0, limit);
	}

	async listOwners(_scope: PlatformScope): Promise<FacetOption[]> {
		return listOwners();
	}

	async listRecentChanges(_scope: PlatformScope, limit: number): Promise<DomainChange[]> {
		return listRecentChanges(new Date())
			.sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt))
			.slice(0, limit);
	}
}

/**
 * The stand-in CI/CD feed.
 *
 * Separate from the platform source in the same way the interfaces are, so replacing
 * one with a real Argo or GitHub Actions adapter does not touch the other.
 */
export class FixtureDeploymentSource implements DeploymentSource {
	readonly id = 'fixture';

	async queryDeployments(_scope: PlatformScope, query: DeploymentQuery): Promise<DeploymentPage> {
		return queryDeploymentsInMemory(listDeployments(new Date()), query, new Date());
	}

	async listDeployments(_scope: PlatformScope, limit: number): Promise<Deployment[]> {
		return listDeployments(new Date()).slice(0, limit);
	}

	async readSummary(_scope: PlatformScope): Promise<DeploymentSummary> {
		return readDeploymentSummary(new Date());
	}

	async readDomainBreakdown(_scope: PlatformScope): Promise<DomainBreakdown> {
		return readDeploymentBreakdown(new Date());
	}

	async readStatusTrend(_scope: PlatformScope): Promise<TimeSeries[]> {
		return buildStatusTrend(new Date());
	}

	async readTrends(
		_scope: PlatformScope,
		grain: TrendGrain
	): Promise<{ frequency: TimeSeries; meanDuration: TimeSeries }> {
		return buildDeploymentTrends(new Date(), grain);
	}

	async listInsights(_scope: PlatformScope): Promise<DeploymentInsight[]> {
		return listDeploymentInsights(new Date());
	}

	async listDeployingDomains(_scope: PlatformScope): Promise<FacetOption[]> {
		return listDeployingDomains(new Date());
	}
}

/**
 * The stand-in estate.
 *
 * Reads through to `infrastructure-fixtures.ts`, so replacing it with a cluster API
 * adapter means deleting one file and writing another.
 */
export class FixtureInfrastructureSource implements InfrastructureSource {
	readonly id = 'fixture';

	async listGroups(_scope: PlatformScope): Promise<InfrastructureGroup[]> {
		return estate.listGroups();
	}

	async listRegions(_scope: PlatformScope): Promise<InfraRegion[]> {
		return estate.listRegions();
	}

	async readNodeCounts(_scope: PlatformScope): Promise<NodeCounts> {
		return estate.readNodeCounts();
	}

	async listClusters(_scope: PlatformScope, limit: number): Promise<ClusterLoad[]> {
		return estate.listClusters(limit);
	}

	async readUtilization(_scope: PlatformScope): Promise<ResourceUsage[]> {
		return estate.readUtilization(new Date());
	}

	async readStorage(
		_scope: PlatformScope
	): Promise<{ totalBytes: number; classes: StorageClass[] }> {
		return estate.readStorage();
	}

	async listDatabases(_scope: PlatformScope, limit: number): Promise<DatabaseInstance[]> {
		return estate.listDatabases(limit);
	}

	async listQueues(_scope: PlatformScope, limit: number): Promise<MessageQueue[]> {
		return estate.listQueues(limit);
	}

	async listAlerts(_scope: PlatformScope, limit: number): Promise<InfraAlert[]> {
		return estate.listAlerts(new Date(), limit);
	}

	async readCost(_scope: PlatformScope): Promise<CostBreakdown> {
		return estate.readCost(new Date());
	}
}

/**
 * The stand-in service catalog.
 *
 * Reads through to `service-fixtures.ts`, which is where the seeded data lives — this
 * class is only the port's shape, so replacing it with a registry adapter means
 * deleting one file and writing another.
 */
export class FixtureServiceSource implements ServiceSource {
	readonly id = 'fixture';

	async listServices(_scope: PlatformScope, domainId?: string): Promise<Service[]> {
		const all = listServices();
		return domainId ? all.filter((service) => service.domainId === domainId) : all;
	}

	async listServiceVitals(
		_scope: PlatformScope,
		domainId: string,
		vitals: DomainVitals,
		total: number
	): Promise<ServiceVitals[]> {
		return listServiceVitals(domainId, vitals, total);
	}

	async findService(_scope: PlatformScope, slug: string): Promise<Service | null> {
		return findService(slug);
	}

	async readStats(_scope: PlatformScope, slug: string): Promise<ServiceStat[]> {
		return readServiceStats(slug);
	}

	async listHealthChecks(_scope: PlatformScope, slug: string): Promise<HealthCheck[]> {
		return listHealthChecks(slug);
	}

	async readDependencies(_scope: PlatformScope, slug: string): Promise<ServiceDependencies> {
		return readDependencies(slug);
	}

	async readRequestRate(_scope: PlatformScope, slug: string): Promise<TimeSeries> {
		return readRequestRate(slug, new Date());
	}

	async listEndpoints(
		_scope: PlatformScope,
		slug: string,
		limit: number
	): Promise<ServiceEndpoint[]> {
		return listEndpoints(slug, limit);
	}

	async readMetricSeries(_scope: PlatformScope, slug: string) {
		return readMetricSeries(slug, new Date());
	}

	async readSloBudget(_scope: PlatformScope, slug: string): Promise<SloBudget> {
		return readSloBudget(slug, new Date());
	}

	async readLatencyHeatmap(_scope: PlatformScope, slug: string): Promise<LatencyHeatmap> {
		return readLatencyHeatmap(slug, new Date());
	}

	async listMetricInsights(_scope: PlatformScope, slug: string): Promise<MetricInsight[]> {
		return listMetricInsights(slug, new Date());
	}
}

/** The signed-in user and their pins, also faked until auth and preferences land. */
export class FixtureWorkspaceSource implements WorkspaceSource {
	readonly id = 'fixture';

	async readCurrentUser(): Promise<CurrentUser> {
		return CURRENT_USER;
	}

	async listFavorites(): Promise<FavoriteItem[]> {
		return listFavorites();
	}
}
