import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseDomainQuery, parseScope } from '$lib/server/api/schemas';
import { toDomainPageDto } from '$lib/server/api/v1/dto';
import { readDomainPage } from '$lib/server/platform/service';

/**
 * GET /api/v1/domains
 *
 * Filtering, sorting and paging travel as query parameters and are pushed into the
 * source, so this handler never holds more than one page in memory. Same service
 * call the UI's `getDomainPage` makes — in process, not over HTTP.
 */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () => {
		const scope = parseScope(url.searchParams);
		const query = parseDomainQuery(url.searchParams);
		return toDomainPageDto(await readDomainPage(scope, query));
	});
