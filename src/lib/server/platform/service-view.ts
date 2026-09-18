import type { ServiceSnapshot, ServiceStat } from '$lib/platform/types';
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

	// Every source-backed read wrapped, not just dependencies. That one was wrapped first
	// because a service map is a different API from metrics and a source may not have
	// one; the rest were left bare, which is the same latent bug the deployments and
	// infrastructure screens already had — one declined capability must cost this page a
	// panel, not the whole page.
	const [statsPanel, checks, dependencies, requestRate, endpoints, deploymentsPanel] =
		await Promise.all([
			panel('apm.serviceStats', async () => ({ data: await services.readStats(scope, slug) })),
			panel('apm.healthChecks', async () => ({
				data: await services.listHealthChecks(scope, slug)
			})),
			panel('apm.dependencies', async () => ({
				data: await services.readDependencies(scope, slug)
			})),
			panel('apm.requestRate', async () => ({
				data: await services.readRequestRate(scope, slug)
			})),
			panel('apm.endpoints', async () => ({
				data: await services.listEndpoints(scope, slug, SERVICE_ENDPOINT_LIMIT)
			})),
			panel('deployment.log', async () => ({
				data: (
					await deployments.queryDeployments(scope, {
						search: '',
						state: 'all',
						domain: ALL_DOMAINS,
						// An exact match, not a search: this panel is one service's history, and
						// a substring would hand it every service whose name contains this one.
						service: service.name,
						environment: ALL_ENVIRONMENTS,
						window: 'any',
						page: 1,
						pageSize: SERVICE_DEPLOYMENT_LIMIT
					})
				).deployments
			}))
		]);

	return {
		generatedAt: now.toISOString(),
		environment: scope.environment,
		timeRange: scope.timeRange,
		service,
		stats: statsPanel.status === 'ok' ? statsPanel.data : unreportedServiceStats(),
		checks,
		dependencies,
		deployments: deploymentsPanel,
		requestRate,
		endpoints
	};
}

/** What the stat strip says when nothing measures this service. */
function unreportedServiceStats(): ServiceStat[] {
	return [
		{
			kind: 'note',
			id: 'unreported',
			label: 'Service Health',
			formatted: 'Not reported',
			caption: 'No connected APM source measures this service.',
			tone: null,
			icon: 'circle-help'
		}
	];
}
