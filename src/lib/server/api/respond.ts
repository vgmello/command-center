import { json } from '@sveltejs/kit';
import { requireApiToken } from './auth';
import { errorResponse } from './error-response';

/**
 * The sentinel and the mapping that reads it, re-exported.
 *
 * Every endpoint already imports `NotFoundError` from here, and from a caller's point of
 * view the two belong together — the split exists only so the mapping can be tested
 * without `$env`, which the token check drags in.
 */
export { NotFoundError, errorResponse } from './error-response';

/**
 * The shape every v1 endpoint shares: authenticate, parse, respond.
 *
 * Endpoints are thin on purpose — the moment one of them grows a branch of its own,
 * the two transports have started to disagree about what the data means.
 */
export async function apiResponse<T>(request: Request, build: () => Promise<T>): Promise<Response> {
	requireApiToken(request);

	try {
		return json(await build(), {
			headers: {
				// Live operational data. A stale dashboard is worse than a slow one.
				'cache-control': 'no-store'
			}
		});
	} catch (cause) {
		const mapped = errorResponse(cause);
		if (mapped) return mapped;

		// Genuinely ours. A bug here must surface as a 500 rather than be dressed up as
		// somebody else's fault.
		throw cause;
	}
}
