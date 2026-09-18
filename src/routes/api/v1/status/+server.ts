import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toSystemStatusDto } from '$lib/server/api/v1/dto';
import { readSystemStatus } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/status:
 *   get:
 *     summary: Read platform status
 *     description: >-
 *       The single roll-up across every domain. The worst state wins.
 *     operationId: getSystemStatus
 *     tags:
 *       - Domains
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
 *               $ref: '#/components/schemas/SystemStatus'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () =>
		toSystemStatusDto(await readSystemStatus(parseScope(url.searchParams)))
	);
