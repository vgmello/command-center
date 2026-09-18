import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toDomainDto } from '$lib/server/api/v1/dto';
import { readDomain } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}:
 *   get:
 *     summary: Get one domain
 *     description: >-
 *       The row a single domain occupies, addressed by its identifier.
 *     operationId: getDomain
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
 *               $ref: '#/components/schemas/Domain'
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
		const rows = await readDomain(scope, slug);

		if (rows === null) throw new NotFoundError(`domain with id "${slug}"`);
		return toDomainDto(rows);
	});
