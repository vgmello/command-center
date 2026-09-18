import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { gapSentence } from '$lib/platform/gaps';
import type { Panel } from '$lib/platform/sources';
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
		// Same sentence the page prints — `gapSentence` is the single source.
		return json(
			{
				error: 'capability_unavailable',
				message: gapSentence(cause.reason, cause.kind, cause.capability),
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

/**
 * Unwraps a resolved panel, or throws the sentinel that produced its gap.
 *
 * A screen-shaped snapshot already resolved its gaps into a `Panel` — `unavailable` or
 * `failed` rather than a thrown error, so one bad panel degrades one part of a page
 * instead of the whole render. A public endpoint has no page to degrade: the caller
 * asked for a fact, and a frozen contract must not answer with zeros or a null field
 * standing in for "we don't know" — the exact failure `NotFoundError` above exists to
 * avoid for a missing resource. So this reconstructs the same error `panel()` (in
 * `../sources/panel.ts`) caught, and `errorResponse` maps it to the 501 or 502 it
 * already knows how to produce for a source-backed read that never went through a
 * panel at all — one mapping, whichever route the gap came from.
 *
 * Lives beside `errorResponse` rather than in `respond.ts`, for the same reason
 * `NotFoundError` does: so both can be tested without `$env`, which `apiResponse`'s
 * token check drags in.
 */
export function requirePanel<T>(panel: Panel<T>): T {
	if (panel.status === 'ok') return panel.data;

	if (panel.status === 'unavailable') {
		throw new CapabilityUnavailableError(panel.capability, panel.reason);
	}

	// 'failed': the connection exists and implements the capability, but the call
	// itself did not answer. `sourceCause` never travels past `panel()` either, so
	// there is nothing to pass here that `errorResponse` would use.
	throw new SourceFailedError(panel.capability, panel.source, undefined);
}
