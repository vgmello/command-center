import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toDomainSummaryDto } from '$lib/server/api/v1/dto';
import { readDomainStatusCounts } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/summary:
 *   get:
 *     summary: Count domains by status
 *     description: An aggregate, answered without returning the domains themselves.
 *     operationId: getDomainSummary
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
 *               $ref: '#/components/schemas/DomainSummary'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () =>
		toDomainSummaryDto(await readDomainStatusCounts(parseScope(url.searchParams)))
	);
