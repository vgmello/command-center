import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toIncidentDto } from '$lib/server/api/v1/dto';
import { readIncidents } from '$lib/server/platform/service';

const limitSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100));

/**
 * @swagger
 * /api/v1/incidents:
 *   get:
 *     summary: List active incidents
 *     description: Ordered by severity, then most recently opened.
 *     operationId: listIncidents
 *     tags:
 *       - Activity
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
 *                     $ref: '#/components/schemas/Incident'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const limit = v.parse(limitSchema, Number(url.searchParams.get('limit') ?? 20));
		return { data: (await readIncidents(scope, limit)).map(toIncidentDto) };
	});
