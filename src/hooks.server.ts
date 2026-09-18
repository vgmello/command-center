import type { HandleValidationError } from '@sveltejs/kit';

/**
 * What a client is told when a remote function's arguments fail validation.
 *
 * Two different audiences, deliberately treated differently:
 *
 *  - **The client** gets "Bad Request" and nothing else. The issues describe our
 *    schemas — field names, constraints, sometimes values — and a remote endpoint is
 *    public, so echoing them back hands an attacker a map of the argument surface.
 *  - **The server log** gets the detail, because a validation failure the UI can
 *    trigger is a bug on our side and someone has to be able to find it.
 *
 * The public JSON API takes the opposite line on purpose (see
 * `$lib/server/api/respond.ts`): there the caller writes the request by hand, so
 * naming the offending field is help, not disclosure.
 */
export const handleValidationError: HandleValidationError = ({ issues, event }) => {
	console.warn(
		`[validation] ${event.request.method} ${event.url.pathname} rejected:`,
		issues.map((issue) => ({
			path: issue.path?.map((segment) => String((segment as { key: unknown }).key)).join('.'),
			message: issue.message
		}))
	);

	return { message: 'Bad Request' };
};
