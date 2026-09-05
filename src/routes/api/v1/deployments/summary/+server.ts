import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toDeploymentSummaryDto } from '$lib/server/api/v1/dto';
import { readDeploymentSummary } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/deployments/summary:
 *   get:
 *     summary: Summarise deployment activity
 *     description: >-
 *       Counts, mean duration and change failure rate for the period, answered from one
 *       aggregation rather than by returning the runs themselves.
 *     operationId: getDeploymentSummary
 *     tags:
 *       - Activity
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Environment'
 *       - $ref: '#/components/parameters/TimeRange'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeploymentSummary'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () =>
		toDeploymentSummaryDto(await readDeploymentSummary(parseScope(url.searchParams)))
	);
