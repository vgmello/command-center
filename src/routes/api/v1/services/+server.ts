import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toServiceDto } from '$lib/server/api/v1/dto';
import { readServices } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/services:
 *   get:
 *     summary: List services
 *     description: Every deployable unit in the catalog, with its owner and current health.
 *     operationId: listServices
 *     tags:
 *       - Services
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
 *                     $ref: '#/components/schemas/Service'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => ({
		data: (await readServices(parseScope(url.searchParams))).map(toServiceDto)
	}));
