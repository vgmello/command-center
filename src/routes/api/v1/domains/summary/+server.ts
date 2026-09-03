import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toDomainSummaryDto } from '$lib/server/api/v1/dto';
import { readDomainStatusCounts } from '$lib/server/platform/service';

/**
 * GET /api/v1/domains/summary
 *
 * Counts per status. Its own resource rather than a field on the collection,
 * because a source answers it with one aggregate query and a caller usually wants
 * one or the other, not both.
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () =>
		toDomainSummaryDto(await readDomainStatusCounts(parseScope(url.searchParams)))
	);
