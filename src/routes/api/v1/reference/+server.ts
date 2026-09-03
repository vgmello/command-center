import { ScalarApiReference } from '@scalar/sveltekit';

/**
 * GET /api/v1/reference — the interactive API reference.
 *
 * Tier 4 on the API selection order, and the tiers above genuinely cannot do it:
 * rendering a browsable, try-it-out OpenAPI reference is not something SvelteKit,
 * Bun or Node provide. `@scalar/sveltekit` is a thin wrapper (one dependency, ~21KB)
 * that returns an HTML page pointing at our own spec.
 *
 * It is handed a `url`, not inline content, so the page always renders whatever
 * `/api/v1/openapi.json` currently serves rather than a copy captured at build time.
 */
export const GET = ScalarApiReference({
	url: '/api/v1/openapi.json',
	// Matches the dashboard's dark-first look rather than Scalar's default.
	theme: 'bluePlanet',
	darkMode: true,
	hideDownloadButton: false
});
