import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toRegionDto } from '$lib/server/api/v1/dto';
import { readRegions } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/infrastructure/regions:
 *   get:
 *     summary: List regions
 *     description: >-
 *       Where the estate runs, with coordinates so a caller can place each one.
 *     operationId: listRegions
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
 *                     $ref: '#/components/schemas/Region'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		return { data: (await readRegions(scope)).map(toRegionDto) };
	});
