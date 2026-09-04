import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toNodeCountsDto } from '$lib/server/api/v1/dto';
import { readNodeCounts } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/infrastructure/nodes:
 *   get:
 *     summary: Count nodes by state
 *     description: >-
 *       An aggregate, answered without returning every node.
 *     operationId: getNodeCounts
 *     tags:
 *       - Infrastructure
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
 *               $ref: '#/components/schemas/NodeCounts'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		return toNodeCountsDto(await readNodeCounts(scope));
	});
