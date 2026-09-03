# command-center

## Stack

- **Svelte 5** — runes only (`$state`, `$derived`, `$effect`, `$props`). No Svelte 4 idioms: no `export let`, no `$:` reactive statements, no stores where a rune fits, no `on:click` (use `onclick`).
- **SvelteKit 2** — with **remote functions** as the primary client/server data layer.
- **Bun** — package manager, script runner, and production server runtime.
- **TypeScript** throughout.

## Data layer: remote functions, not `+page.server.ts`

Remote functions are the default way this app talks to the server. Prefer them over `load` functions and `+server.ts` endpoints. Reach for a `load` function only when SvelteKit genuinely requires it (e.g. route-level redirects/guards before render), and for `+server.ts` only for true external HTTP surfaces (webhooks, OAuth callbacks, RSS/sitemap).

Remote functions live in `*.remote.ts` files, anywhere under `src/` **except** `src/lib/server/`. They are called from anywhere in the app but always run on the server, so they may import server-only modules (env vars, DB clients).

Four flavours from `$app/server`:

| Function | Use for |
| --- | --- |
| `query` | Read dynamic data. Also `query.batch` (solves n+1) and `query.live` (streaming/real-time). |
| `form` | Write data via a `<form>`. **Preferred mutation**, because it degrades gracefully without JS. |
| `command` | Write data from anywhere (event handlers, etc.). Use only when `form` doesn't fit. Cannot be called during render. |
| `prerender` | Data that changes at most once per deploy; resolved at build time. |

### Rules

- **Validate every argument.** Remote functions are exposed HTTP endpoints. Pass a Standard Schema (Valibot or Zod) as the first argument. `'unchecked'` only with a written justification.
- **Prefer `form` over `command`** for mutations.
- **Use single-flight mutations.** After a mutation, refresh affected queries from inside the server handler (`getThing().refresh()` / `.set(result)`), or accept client-requested refreshes via `requested(fn, limit)` with an explicit, non-`Infinity` limit. Never let the client drive an unbounded refresh list.
- **Never trust `url`, `route`, or `params` from `getRequestEvent()`** inside a remote function for authorization — they describe the calling page, not the endpoint, and are client-controlled. Authorize from cookies/session.
- **Sensitive form fields get a leading underscore** (`_password`) so they're not echoed back on failed non-JS submissions.
- Redirects work in `query`, `form`, and `prerender` — not in `command`.
- Implement `handleValidationError` in `src/hooks.server.ts`; return a generic message, never validation internals.

### Experimental flags

Remote functions require opt-in in `svelte.config.js`: `kit.experimental.remoteFunctions: true` and `compilerOptions.experimental.async: true`. This is an experimental API and may change between SvelteKit releases — pin the SvelteKit version and read the changelog before upgrading.

Because `experimental.async` is on, `await` is usable directly in components and `{#each await ...}` in markup. Wrap awaiting UI in `<svelte:boundary>` for pending/error states.

### Further reading

Before writing or reviewing any remote function, read these in order:

1. **[docs/devs/svelte/remote-functions-batching-and-performance.md](docs/devs/svelte/remote-functions-batching-and-performance.md)** — this repo's working guide. Covers `query.batch`, the N+1 trap, waterfalls, single-flight mutations, when *not* to batch, retry anti-patterns, and measurement. Read this first; it encodes the decisions this repo has already made.
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

**`@sveltejs/adapter-bun`** — the official SvelteKit Bun adapter. Not the community `svelte-adapter-bun`; if you find that name in a search result or an older guide, it is the wrong package for this repo.

Currently a prerelease (`1.0.0-next.1` as of 2026-09). Accepted deliberately: this repo is already on experimental remote functions, and the official adapter tracks SvelteKit API changes directly where a third-party one lags. **Pin the exact version** — no `^` range — and read the changelog before bumping.

### Bun APIs

Bun-specific server APIs (`Bun.file`, `Bun.serve` internals, `bun:sqlite`, …) are allowed in server-only code — remote functions, `src/lib/server/`, hooks. Keep them out of anything reachable from the browser. Since dev and production share the runtime, a Bun API that works locally works in production; the remaining hazard is only the client bundle.

## Conventions

- Components: `PascalCase.svelte`. Remote modules: `<domain>.remote.ts`. Rune modules: `<name>.svelte.ts`.
- Server-only code that is not a remote function goes in `src/lib/server/`.
- Shared types and pure helpers go in `src/lib/`.

## Docs

Developer docs live under `docs/devs/<topic>/`. Svelte and SvelteKit notes go in `docs/devs/svelte/`.

## State

Repo is a skeleton: `LICENSE` (MIT) and `README.md` only. Nothing is scaffolded yet.
