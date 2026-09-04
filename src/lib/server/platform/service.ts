import type { PlatformScope, DomainQuery } from '$lib/platform/query';
import type {
	ActivitySummary,
	Deployment,
	DeploymentPage,
	DeploymentSummary,
	DeploymentsSnapshot,
	DomainChange,
	DomainPage,
	DomainStatusCounts,
	DomainsSnapshot,
	FacetOption,
	Incident,
	InfrastructureGroup,
	OverviewSnapshot,
	RateObservation,
	HealthCheck,
	Service,
	ServiceDependencies,
	ServiceEndpoint,
	ServiceSnapshot,
	SystemStatus,
	TrendGrain
} from '$lib/platform/types';
import type { DeploymentQuery } from '$lib/platform/deployments';
import { deploymentSource, platformSource, serviceSource } from './index';
import { DEPLOYMENT_LIMIT, INCIDENT_LIMIT, buildOverview, buildSystemStatus } from './snapshot';
import { RECENT_CHANGE_LIMIT, buildDomainsSnapshot } from './domains-view';
import { buildDeploymentsSnapshot } from './deployments-view';
import { buildServiceSnapshot } from './service-view';

/**
 * The application's in-process API: one function per thing a caller can ask for.
 *
 * Two transports sit on top of this module and neither knows about the other:
 *
 *   - `src/routes/overview.remote.ts` — the UI, over devalue and session cookies
 *   - `src/routes/api/v1/**\/+server.ts` — external clients, over JSON and a token
 *
 * A transport calls these functions directly. It must never reach the other
 * transport over HTTP: that would add a network hop for no reason, throw away
 * end-to-end types, and fail during SSR, where the server would be fetching itself.
 *
 * Everything here returns internal shapes. Mapping those to a frozen public
 * contract is the API transport's job (`$lib/server/api/v1/dto.ts`), so that
 * renaming a field for the UI cannot break an external consumer.
 */

export function readDomainStatusCounts(scope: PlatformScope): Promise<DomainStatusCounts> {
	return platformSource().readDomainStatusCounts(scope);
}

export function readDomainPage(scope: PlatformScope, query: DomainQuery): Promise<DomainPage> {
	return platformSource().queryDomains(scope, query);
}

export function readRates(scope: PlatformScope): Promise<RateObservation[]> {
	return platformSource().readRates(scope);
}

export function readIncidents(scope: PlatformScope, limit = INCIDENT_LIMIT): Promise<Incident[]> {
	return platformSource().listIncidents(scope, limit);
}

export function readDeployments(
	scope: PlatformScope,
	limit = DEPLOYMENT_LIMIT
): Promise<Deployment[]> {
	return deploymentSource().listDeployments(scope, limit);
}

export function readDeploymentSummary(scope: PlatformScope): Promise<DeploymentSummary> {
	return deploymentSource().readSummary(scope);
}

export function readDeploymentPage(
	scope: PlatformScope,
	query: DeploymentQuery
): Promise<DeploymentPage> {
	return deploymentSource().queryDeployments(scope, query);
}

export function readInfrastructure(scope: PlatformScope): Promise<InfrastructureGroup[]> {
	return platformSource().listInfrastructure(scope);
}

export function readFacetOptions(scope: PlatformScope): Promise<FacetOption[]> {
	return platformSource().listOwners(scope);
}

export function readRecentDomainChanges(
	scope: PlatformScope,
	limit = RECENT_CHANGE_LIMIT
): Promise<DomainChange[]> {
	return platformSource().listRecentChanges(scope, limit);
}

export function readActivitySummary(scope: PlatformScope): Promise<ActivitySummary> {
	return platformSource().readActivitySummary(scope);
}

export async function readSystemStatus(scope: PlatformScope): Promise<SystemStatus> {
	return buildSystemStatus(await readDomainStatusCounts(scope));
}

/**
 * The overview page's aggregate.
 *
 * Composed here rather than in the remote function, and deliberately *not* exposed
 * as a public endpoint: it is shaped for one screen. External clients get the
 * resources it is composed from, which stay stable while the screen changes.
 */
export function readOverview(scope: PlatformScope): Promise<OverviewSnapshot> {
	return buildOverview(platformSource(), deploymentSource(), scope);
}

/**
 * The domains page's aggregate. Screen-shaped, and unexposed for the same reason
 * `readOverview` is: external clients get the resources it is composed from, which
 * stay stable while the screen changes.
 */
export function readDomainsView(scope: PlatformScope): Promise<DomainsSnapshot> {
	return buildDomainsSnapshot(platformSource(), scope);
}

export function readServices(scope: PlatformScope): Promise<Service[]> {
	return serviceSource().listServices(scope);
}

export function readService(scope: PlatformScope, slug: string): Promise<Service | null> {
	return serviceSource().findService(scope, slug);
}

/*
 * The per-service reads each answer `null` for an unknown slug rather than an empty
 * list. "There is no such service" and "the service has no dependencies" are different
 * facts, and only one of them is a 404.
 */

export async function readServiceHealthChecks(
	scope: PlatformScope,
	slug: string
): Promise<HealthCheck[] | null> {
	const source = serviceSource();
	if (!(await source.findService(scope, slug))) return null;
	return source.listHealthChecks(scope, slug);
}

export async function readServiceDependencies(
	scope: PlatformScope,
	slug: string
): Promise<ServiceDependencies | null> {
	const source = serviceSource();
	if (!(await source.findService(scope, slug))) return null;
	return source.readDependencies(scope, slug);
}

export async function readServiceEndpoints(
	scope: PlatformScope,
	slug: string,
	limit: number
): Promise<ServiceEndpoint[] | null> {
	const source = serviceSource();
	if (!(await source.findService(scope, slug))) return null;
	return source.listEndpoints(scope, slug, limit);
}

/**
 * One service's overview tab.
 *
 * `null` when the slug matches nothing, so the route can answer 404 rather than
 * rendering a page about a service that does not exist.
 */
export function readServiceView(
	scope: PlatformScope,
	slug: string
): Promise<ServiceSnapshot | null> {
	return buildServiceSnapshot(serviceSource(), deploymentSource(), scope, slug);
}

/** The deployments page's aggregate. Screen-shaped, and unexposed for the same reason. */
export function readDeploymentsView(
	scope: PlatformScope,
	grain: TrendGrain = 'daily'
): Promise<DeploymentsSnapshot> {
	return buildDeploymentsSnapshot(deploymentSource(), scope, grain);
}
