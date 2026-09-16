import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toRegionDto } from '$lib/server/api/v1/dto';
import { readDomain, readRegions } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}/infrastructure/regions:
 *   get:
 *     summary: List a domain's regions
 *     description: >-
 *       Where this domain's resources run, restricted to its own binding.
 *     operationId: readDomainInfrastructureRegions
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
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Region'
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
		return { data: (await readRegions(scope, slug)).map(toRegionDto) };
	});
