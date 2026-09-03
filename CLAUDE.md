# command-center

## Stack

- **Svelte 5** — runes only (`$state`, `$derived`, `$effect`, `$props`). No Svelte 4 idioms: no `export let`, no `$:` reactive statements, no stores where a rune fits, no `on:click` (use `onclick`).
- **SvelteKit 2** — with **remote functions** as the primary client/server data layer.
- **Bun** — package manager, script runner, and production server runtime.
- **TypeScript** throughout.

## API selection order

When solving any problem, work down this list and stop at the first tier that can do the job. Do not skip a tier because a lower one is more familiar.

1. **SvelteKit / Svelte built-ins.** If the framework already solves it, use it. Remote functions instead of hand-rolled fetch wrappers; `form` instead of a submit handler; `$state`/`$derived` instead of a store library; `<svelte:boundary>` instead of manual loading flags; `redirect`/`error` from `@sveltejs/kit` instead of custom control flow; `$env/*` instead of reading `process.env`; `enhance` instead of bespoke progressive enhancement.

2. **Bun native APIs** — <https://bun.com/docs/runtime/bun-apis.md>. `Bun.file` over `node:fs` reads, `bun:sqlite` over a SQLite driver, `Bun.password` over bcrypt, `Bun.$` over a shell-exec library, `Bun.serve` internals, `Bun.env`.

   Web-standard APIs (`fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `WebSocket`, `FormData`, `AbortController`) sit at this tier too, and are **preferred over Bun-proprietary equivalents when both work** — they behave identically on the server and in the browser, and they survive a runtime change.

3. **Node APIs**, imported with the explicit `node:` prefix (`node:crypto`, `node:path`). Bun implements most of the Node API surface, so this is a real option — just not the first one.

4. **A community library, or write it.** Only once tiers 1–3 genuinely cannot. Prefer a well-maintained, widely-adopted package over a clever one. If the need is small and the dependency large, write it — but a dependency is usually right for anything security-sensitive (auth, crypto, parsing untrusted input); don't hand-roll those.

**Why this order:** each tier down adds something to maintain. A framework feature is tested by its maintainers and moves with the version bump. A dependency is a supply-chain surface, a bundle cost, and an upgrade obligation, and it goes stale on someone else's schedule.

When adding a dependency, say in the PR which tiers you ruled out and why. "Tier 1–3 can't do X" is a fine answer; not having checked is not.

## Data layer: remote functions, not `+page.server.ts`

Remote functions are the default way this app talks to the server. Prefer them over `load` functions and `+server.ts` endpoints. Reach for a `load` function only when SvelteKit genuinely requires it (e.g. route-level redirects/guards before render), and for `+server.ts` only for true external HTTP surfaces (webhooks, OAuth callbacks, RSS/sitemap).

Remote functions live in `*.remote.ts` files, anywhere under `src/` **except** `src/lib/server/`. They are called from anywhere in the app but always run on the server, so they may import server-only modules (env vars, DB clients).

Four flavours from `$app/server`:

| Function    | Use for                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `query`     | Read dynamic data. Also `query.batch` (solves n+1) and `query.live` (streaming/real-time).                         |
| `form`      | Write data via a `<form>`. **Preferred mutation**, because it degrades gracefully without JS.                      |
| `command`   | Write data from anywhere (event handlers, etc.). Use only when `form` doesn't fit. Cannot be called during render. |
| `prerender` | Data that changes at most once per deploy; resolved at build time.                                                 |

### Rules

- **Validate every argument.** Remote functions are exposed HTTP endpoints. Pass a **Valibot** schema as the first argument. `'unchecked'` only with a written justification.
- **Prefer `form` over `command`** for mutations.
- **Use single-flight mutations.** After a mutation, refresh affected queries from inside the server handler (`getThing().refresh()` / `.set(result)`), or accept client-requested refreshes via `requested(fn, limit)` with an explicit, non-`Infinity` limit. Never let the client drive an unbounded refresh list.
- **Never trust `url`, `route`, or `params` from `getRequestEvent()`** inside a remote function for authorization — they describe the calling page, not the endpoint, and are client-controlled. Authorize from cookies/session.
- **Sensitive form fields get a leading underscore** (`_password`) so they're not echoed back on failed non-JS submissions.
- Redirects work in `query`, `form`, and `prerender` — not in `command`.
- Implement `handleValidationError` in `src/hooks.server.ts`; return a generic message, never validation internals.

### Validation

**Valibot** is the validation library. Not Zod — don't introduce a second Standard Schema implementation.

Chosen for bundle size: Valibot is modular and tree-shakes to roughly what you import, which matters because preflight schemas ship to the client. Import it namespaced (`import * as v from 'valibot'`) so the tree-shaking actually works.

Any Standard Schema library would satisfy SvelteKit here — this is a consistency decision, not a technical constraint.

Schemas used as form preflight must live in a shared module or a `<script module>` block. **They cannot be exported from a `.remote.ts` file** — only remote functions may be exported from those.

### Experimental flags

Both flags live in **`vite.config.ts`**, inside the `sveltekit()` plugin options — this SvelteKit version has no `svelte.config.js`. Older guides and the official docs still show `svelte.config.js`; translate, don't create the file.

- `experimental.remoteFunctions: true` — plugin option
- `compilerOptions.experimental.async: true` — enables `await` in deriveds, template expressions, and component top level

Experimental APIs change between releases. Read the changelog before bumping SvelteKit or Svelte.

Because `experimental.async` is on, `await` is usable directly in components and `{#each await ...}` in markup. Wrap awaiting UI in `<svelte:boundary>` for pending/error states.

### Further reading

Before writing or reviewing any remote function, read these in order:

1. **[docs/devs/svelte/remote-functions-batching-and-performance.md](docs/devs/svelte/remote-functions-batching-and-performance.md)** — this repo's working guide. Covers `query.batch`, the N+1 trap, waterfalls, single-flight mutations, when _not_ to batch, retry anti-patterns, and measurement. Read this first; it encodes the decisions this repo has already made.
2. **<https://svelte.dev/docs/kit/remote-functions/llms.txt>** — the official, always-current remote functions reference in LLM-readable form. Fetch it when the repo doc doesn't cover the case, when an API signature needs verifying, or when the SvelteKit version has moved. The official docs win any conflict with the repo doc — when they disagree, fix the repo doc.

Remote functions are experimental and the API moves. Never answer a remote-functions question from memory; check one of the two sources above.

## Runtime: Bun

**Bun is the runtime everywhere — local dev included.** Node never executes this project's code, in any environment. This is deliberate: dev and production must agree on the runtime, or Bun-specific server APIs work locally and fail in production (or the reverse).

### Tooling

- `bun install`, `bun run <script>`, `bunx` — never `npm`/`pnpm`/`yarn`/`npx`.
- `bun.lock` is committed. Don't add other lockfiles.

### Running Vite under Bun

`bun run dev` is **not** enough. Bun respects a binary's shebang, and Vite's is `#!/usr/bin/env node` — so a plain `bun run dev` silently hands the dev server to Node. Two ways to force the Bun runtime:

- **Per-invocation:** `bun --bun run dev` (equivalently `bunx --bun vite dev`). The `--bun` flag overrides the shebang.
- **Repo-wide (preferred):** set `run.bun = true` in `bunfig.toml`, which makes every `bun run` use Bun without the flag. Committed to the repo so it applies to everyone and to CI.

Verify rather than assume — `process.versions.bun` is defined only under Bun. If it's `undefined` in the dev server, Vite is running on Node and the `--bun`/`bunfig.toml` setup is not taking effect.

### Adapter

**`svelte-adapter-bun`**, pinned to `1.0.1`.

This is deliberately _not_ the official `@sveltejs/adapter-bun`. That package exists, but `1.0.0-next.1` declares `peerDependencies: { "@sveltejs/kit": "^3.0.0-next.0" }` — it targets SvelteKit **3**, which is still a prerelease. On SvelteKit 2 it crashes during `adapt()` with `TypeError: undefined is not an object (evaluating 'builder.config.paths.base')`, because the `builder.config` shape differs between majors. Verified here, not assumed.

**Migration trigger:** when SvelteKit 3 goes stable and this project upgrades, switch to `@sveltejs/adapter-bun` — it is maintained by the SvelteKit team and will track API changes that a third-party adapter lags on. Until then `svelte-adapter-bun` is the only working option.

Pin exact versions for both the adapter and SvelteKit — no `^` ranges on the pieces holding this together.

### Bun APIs

Bun-specific server APIs (`Bun.file`, `Bun.serve` internals, `bun:sqlite`, …) are allowed in server-only code — remote functions, `src/lib/server/`, hooks. Keep them out of anything reachable from the browser. Since dev and production share the runtime, a Bun API that works locally works in production; the remaining hazard is only the client bundle.

## Testing

**`bun test` is the test runner.** Not Vitest, not Jest. Native, no config, Jest-compatible API: `import { test, expect } from 'bun:test'`.

Tests target logic, which is where this app's risk lives: remote function handlers, `src/lib/server/` modules, Valibot schemas, pure helpers. Since remote functions hold the data layer, testing them well covers most of what can break.

Test a remote function by extracting its handler body into a plain exported function and testing that directly. A wrapped `query`/`form` needs a request context to invoke, which isn't worth constructing — and the wrapper is SvelteKit's code, not ours.

Note that `bun test` cannot compile `.svelte` files, so component rendering is out of scope. If a component ever genuinely needs a rendering test, raise it then rather than adding a second runner pre-emptively.

## Conventions

- Components: `PascalCase.svelte`. Remote modules: `<domain>.remote.ts`. Rune modules: `<name>.svelte.ts`.
- Server-only code that is not a remote function goes in `src/lib/server/`.
- Shared types and pure helpers go in `src/lib/`.

## Docs

Developer docs live under `docs/devs/<topic>/`. Svelte and SvelteKit notes go in `docs/devs/svelte/`.

## State

Scaffolded and verified. `bun run build` succeeds, `bun test` passes, `bun run check` and `bun run lint` are clean.

What exists:

- `src/lib/server/health.ts` — plain logic, plus `health.test.ts` covering it
- `src/routes/status.remote.ts` — `getHealth` (`query`) and `getServiceDetail` (`query.batch`)
- `src/routes/+page.svelte` — awaits both inside `<svelte:boundary>` with `pending`/`failed` snippets

This slice exists to prove the wiring end-to-end and doubles as the reference for the conventions above. The `probe()` function is a stand-in — replace it with real checks as services land.

**Known behaviour:** with an async `<svelte:boundary>`, SSR renders the `pending` snippet and the awaited content resolves on the client. Expect "Checking services…" in view-source rather than the table. If a route needs its data present in the initial HTML for SEO or first paint, that route is a case for a `load` function.
