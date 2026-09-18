import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseDomainQuery, parseScope } from '$lib/server/api/schemas';
import { toDomainPageDto } from '$lib/server/api/v1/dto';
import { readDomainPage } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/domains:
 *   get:
 *     summary: List domains
 *     description: Filtering, sorting and paging are applied by the data source, so a large platform never materialises more than one page.
 *     operationId: listDomains
 *     tags:
 *       - Domains
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/Environment'
 *       - $ref: '#/components/parameters/TimeRange'
 *       - $ref: '#/components/parameters/Search'
 *       - $ref: '#/components/parameters/DomainStatus'
 *       - $ref: '#/components/parameters/DomainOwner'
 *       - $ref: '#/components/parameters/DomainSort'
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DomainPage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const query = parseDomainQuery(url.searchParams);
		return toDomainPageDto(await readDomainPage(scope, query));
	});
