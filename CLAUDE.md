# command-center

## Stack

- **Svelte 5** — runes only (`$state`, `$derived`, `$effect`, `$props`). No Svelte 4 idioms: no `export let`, no `$:` reactive statements, no stores where a rune fits, no `on:click` (use `onclick`).
- **SvelteKit 2** — with **remote functions** as the primary client/server data layer.
- **Bun** — package manager, script runner, and production server runtime.
- **Tailwind CSS v4** + **shadcn-svelte** (vendored components) + **Bits UI** (headless primitives) for UI.
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

## Architecture

The general doctrine — coupling metrics, dependency direction, composability,
behavioral encapsulation, domain boundaries, the change-time checklist — is a
separate document, imported here so it loads with this file every session:

@docs/devs/architecture-rules.md

Read that for _what_ the rules are. The rest of this section is what they mean **here**:
the concrete layering this codebase settled on, and the decisions already made.

### Layers

Five layers. Each one may know about the layers below it and nothing above.

| Layer          | Lives in                                 | Knows about                            | Must never                                         |
| -------------- | ---------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| **Domain**     | `src/lib/<domain>/types.ts`              | nothing                                | import from `$lib/server` or from a component      |
| **Pure logic** | `src/lib/<domain>/*.ts`                  | the domain types                       | touch the network, the clock, or `process`         |
| **Server**     | `src/lib/server/**`                      | domain types, pure logic, data sources | be imported by anything reachable from the browser |
| **Transport**  | `src/routes/*.remote.ts`                 | server modules                         | contain business logic worth testing               |
| **UI**         | `src/lib/components/**`, `src/routes/**` | domain types, remote functions         | re-derive a fact the server already stated         |

### The server sends facts, not presentation

A payload describes what is true, never how it looks. A domain carries a `status`
and a `healthScore`; it does not carry a colour, a CSS class, or a component.

This is what lets the theme change without touching the data layer, and it is what
keeps a snapshot serialisable — devalue can send a string, not a Svelte component.

Two consequences worth stating outright:

- **Icons are string keys.** The data says `icon: 'landmark'`; one module
  (`src/lib/components/icon.ts`) knows what that draws. That keeps `@lucide/svelte`
  out of every server module and off the wire.
- **Status maps to colour in exactly one file.** `src/lib/components/tone.ts` is the
  only crossing point between operational meaning and Tailwind classes. Components
  ask for `statusTone('degraded')`, never for amber. Write the classes out in full
  there — Tailwind only ships classes it can see literally in the source.

### Derive rather than store

If a value is a function of another value, compute it in one place and export that
function. `statusFromScore()` is the example: every caller derives a domain's status
from its score the same way, so a badge cannot contradict the number printed beside it.

Storing both invites them to drift, and the drift shows up in the UI as a lie.

### Identity is not status

A property that describes what something _is_ stays separate from a property that
describes how it is _doing_. A domain's accent tint is identity; its health is status.
They are allowed to disagree — and they usually do — so they never share a field.

### Split queries by how often they change

One remote function per thing that changes on its own schedule, not one per page.
Typing in the domain table's search box must refetch eight rows, not the incident
list, the deployment feed and the infrastructure counts as well.

The corollary: do not merge two queries just because one page happens to render both.

### Page state is context, never module state

Per-user, per-render state (selected environment, time range, filters) goes in a
`.svelte.ts` class published through `setContext`/`getContext`.

Module-level `$state` is a **single instance shared by every concurrent SSR request**
on the server — one user's environment switch leaks into another user's render. Context
is created per render, so it cannot. See `src/lib/scope.svelte.ts`.

### Fixtures are deterministic

Stand-in data is seeded (`seededRandom`, `hashSeed`), never `Math.random()`. A sparkline
that redraws differently on every refresh reports change that did not happen, which
undermines every number beside it. Deterministic fixtures are also the only kind that
can be asserted on in a test.

Anything time-relative takes the clock as an argument (`buildOverview(env, range, now)`,
`formatRelativeTime(iso, now)`) rather than calling `new Date()` internally. Untestable
otherwise, and it lets the client re-render "2m ago" without refetching.

### Do not ship links to routes that do not exist

A row that navigates to a 404 is worse than a row that does not navigate. Render it as
a row; make it a link when the destination lands.

`resolve()` is typed against the literal route union, so it cannot be applied to an href
that is only known at runtime — a nav list supplied by the server is the one legitimate
reason to disable `svelte/no-navigation-without-resolve`, and the override is scoped to
the two components that need it.

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

## UI: Tailwind, shadcn-svelte, Bits UI

Three layers, each with a distinct job. Know which one you are working in.

| Layer             | What it is                                                                                                    | Where it lives           |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Tailwind v4**   | The styling mechanism. Utilities in markup; theme tokens in CSS.                                              | `src/routes/layout.css`  |
| **shadcn-svelte** | Styled components, **copied into this repo**. Not a dependency — we own and edit the source.                  | `src/lib/components/ui/` |
| **Bits UI**       | Headless primitives (behavior, focus management, ARIA). A real dependency, pulled in under shadcn components. | `node_modules`           |

Config: `components.json`. Preset **vega** (the classic shadcn/ui look), Lucide icons, Inter.

