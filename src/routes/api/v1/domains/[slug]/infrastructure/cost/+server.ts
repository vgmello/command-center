import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toCostDto } from '$lib/server/api/v1/dto';
import { readCost, readDomain } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}/infrastructure/cost:
 *   get:
 *     summary: Read a domain's month-to-date spend
 *     description: >-
 *       Daily spend by category, with the month-to-date total and a straight-line
 *       forecast, restricted to this domain's own binding.
 *     operationId: readDomainInfrastructureCost
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
 *               $ref: '#/components/schemas/Cost'
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

		if (!(await readDomain(scope, slug))) throw new NotFoundError(`domain with id "${slug}"`);
		return toCostDto(await readCost(scope, slug));
	});
