import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toClusterDto } from '$lib/server/api/v1/dto';
import { readClusters, readDomain } from '$lib/server/platform/service';

const limitSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100));

/**
 * @swagger
 * /api/v1/domains/{slug}/infrastructure/clusters:
 *   get:
 *     summary: List a domain's clusters by load
 *     description: >-
 *       Busiest first, restricted to this domain's own binding.
 *     operationId: readDomainInfrastructureClusters
 *     tags:
 *       - Domains
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DomainSlug'
 *       - $ref: '#/components/parameters/Environment'
 *       - $ref: '#/components/parameters/TimeRange'
 *       - $ref: '#/components/parameters/Limit'
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
 *                     $ref: '#/components/schemas/Cluster'
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
		const limit = v.parse(limitSchema, Number(url.searchParams.get('limit') ?? 10));

		if (!(await readDomain(scope, slug))) throw new NotFoundError(`domain with id "${slug}"`);
		return { data: (await readClusters(scope, limit, slug)).map(toClusterDto) };
	});
