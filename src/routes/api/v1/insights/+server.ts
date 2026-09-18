import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toMetricInsightDto } from '$lib/server/api/v1/dto';
import { listPlatformInsights } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/insights:
 *   get:
 *     summary: List platform-wide insights
 *     description: >-
 *       Findings across every service, derived from metrics by stated arithmetic: a
 *       reading compared against a baseline drawn from the same series. Two questions a
 *       per-service view cannot answer — which service is the outlier, and whether
 *       several moved together. An estate behaving itself returns an empty list rather
 *       than filler.
 *     operationId: listPlatformInsights
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
 *                     $ref: '#/components/schemas/MetricInsight'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const insights = await listPlatformInsights(parseScope(url.searchParams));
		return { data: insights.map(toMetricInsightDto) };
	});
