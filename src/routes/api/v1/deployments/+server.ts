import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toDeploymentDto } from '$lib/server/api/v1/dto';
import { readDeployments } from '$lib/server/platform/service';

const limitSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100));

/** GET /api/v1/deployments — most recent deployments, newest first. */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const limit = v.parse(limitSchema, Number(url.searchParams.get('limit') ?? 20));
		return { data: (await readDeployments(scope, limit)).map(toDeploymentDto) };
	});
