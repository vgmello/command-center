/**
 * Types for Vite virtual modules.
 *
 * A standalone ambient file with no imports or exports: `app.d.ts` ends with
 * `export {}`, which makes it a module, and a `declare module` inside a module is an
 * augmentation of something that must already resolve — not a declaration of
 * something new.
 *
 * Declared here rather than referencing the plugin's own ambient types, because its
 * `exports` map exposes only the package root, so the subpath cannot be imported.
 */
declare module 'virtual:openapi-spec' {
	/** The OpenAPI document assembled at build time from the endpoint annotations. */
	const spec: Record<string, unknown>;
	export default spec;
}
