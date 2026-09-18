import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toServiceVitalsDto } from '$lib/server/api/v1/dto';
import { readDomainServices } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}/services:
 *   get:
 *     summary: List a domain’s services
 *     description: >-
 *       Every service the domain runs, with the readings behind its health.
 *     operationId: listDomainServices
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
 *                     $ref: '#/components/schemas/ServiceVitals'
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
		const rows = await readDomainServices(scope, slug);

		if (rows === null) throw new NotFoundError(`domain with id "${slug}"`);
		return { data: rows.map(toServiceVitalsDto) };
	});
