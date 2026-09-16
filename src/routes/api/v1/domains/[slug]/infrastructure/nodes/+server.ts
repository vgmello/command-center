import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toNodeCountsDto } from '$lib/server/api/v1/dto';
import { readDomain, readNodeCounts } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}/infrastructure/nodes:
 *   get:
 *     summary: Count a domain's nodes by state
 *     description: >-
 *       An aggregate over this domain's own binding, answered without returning every
 *       node.
 *     operationId: readDomainInfrastructureNodes
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
 *               $ref: '#/components/schemas/NodeCounts'
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
		return toNodeCountsDto(await readNodeCounts(scope, slug));
	});
