import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { toConnectedSourceDto } from '$lib/server/api/v1/dto';
import { parseScope } from '$lib/server/api/schemas';
import { listSources } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/sources:
 *   get:
 *     summary: List the connected data sources
 *     description: >-
 *       Which sources are connected and what each one can answer. A panel that is empty
 *       because nothing is connected looks exactly like a panel that is empty because
 *       something broke; this is how a caller tells the two apart. Credentials are never
 *       included — a connection's settings do not leave the server.
 *     operationId: listSources
 *     tags:
 *       - Sources
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
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ConnectedSource'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		// Parsed and not used. What is connected does not vary by environment or window,
		// but every v1 operation takes the same scope vocabulary, so a client generated
		// from this document calls every endpoint the same way — and a nonsense value
		// still fails the same way here as everywhere else.
		parseScope(url.searchParams);

		return listSources().map(toConnectedSourceDto);
	});
