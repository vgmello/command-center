import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { requireApiToken } from './auth';

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
		if (v.isValiError(cause)) {
			// The caller controls these inputs, so naming the offending field is
			// helpful rather than a leak — unlike the message from a failed query.
			return json(
				{
					error: 'invalid_request',
					issues: cause.issues.map((issue) => ({
						path: issue.path?.map((segment) => String(segment.key)).join('.') ?? '',
						message: issue.message
					}))
				},
				{ status: 400 }
			);
		}
		throw cause;
	}
}