### Which layer to reach for

Follow the same order as the API selection tiers above:

1. **An existing component in `src/lib/components/ui/`** — use it.
2. **`bunx shadcn-svelte@latest add <component>`** — check the registry before building anything from scratch. It lands as editable source in this repo.
3. **Bits UI primitive + Tailwind** — for something the registry doesn't have. Never hand-roll a dropdown, dialog, or combobox: the accessibility and focus-trap work is the hard part and Bits UI has done it.
4. **Plain markup + Tailwind** — only for genuinely simple, non-interactive things.

### Tailwind v4

Configured **in CSS**, not `tailwind.config.js` — that file does not exist and should not be created. Theme tokens are CSS variables in `src/routes/layout.css` under `:root` / `.dark`.

Use the semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`), not raw palette values like `bg-zinc-100`. The semantic tokens are what make dark mode and a preset swap work; raw colors silently opt out of both.

`prettier-plugin-tailwindcss` sorts class lists — run `bun run format` rather than ordering by hand.

### Editing vendored components

`src/lib/components/ui/` is ours to edit, but `shadcn-svelte add`/`update` overwrites files. Keep local changes small and deliberate, or wrap rather than fork.

ESLint disables `svelte/no-navigation-without-resolve` for that directory only — upstream's `Button` trips it. Every other rule still applies. If a new vendored component trips a different rule, add it to that same scoped override with a comment; don't disable linting for the directory.

### Reference

Both publish LLM-readable docs — use them rather than recalling an API:

- **shadcn-svelte** — <https://www.shadcn-svelte.com/llms.txt> (component list, CLI, `components.json`)
- **Bits UI** — <https://bits-ui.com/llms.txt> (primitives, props, composition)

The `shadcn-svelte` CLI needs `--preset` for non-interactive `init`; the value is a share-code from their theme builder, not a name. The pre-configured presets are only listable through the interactive prompt.

## Testing

**`bun test` is the test runner.** Not Vitest, not Jest. Native, no config, Jest-compatible API: `import { test, expect } from 'bun:test'`.

Tests target logic, which is where this app's risk lives: remote function handlers, `src/lib/server/` modules, Valibot schemas, pure helpers. Since remote functions hold the data layer, testing them well covers most of what can break.

Test a remote function by extracting its handler body into a plain exported function and testing that directly. A wrapped `query`/`form` needs a request context to invoke, which isn't worth constructing — and the wrapper is SvelteKit's code, not ours.

Note that `bun test` cannot compile `.svelte` files, so component rendering is out of scope. If a component ever genuinely needs a rendering test, raise it then rather than adding a second runner pre-emptively.

## Conventions

- Components: `PascalCase.svelte`. Remote modules: `<domain>.remote.ts`. Rune modules: `<name>.svelte.ts`.
- App components go in `src/lib/components/`; `src/lib/components/ui/` is reserved for shadcn-svelte's vendored output.
- Component subfolders group by role, not by page: `components/app/` is the shell (sidebar, top bar), `components/overview/` is one screen's panels, and anything reused across screens sits at the top of `components/`.
- Server-only code that is not a remote function goes in `src/lib/server/`, grouped by domain (`server/platform/`).
- Shared types and pure helpers go in `src/lib/<domain>/` — `types.ts` for the contract, one file per concern beside it.
- Delete vendored components nothing imports. `shadcn-svelte add` brings them back in one command; unused source is not free.

## Docs

Developer docs live under `docs/devs/<topic>/`. Svelte and SvelteKit notes go in `docs/devs/svelte/`.

`docs/devs/architecture-rules.md` is imported into this file with `@`, so it is loaded
into context every session — no one has to remember to open it. Everything else is
linked, not imported, and gets read when the task calls for it. Import sparingly:
an `@` costs its full length in every session, whether or not the session touches it.

## State

Overview screen built and verified. `bun test` (60 tests), `bun run check`, `bun run lint`,
and `bun run build` all pass, and the production server boots and serves.

What exists:

- `src/lib/platform/` — `types.ts` (the server↔UI contract) plus `health.ts`, `format.ts`,
  `geometry.ts` and `pagination.ts`, each with a test file
- `src/lib/server/platform/` — seeded fixtures and the snapshot builder. **This is the layer
  that gets replaced when live telemetry lands**; nothing above it changes
- `src/routes/overview.remote.ts` — `getShell`, `getOverview`, `getDomainPage`, all Valibot-validated
- `src/lib/components/` — app shell (`app/`), overview panels (`overview/`), shared primitives,
  the icon registry and `tone.ts`
- `src/lib/scope.svelte.ts` — environment / time range / auto-refresh, held in context
- `src/routes/status/` — the original health-probe slice, kept as the minimal end-to-end reference
- Placeholder routes for every nav destination, so the sidebar navigates instead of 404ing

Not yet built: per-domain, per-incident and per-deployment detail routes. Until they exist the
table's row actions menu and those rows stay non-navigating, by the rule above.

**Known behaviour:** with an async `<svelte:boundary>`, SSR renders the `pending` snippet and the
awaited content resolves on the client. Expect the skeletons in view-source rather than the table.
If a route needs its data present in the initial HTML for SEO or first paint, that route is a case
for a `load` function.
