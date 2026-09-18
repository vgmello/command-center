import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toResourceUsageDto } from '$lib/server/api/v1/dto';
import { readUtilization } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/infrastructure/utilization:
 *   get:
 *     summary: Read resource utilisation
 *     description: >-
 *       CPU, memory, disk and network across the window.
 *     operationId: listUtilization
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
 *                     $ref: '#/components/schemas/ResourceUsage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		return { data: (await readUtilization(scope)).map(toResourceUsageDto) };
	});
