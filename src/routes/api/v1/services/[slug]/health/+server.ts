import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toHealthCheckDto } from '$lib/server/api/v1/dto';
import { readServiceHealthChecks } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/services/{slug}/health:
 *   get:
 *     summary: List the health checks for a service
 *     description: >-
 *       The SLIs behind a service status, each as a number with its unit stated rather
 *       than as a rendered string.
 *     operationId: listServiceHealthChecks
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
 *                     $ref: '#/components/schemas/HealthCheck'
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
		const rows = await readServiceHealthChecks(scope, slug);

		if (rows === null) throw new NotFoundError(`service with id "${slug}"`);
		return { data: rows.map(toHealthCheckDto) };
	});
