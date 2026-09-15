import { afterAll, mock } from 'bun:test';

/**
 * Stubs SvelteKit's `$env/dynamic/private` for the rest of the current `bun test`
 * process, so a test can import anything that reaches it — `platform/index.ts` and
 * `catalog/index.ts` both read it at module scope to resolve the configured sources.
 *
 * Why this exists at all: `$env/dynamic/private` is a virtual specifier the SvelteKit
 * Vite plugin synthesises from `process.env` at build/dev time. No file on disk backs
 * it, so plain `bun test` cannot resolve it — every test in this codebase before this
 * one sidestepped the problem by constructing a router or a `Fixture*Source` directly
 * instead of going through a `service.ts`-level function that reaches the singleton in
 * `./index`. The first test that needs to go through that singleton needs this stub.
 *
 * Two things make this safe to reuse rather than a trap for whoever imports it next:
 *
 * - **It registers exactly once per run.** `mock.module` replaces the module in bun:
 *   test's process-wide registry — every file in one `bun test` invocation shares that
 *   registry (verified directly: state mutated by one test file's module import is
 *   still mutated when a second file imports the same module). A second, uncoordinated
 *   `mock.module('$env/dynamic/private', ...)` elsewhere would silently overwrite this
 *   one, or be silently overwritten by it, depending on file order — exactly the kind
 *   of bug whose cause sits in a different file than its symptom. Calling this function
 *   twice with different `vars` throws immediately, at the call site, instead.
 * - **It restores itself.** An `afterAll` calls `mock.restore()` once this file's tests
 *   finish, so the stub does not outlive the file that needed it.
 *
 * Residual caveat, found while building this: `mock.restore()` un-registers the mock
 * factory, but it cannot evict a module specifier that has *already been imported* —
 * that is ordinary ECMAScript module caching, not a bun:test gap, and no test-framework
 * API reaches into it. Concretely: if a later file in the same `bun test` run also
 * imports `service.ts` (or anything else that reaches `platform/index.ts`), it gets the
 * same already-evaluated module instance this file produced, env stub included,
 * regardless of the restore. The one-call-per-run guard above contains that risk rather
 * than eliminating it: every consumer that ever needs this is guaranteed to get the
 * *same, documented* stub, never two disagreeing ones — so a leak is inert rather than
 * misleading. `bun test --isolate` (a fresh module registry per file) is the real fix
 * if a second, independent consumer ever needs a *different* stubbed environment; until
 * then, route it through this function rather than adding a competing call.
 */
let installedWith: Record<string, string> | undefined;

export function stubPrivateEnv(vars: Record<string, string> = {}): void {
	if (installedWith) {
		if (JSON.stringify(installedWith) === JSON.stringify(vars)) return;

		throw new Error(
			'stubPrivateEnv() was already installed with different vars this run — ' +
				'route this call through the existing stub instead of layering a second one.'
		);
	}

	installedWith = vars;
	mock.module('$env/dynamic/private', () => ({ env: vars }));

	afterAll(() => {
		mock.restore();
	});
}
