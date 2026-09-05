import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toDatabaseDto } from '$lib/server/api/v1/dto';
import { readDatabases } from '$lib/server/platform/service';

const limitSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100));

/**
 * @swagger
 * /api/v1/infrastructure/databases:
 *   get:
 *     summary: List databases
 *     description: >-
 *       With the connection-pool saturation that decides their state.
 *     operationId: listDatabases
 *     tags:
 *       - Infrastructure
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *                     $ref: '#/components/schemas/Database'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const limit = v.parse(limitSchema, Number(url.searchParams.get('limit') ?? 20));
		return { data: (await readDatabases(scope, limit)).map(toDatabaseDto) };
	});
