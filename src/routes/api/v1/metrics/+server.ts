import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toMetricDto } from '$lib/server/api/v1/dto';
import { readRates } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/metrics:
 *   get:
 *     summary: Read headline metrics
 *     description: >-
 *       `kind` says what the number is and `polarity` says whether an increase is
 *       good news. Neither is inferable from the value.
 *     operationId: listMetrics
 *     tags:
 *       - Metrics
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
 *                     $ref: '#/components/schemas/Metric'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const rates = await readRates(parseScope(url.searchParams));
		return { data: rates.map(toMetricDto) };
	});
