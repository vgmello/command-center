import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toMetricInsightDto } from '$lib/server/api/v1/dto';
import { readServiceInsights } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/services/{slug}/insights:
 *   get:
 *     summary: List a service’s metric insights
 *     description: >-
 *       Readings outside their normal range, and movements merely worth knowing.
 *     operationId: listServiceInsights
 *     tags:
 *       - Services
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ServiceSlug'
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
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
export const GET: RequestHandler = async ({ url, params, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const slug = v.parse(serviceSlugSchema, params.slug);
		const rows = await readServiceInsights(scope, slug);

		if (rows === null) throw new NotFoundError(`service with id "${slug}"`);
		return { data: rows.map(toMetricInsightDto) };
	});
