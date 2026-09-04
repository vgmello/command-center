import { query } from '$app/server';
import { scopedDeploymentQuerySchema, scopedTrendSchema } from '$lib/server/api/schemas';
import { readDeploymentPage, readDeploymentsView } from '$lib/server/platform/service';

/*
 * The deployments screen's transport.
 *
 * Public HTTP endpoints, so every argument is validated against the same schemas the
 * JSON API uses. Each calls the service in process rather than fetching `/api/v1/*`,
 * which would add a hop, throw away end-to-end types and fail during SSR.
 */

/**
 * One page of the deployment log.
 *
 * Its own query so switching tabs or typing in the search box refetches eight rows
 * rather than three charts, a donut and the recent-services strip as well.
 */
export const getDeploymentPage = query(scopedDeploymentQuerySchema, async ({ scope, query }) =>
	readDeploymentPage(scope, query)
);

/**
 * Everything on the deployments page except the table.
 *
 * The grain is an argument rather than a separate query for the two trend charts:
 * both charts bucket the same runs the same way, so a grain change is one refetch,
 * and splitting them would make the pair briefly disagree about the period they show.
 */
export const getDeploymentsView = query(
	scopedTrendSchema,
	async ({ environment, timeRange, grain }) =>
		readDeploymentsView({ environment, timeRange }, grain)
);
