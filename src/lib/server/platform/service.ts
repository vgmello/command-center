import type { PlatformScope, DomainQuery } from '$lib/platform/query';
import type {
	ActivitySummary,
	Deployment,
	DomainChange,
	DomainOwner,
	DomainPage,
	DomainStatusCounts,
	DomainsSnapshot,
	Incident,
	InfrastructureGroup,
	OverviewSnapshot,
	RateObservation,
	SystemStatus
} from '$lib/platform/types';
import { platformSource } from './index';
import { DEPLOYMENT_LIMIT, INCIDENT_LIMIT, buildOverview, buildSystemStatus } from './snapshot';
import { RECENT_CHANGE_LIMIT, buildDomainsSnapshot } from './domains-view';

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
	return platformSource().listDeployments(scope, limit);
}

export function readInfrastructure(scope: PlatformScope): Promise<InfrastructureGroup[]> {
	return platformSource().listInfrastructure(scope);
}

export function readDomainOwners(scope: PlatformScope): Promise<DomainOwner[]> {
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
	return buildOverview(platformSource(), scope);
}

/**
 * The domains page's aggregate. Screen-shaped, and unexposed for the same reason
 * `readOverview` is: external clients get the resources it is composed from, which
 * stay stable while the screen changes.
 */
export function readDomainsView(scope: PlatformScope): Promise<DomainsSnapshot> {
	return buildDomainsSnapshot(platformSource(), scope);
}
