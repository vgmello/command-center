import type { RequestHandler } from './$types';
import { apiResponse } from '$lib/server/api/respond';
import { parseScope } from '$lib/server/api/schemas';
import { toSystemStatusDto } from '$lib/server/api/v1/dto';
import { readSystemStatus } from '$lib/server/platform/service';

/** GET /api/v1/status — the platform-wide roll-up shown in the sidebar footer. */
export const GET: RequestHandler = async ({ url, request }) =>
	apiResponse(request, async () =>
		toSystemStatusDto(await readSystemStatus(parseScope(url.searchParams)))
	);
