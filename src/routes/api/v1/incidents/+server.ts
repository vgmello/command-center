import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toIncidentDto } from '$lib/server/api/v1/dto';
import { readIncidents } from '$lib/server/platform/service';

const limitSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100));

/** GET /api/v1/incidents — open incidents, worst first. */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const limit = v.parse(limitSchema, Number(url.searchParams.get('limit') ?? 20));
		return { data: (await readIncidents(scope, limit)).map(toIncidentDto) };
	});
