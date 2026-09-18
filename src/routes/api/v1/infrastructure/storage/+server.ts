import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toStorageDto } from '$lib/server/api/v1/dto';
import { readStorage } from '$lib/server/platform/service';

/**
 * @swagger
 * /api/v1/infrastructure/storage:
 *   get:
 *     summary: Read stored bytes by class
 *     description: >-
 *       Block, object and file storage, in bytes rather than a rounded unit.
 *     operationId: getStorage
 *     tags:
 *       - Infrastructure
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
 *               $ref: '#/components/schemas/Storage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		return toStorageDto(await readStorage(scope));
	});
