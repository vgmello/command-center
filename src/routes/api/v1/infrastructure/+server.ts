import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toInfrastructureDto } from '$lib/server/api/v1/dto';
import { readInfrastructure } from '$lib/server/platform/service';

/** GET /api/v1/infrastructure — counts by kind, with the rolled-up status of each. */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const groups = await readInfrastructure(parseScope(url.searchParams));
		return { data: groups.map(toInfrastructureDto) };
	});
