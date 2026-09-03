import { error } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Bearer-token authentication for the public API.
 *
 * Tokens come from `API_TOKENS` as a comma-separated list, so rotating one is a
 * config change: add the new token, deploy, remove the old.
 *
 * **With no tokens configured the API is closed, not open.** A data API that
 * silently serves everything because someone forgot an environment variable is the
 * failure that gets written up afterwards. The UI's remote functions are unaffected
 * — they authenticate by session, and are a separate surface.
 */
function configuredTokens(): string[] {
	return (env.API_TOKENS ?? '')
		.split(',')
		.map((token) => token.trim())
		.filter(Boolean);
}

/**
 * Constant-time comparison, so the time a rejection takes cannot be used to
 * discover a token one character at a time.
 *
 * `node:crypto` rather than a web-standard API because `crypto.subtle` has no
 * equivalent primitive — this is the tier-3 case the API selection order allows.
 */
function matches(candidate: string, token: string): boolean {
	const a = Buffer.from(candidate);
	const b = Buffer.from(token);
	// timingSafeEqual throws on a length mismatch, which would itself leak the length.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * Throws a 401 unless the request carries a configured bearer token.
 *
 * Deliberately says nothing about *why* it failed — whether tokens are configured
 * at all is not information an unauthenticated caller is owed.
 */
export function requireApiToken(request: Request): void {
	const tokens = configuredTokens();
	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

	const authorized =
		tokens.length > 0 && presented.length > 0 && tokens.some((token) => matches(presented, token));

	if (!authorized) {
		error(401, 'Unauthorized');
	}
}
