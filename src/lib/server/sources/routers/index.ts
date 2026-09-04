import type { PlatformSource, ServiceSource } from '../../platform/source';
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
	catalog: { platform: PlatformSource; service: ServiceSource }
) {
	return {
		platform: createPlatformRouter(deps, catalog.platform),
		service: createServiceRouter(deps, catalog.service),
		deployment: createDeploymentRouter(deps),
		infrastructure: createInfrastructureRouter(deps)
	};
}
