import type { ServiceSnapshot } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';
import type { DeploymentSource, ServiceSource } from './source';
import { ALL_DOMAINS, ALL_ENVIRONMENTS } from '$lib/platform/deployments';
import { panel } from '../sources/panel';

/**
 * Assembles one service's overview tab.
 *
 * Takes both ports it reads from rather than resolving them, like the other
 * assemblers: the deployment history on this page is the same log the deployments
 * screen renders, narrowed to one service. Duplicating that read into the service
 * catalog would give the two screens two ways to be right about one deployment.
 */

/** Rows in the service's deployment history panel. */
export const SERVICE_DEPLOYMENT_LIMIT = 5;

/** Rows in the endpoint table. Enough to rank, few enough to read. */
export const SERVICE_ENDPOINT_LIMIT = 5;

/**
 * Returns `null` when there is no such service.
 *
 * An ordinary answer to an ordinary question — someone edited the URL — so the route
 * turns it into a 404. Throwing would make a typo look like an outage.
 */
export async function buildServiceSnapshot(
	services: ServiceSource,
	deployments: DeploymentSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<ServiceSnapshot | null> {
	const service = await services.findService(scope, slug);
	if (!service) return null;

	const [stats, checks, dependencies, requestRate, endpoints, deploymentPage] = await Promise.all([
		services.readStats(scope, slug),
		services.listHealthChecks(scope, slug),
		// A service map is a different API from metrics; a source may not have one.
		panel('apm.dependencies', async () => ({
			data: await services.readDependencies(scope, slug)
		})),
		services.readRequestRate(scope, slug),
		services.listEndpoints(scope, slug, SERVICE_ENDPOINT_LIMIT),
		deployments.queryDeployments(scope, {
			search: '',
			state: 'all',
			domain: ALL_DOMAINS,
			// An exact match, not a search: this panel is one service's history, and a
			// substring would hand it every service whose name contains this one.
			service: service.name,
			environment: ALL_ENVIRONMENTS,
			window: 'any',
			page: 1,
			pageSize: SERVICE_DEPLOYMENT_LIMIT
		})
	]);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		service,
		stats,
		checks,
		dependencies,
		deployments: deploymentPage.deployments,
		requestRate,
		endpoints
	};
}
