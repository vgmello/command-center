import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toDependenciesDto } from '$lib/server/api/v1/dto';
import { readServiceDependencies } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/services/{slug}/dependencies:
 *   get:
 *     summary: Get the immediate dependencies of a service
 *     description: >-
 *       One hop in each direction, not a transitive graph. The question it answers is
 *       what breaks this service and what this service breaks.
 *     operationId: getServiceDependencies
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
 *               $ref: '#/components/schemas/Dependencies'
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
		const result = await readServiceDependencies(scope, slug);

		if (result === null) throw new NotFoundError(`service with id "${slug}"`);
		return toDependenciesDto(result);
	});
