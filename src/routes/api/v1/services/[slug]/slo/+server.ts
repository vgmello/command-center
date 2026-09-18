import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toSloBudgetDto } from '$lib/server/api/v1/dto';
import { readServiceSlo } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/services/{slug}/slo:
 *   get:
 *     summary: Get a service’s error budget
 *     description: >-
 *       The availability objective and what is left of its allowance, in minutes.
 *     operationId: getServiceSlo
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
 *               $ref: '#/components/schemas/SloBudget'
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
		const rows = await readServiceSlo(scope, slug);

		if (rows === null) throw new NotFoundError(`service with id "${slug}"`);
		return toSloBudgetDto(rows);
	});
