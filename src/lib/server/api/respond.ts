import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { requireApiToken } from './auth';

/**
 * Thrown by an endpoint whose addressed resource does not exist.
 *
 * A sentinel rather than each endpoint building its own response, for the same reason
 * validation errors are handled here: the moment two endpoints write their own 404,
 * they write two different ones.
 */
export class NotFoundError extends Error {
	constructor(readonly resource: string) {
		super(`No ${resource}.`);
		this.name = 'NotFoundError';
	}
}

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
		if (cause instanceof NotFoundError) {
			// "There is no such thing" and "here is the thing, and it is empty" are
			// different answers, and only one of them is a 200.
			return json({ error: 'not_found', message: cause.message }, { status: 404 });
		}

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
