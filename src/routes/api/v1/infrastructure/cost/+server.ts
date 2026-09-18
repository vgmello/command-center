import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toCostDto } from '$lib/server/api/v1/dto';
import { readCost } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/infrastructure/cost:
 *   get:
 *     summary: Read month-to-date spend
 *     description: >-
 *       Daily spend by category, with the month-to-date total and a straight-line forecast.
 *     operationId: getCost
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
 *               $ref: '#/components/schemas/Cost'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		return toCostDto(await readCost(scope));
	});
