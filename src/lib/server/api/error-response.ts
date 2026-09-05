import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { CapabilityUnavailableError, SourceFailedError } from '../sources/errors';

/**
 * How a thrown thing becomes a status code.
 *
 * A module of its own so it can be tested without `$env`, which only resolves inside a
 * SvelteKit build — the same reason `select-source.ts` lives apart from the resolver.
 * Importing the endpoint helper would drag the token check in with it.
 */

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
 * The response an error deserves, or `null` when it is genuinely ours.
 *
 * Split from `apiResponse` so the mapping can be tested without `$env`, which only
 * resolves inside a SvelteKit build — the same reason `selectSource` lives apart from the
 * resolver. Every endpoint shares it, because the moment two of them write their own 404
 * they write two different ones.
 */
export function errorResponse(cause: unknown): Response | null {
	if (cause instanceof NotFoundError) {
		// "There is no such thing" and "here is the thing, and it is empty" are
		// different answers, and only one of them is a 200.
		return json({ error: 'not_found', message: cause.message }, { status: 404 });
	}

	if (cause instanceof CapabilityUnavailableError) {
		// Not a server error: nothing is broken, and retrying will not help. No connected
		// source implements this capability, which is a statement about how the deployment
		// is configured — so it is 501, and it names the capability so a caller can tell
		// which one and stop asking for it.
		return json(
			{
				error: 'capability_unavailable',
				message: `No connected ${cause.kind} source implements ${cause.capability}.`,
				capability: cause.capability,
				kind: cause.kind,
				reason: cause.reason
			},
			{ status: 501 }
		);
	}

	if (cause instanceof SourceFailedError) {
		// The source exists and did not answer. That is upstream's failure, not the
		// caller's, and 502 says so — a 500 would suggest a bug here. The upstream's own
		// error text never travels: it can quote a request, and a request is built from
		// settings.
		return json(
			{
				error: 'source_failed',
				message: `${cause.source.name} did not answer for ${cause.capability}.`,
				capability: cause.capability,
				source: { id: cause.source.connectionId, name: cause.source.name }
			},
			{ status: 502 }
		);
	}

	if (v.isValiError(cause)) {
		// The caller controls these inputs, so naming the offending field is helpful
		// rather than a leak — unlike the message from a failed query.
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

	return null;
}
