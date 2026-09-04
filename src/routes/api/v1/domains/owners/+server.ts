import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toFacetDto } from '$lib/server/api/v1/dto';
import { readFacetOptions } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/owners:
 *   get:
 *     summary: List domain owners
 *     description: >-
 *       The teams that own domains, with how many each owns. Read rather than fixed,
 *       because teams are created, merged and renamed without a deploy.
 *     operationId: listDomainOwners
 *     tags:
 *       - Domains
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *                     $ref: '#/components/schemas/Facet'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => ({
		data: (await readFacetOptions(parseScope(url.searchParams))).map(toFacetDto)
	}));
