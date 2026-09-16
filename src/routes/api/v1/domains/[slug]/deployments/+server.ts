import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { NotFoundError, apiResponse, requirePanel } from '$lib/server/api/respond';
import { parseScope, serviceSlugSchema } from '$lib/server/api/schemas';
import { toDomainDeploymentStatsDto } from '$lib/server/api/v1/dto';
import { readDomainDeployments } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains/{slug}/deployments:
 *   get:
 *     summary: A domain's deployment figures
 *     description: >-
 *       The DORA figures summed from the services this domain owns, plus the
 *       worst-first breakdown by service. The domain's recent runs are not repeated
 *       here — list them from `/api/v1/deployments` with a `domain` filter, which
 *       stays the one place a run travels.
 *     operationId: readDomainDeployments
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
 *               required: [windowLabel, stats]
 *               properties:
 *                 windowLabel:
 *                   type: string
 *                   description: >-
 *                     The window the figures cover, which is the trend accumulator's
 *                     own lookback rather than the `timeRange` scope parameter above.
 *                 stats:
 *                   $ref: '#/components/schemas/DomainDeploymentStats'
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
		const snapshot = await readDomainDeployments(scope, slug);

		if (snapshot === null) throw new NotFoundError(`domain with id "${slug}"`);

		// `stats` is a `Panel`: `requirePanel` throws the sentinel `panel()` caught, so a
		// gap the trends accumulator cannot fill answers 501/502 instead of a body with a
		// null field standing in for "we don't know". The domain's recent log is a
		// separate capability and a separate endpoint — see the description above.
		return {
			windowLabel: snapshot.windowLabel,
			stats: toDomainDeploymentStatsDto(requirePanel(snapshot.stats))
		};
	});
