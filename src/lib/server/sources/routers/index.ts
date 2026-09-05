import type { PlatformSource } from '../../platform/source';
import type { CatalogSource } from '../../catalog/source';
import { createDeploymentRouter } from './deployment';
import { createInfrastructureRouter } from './infrastructure';
import { createPlatformRouter } from './platform';
import { createServiceRouter } from './service';
import type { RouterDeps } from './shared';

export {
	createDeploymentRouter,
	createInfrastructureRouter,
	createPlatformRouter,
	createServiceRouter
};
export type { RouterDeps } from './shared';

/**
 * Every router, sharing one registry, dispatcher and cache.
 *
 * One cache across all four is deliberate: two screens asking different ports for the
 * same capability should still issue one call.
 */
export function createRouters(
	deps: RouterDeps,
	catalog: { platform: PlatformSource; services: CatalogSource }
) {
	return {
		platform: createPlatformRouter(deps, catalog.platform, catalog.services),
		service: createServiceRouter(deps, catalog.services),
		deployment: createDeploymentRouter(deps),
		infrastructure: createInfrastructureRouter(deps)
	};
}
