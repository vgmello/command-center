import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toDomainDependenciesDto } from '$lib/server/api/v1/dto';
import { readDomainDependencies } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}/dependencies:
 *   get:
 *     summary: Get a domain’s dependencies
 *     description: >-
 *       One hop in each direction, and the path a failure travels between them.
 *     operationId: getDomainDependencies
 *     tags:
 *       - Domains
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DomainSlug'
 *       - $ref: '#/components/parameters/Environment'
 *       - $ref: '#/components/parameters/TimeRange'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DomainDependencies'
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
		const rows = await readDomainDependencies(scope, slug);

		if (rows === null) throw new NotFoundError(`domain with id "${slug}"`);
		return toDomainDependenciesDto(rows);
	});
