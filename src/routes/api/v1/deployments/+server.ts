import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseDeploymentQuery, parseScope } from '$lib/server/api/schemas';
import { toDeploymentPageDto } from '$lib/server/api/v1/dto';
import { readDeploymentPage } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/deployments:
 *   get:
 *     summary: List deployments
 *     description: >-
 *       Newest first. Filtering and paging are applied by the source, so a large
 *       platform never materialises more than one page.
 *     operationId: listDeployments
 *     tags:
 *       - Activity
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Environment'
 *       - $ref: '#/components/parameters/TimeRange'
 *       - $ref: '#/components/parameters/Search'
 *       - $ref: '#/components/parameters/DeploymentState'
 *       - $ref: '#/components/parameters/DeploymentDomain'
 *       - $ref: '#/components/parameters/DeploymentService'
 *       - $ref: '#/components/parameters/DeployedTo'
 *       - $ref: '#/components/parameters/DeploymentWindow'
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeploymentPage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const query = parseDeploymentQuery(url.searchParams);
		return toDeploymentPageDto(await readDeploymentPage(scope, query));
	});
