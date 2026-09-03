import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openApiDocument } from '$lib/server/api/v1/openapi';

/**
 * GET /api/v1/openapi.json
 *
 * Served without a token, deliberately. The document describes the shape of the API,
 * not any of its data, and the reference UI fetches it from the browser before anyone
 * has authenticated. Gating it would make the documentation unreadable to the people
 * deciding whether to integrate, and would protect nothing.
 *
 * `url.origin` rather than a configured base URL, so the `servers` entry is correct
 * in local dev, in preview and in production without three settings to keep in sync.
 */
export const GET: RequestHandler = ({ url }) =>
	json(openApiDocument(url.origin), {
		headers: { 'cache-control': 'public, max-age=300' }
	});
