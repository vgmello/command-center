import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toActivitySummaryDto } from '$lib/server/api/v1/dto';
import { readActivitySummary } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/activity:
 *   get:
 *     summary: Summarise incident and deployment activity
 *     description: >-
 *       Open incidents and today's deployments, with how many domains each spans. One
 *       call because both come from the same activity store.
 *     operationId: getActivitySummary
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
 *               $ref: '#/components/schemas/ActivitySummary'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () =>
		toActivitySummaryDto(await readActivitySummary(parseScope(url.searchParams)))
	);
