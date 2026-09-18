import { json } from '@sveltejs/kit';
import generated from 'virtual:openapi-spec';
import { API_TAGS } from '$lib/server/api/v1/tags';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/openapi.json
 *
 * Serves the document assembled at build time by the openapi plugin: the annotation
 * blocks beside each handler, merged with the schemas generated from Valibot.
 *
 * Two fields are added here because the plugin's base document has no option for
 * them, and it merges only `components.*` out of the shared file:
 *
 *  - **Root `security`.** Each operation declares `bearerAuth` in its own annotation,
 *    but a reader — and Scalar's authentication panel — looks at the document root to
 *    decide whether the API needs credentials at all. Without it the reference reports
 *    "no authentication selected" for an API that returns 401 to everyone.
 *  - **`tags`.** The plugin emits tag *names* from the annotations but has nowhere to
 *    put their descriptions or their order, so the sidebar would group correctly and
 *    explain nothing.
 *
 * Served without a token, deliberately. The document describes the shape of the API,
 * not any of its data, and the reference UI fetches it from the browser before anyone
 * has authenticated. Gating it would make the documentation unreadable to the people
 * deciding whether to integrate, and would protect nothing.
 */

const document = {
	...generated,
	security: [{ bearerAuth: [] }],
	tags: API_TAGS
};

export const GET: RequestHandler = () =>
	json(document, { headers: { 'cache-control': 'public, max-age=300' } });
