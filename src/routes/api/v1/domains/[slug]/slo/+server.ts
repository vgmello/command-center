import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse, requirePanel } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toServiceSloRowDto } from '$lib/server/api/v1/dto';
import { readDomainSlos } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}/slo:
 *   get:
 *     summary: A domain's SLO compliance and its per-service budgets
 *     description: >-
 *       The domain's stated compliance, taken whole from the same read the domain
 *       header prints rather than recomputed from the rows below it, plus the error
 *       budget behind each service this domain runs.
 *     operationId: readDomainSlo
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
 *               required: [headline, services]
 *               properties:
 *                 headline:
 *                   type: object
 *                   required: [compliancePct, windowLabel]
 *                   properties:
 *                     compliancePct:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 100
 *                     windowLabel:
 *                       type: string
 *                       description: >-
 *                         What the compliance figure actually measures, e.g.
 *                         "Availability (30d rolling)".
 *                 services:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServiceSloRow'
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
		const snapshot = await readDomainSlos(scope, slug);

		if (snapshot === null) throw new NotFoundError(`domain with id "${slug}"`);

		// Both fields are `Panel`s: `requirePanel` throws the sentinel `panel()` caught
		// for either gap, so a caller is owed 501/502 rather than an empty `services` row
		// standing in for "this domain runs no services", which is a different and false
		// statement from "nothing told us which services it runs".
		return {
			headline: requirePanel(snapshot.headline),
			services: requirePanel(snapshot.services).map(toServiceSloRowDto)
		};
	});
