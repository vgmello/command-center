import { ScalarApiReference } from '@scalar/sveltekit';

/**
 * GET /api — the interactive API reference.
 *
 * It sits at the root of the API namespace rather than inside `/api/v1`, because the
 * reference is the entry point to the API as a whole, not to one version of it. When
 * a v2 arrives this page gains a second document to switch between; its URL — the one
 * that ends up in a README, a bookmark or an onboarding doc — does not move.
 *
 * Tier 4 on the API selection order, and the tiers above genuinely cannot do it:
 * rendering a browsable, try-it-out OpenAPI reference is not something SvelteKit,
 * Bun or Node provide. `@scalar/sveltekit` is a thin wrapper (one dependency, ~21KB)
 * that returns an HTML page pointing at our own spec.
 *
 * It is handed a `url`, not inline content, so the page always renders whatever
 * `/api/v1/openapi.json` currently serves rather than a copy captured at build time.
 * That URL stays versioned: the reference is version-agnostic, the document it reads
 * describes exactly one version.
 */
export const GET = ScalarApiReference({
	url: '/api/v1/openapi.json',

	// Matches the dashboard's dark-first look rather than Scalar's default.
	theme: 'bluePlanet',

	/**
	 * The reference renders dark, always, with no control to change it.
	 *
	 * All three are needed, and they are not redundant. `darkMode` is documented as
	 * the *initial* state only, so on its own a stored preference could still land a
	 * visitor in light mode. `hideDarkModeToggle` removes the control but not the
	 * stored preference. `forceDarkModeState` is the one that actually pins it —
	 * "makes it always this state no matter what", in Scalar's own words — and
	 * without hiding the toggle it would leave a control on the page that does
	 * nothing when clicked.
	 */
	darkMode: true,
	hideDarkModeToggle: true,
	forceDarkModeState: 'dark',

	/**
	 * Scalar defaults `telemetry` to true, which reports usage back to Scalar from
	 * every visitor's browser. This page describes an internal platform API; its
	 * traffic is not theirs to measure.
	 */
	telemetry: false,

	/**
	 * The document is generated from the annotations and the Valibot schemas, so an
	 * edit made in the browser could only ever be thrown away on reload. Both of
	 * these are already Scalar's defaults — stated here so a version bump that
	 * changes a default cannot quietly turn the reference into an editor.
	 */
	layout: 'modern',
	isEditable: false,

	hideDownloadButton: false
});
