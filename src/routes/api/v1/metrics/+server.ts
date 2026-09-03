import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toMetricDto } from '$lib/server/api/v1/dto';
import { readRates } from '$lib/server/platform/service';

/** GET /api/v1/metrics — headline rates as observed, unformatted. */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const rates = await readRates(parseScope(url.searchParams));
		return { data: rates.map(toMetricDto) };
	});
