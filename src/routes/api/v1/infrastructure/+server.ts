import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toInfrastructureDto } from '$lib/server/api/v1/dto';
import { readInfrastructure } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/infrastructure:
 *   get:
 *     summary: Summarise infrastructure
 *     description: Counts by kind, with the rolled-up status of each.
 *     operationId: listInfrastructure
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
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Infrastructure'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const groups = await readInfrastructure(parseScope(url.searchParams));
		return { data: groups.map(toInfrastructureDto) };
	});
