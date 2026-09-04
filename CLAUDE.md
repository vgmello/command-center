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

### Plugging in a real data source

Everything the UI shows comes from a **source** behind an interface, never from a
module the UI imports directly:

- `src/lib/server/platform/source.ts` — `PlatformSource` (telemetry: domain counts,
  the domain page, rates, incidents, infrastructure), `DeploymentSource` (the CI/CD
  feed: the deployment log, its aggregates and its trends), `ServiceSource` (the
  service catalog and per-service telemetry), `InfrastructureSource` (the estate:
  regions, nodes, utilisation, storage, databases, queues and spend) and
  `WorkspaceSource` (the signed-in user and their pins). Five interfaces, because they
  are five upstreams that will be replaced independently and on different schedules —
  and because one interface carrying all of it would stop describing a single
  responsibility.

  **When to add a port rather than a method.** Deployments got their own the moment
  they stopped being one method: the data comes from a build system, not a metrics
  pipeline, so a real adapter for one has nothing to do with the other. Services
  followed for the same reason — a catalog entry (owner, repo, runbook, language) comes
  from a service registry. A real adapter may well stitch a registry and a metrics
  backend together behind `ServiceSource`; that is the point, the stitching is one
  adapter's problem rather than every caller's. Spend sits inside
  `InfrastructureSource` rather than in a billing port, because it is a property of the
  estate read on the same screen — if a finance surface ever wants budgets or chargeback
  on its own terms, that is when it earns a seam.

- `src/lib/server/platform/fixture-source.ts` — the seeded stand-in.
- `src/lib/server/platform/index.ts` — resolves one implementation per port from
  `PLATFORM_SOURCE` / `DEPLOYMENT_SOURCE` / `SERVICE_SOURCE` /
  `INFRASTRUCTURE_SOURCE` / `WORKSPACE_SOURCE`, caches the instance, and **throws on
  an unknown name**. Falling back to fixtures on a typo would serve invented numbers
  in production with nothing on the page admitting it.

To add a real backend: implement the interface, register it in the resolver, set the
env var. Nothing above the interface changes.

Two rules the interface encodes, and that a new implementation must honour:

- **Ask for the answer, not the raw rows.** `readDomainStatusCounts()` returns counts,
  not every domain, because that is one aggregate query against a real backend.
- **Push filtering, sorting and paging down.** `queryDomains()` takes the whole query
  so an adapter can translate it to SQL or a search API. Doing it above the interface
  would force every adapter to over-fetch. In-memory filtering is one adapter's
  strategy (`in-memory-query.ts`), not the contract.

Every method is `async` even where the fixture needs nothing awaited — a synchronous
port would have to be rewritten, along with every caller, the first time real I/O
appears.

Sources return **facts**. Formatting, deriving status from a score, turning counts into
percentages — all of that stays in the pure layer above, so a new adapter cannot
accidentally ship its own opinion about how a number should read.

### Two transports, one service

The data is reachable two ways, and both go through the same in-process service:

```
Browser (UI)                         External client
    │ /_app/remote/…                     │ GET /api/v1/domains
    ▼                                    ▼
overview.remote.ts                 routes/api/v1/**/+server.ts
    │ devalue · session                  │ JSON · bearer token
    └───────────────┬────────────────────┘
                    ▼
        server/platform/service.ts       ← in-process calls
                    ▼
            PlatformSource               ← the port
```

**A transport never calls the other transport over HTTP.** A remote function that
fetched `/api/v1/*` would add a network hop for nothing, throw away end-to-end types,
and fail during SSR, where the server would be fetching itself. Call the service.

`service.ts` is one function per thing a caller can ask for. `readOverview()` — the
composite the overview page needs — is composed there and deliberately _not_ exposed
publicly: it is shaped for one screen. External clients get the resources it is
composed from, which stay stable while the screen changes.

**The public contract is frozen and separate.** `src/lib/server/api/v1/dto.ts` maps
internal types to v1 shapes, and `dto.test.ts` asserts those shapes key by key.
Returning `Domain` or `OverviewSnapshot` directly would make every field rename a
breaking change found by a customer instead of by a test. The mapper is also where
presentation is stripped: `icon`, `accent`, the sparkline bounds and the pre-formatted
strings are how _our_ UI draws a thing and mean nothing to another client.

What legitimately differs between the two:

|               | Remote functions           | `/api/v1`                       |
| ------------- | -------------------------- | ------------------------------- |
| Serialization | devalue                    | plain JSON                      |
| Auth          | session                    | bearer token (`API_TOKENS`)     |
| Errors        | envelope, generic message  | real status codes, named fields |
| Versioning    | free to change with the UI | frozen per version              |

What they share: the Valibot schemas in `src/lib/server/api/schemas.ts`. One
definition of a valid time range, so the two surfaces cannot disagree.

The error handling is opposite on purpose. `handleValidationError` in
`src/hooks.server.ts` returns a bare "Bad Request" to remote callers and logs the
detail, because those issues describe our schemas and the endpoint is public. The
JSON API names the offending field, because there the caller wrote the request by
hand and is owed an explanation.

**Every new screen owes the API its resources.** A screen composite stays private —
`readOverview`, `readDomainsView`, `readDeploymentsView`, `readServiceView` are shaped
for one page — but the resources it is composed _from_ belong in `/api/v1`, and adding
a screen without them leaves the public contract describing a smaller platform than the
one that exists. Two rules the service endpoints settled:

- **A missing resource is a 404, not an empty 200.** `NotFoundError` in
  `src/lib/server/api/respond.ts` is the one place that maps it, for the same reason
  validation errors are mapped there: the moment two endpoints write their own 404,
  they write two different ones.
- **A query key means one thing.** The deployment log's environment filter is
  `deployedTo`, not a second `environment`, because the scope already owns that key and
  the two are different axes — what the view reports on, and what a run targeted.

**With `API_TOKENS` unset the API is closed, not open** — every request gets 401. A
data API that serves everything because someone forgot an environment variable is not
a failure mode worth having.

### The API reference is generated, not maintained

`/api` renders an interactive reference from `/api/v1/openapi.json`, via
`@scalar/sveltekit`. The document itself is assembled by
`sveltekit-openapi-generator`, a Vite plugin that collects `@swagger` JSDoc blocks
from the route files. Both are devDependencies; neither ships to the client.

**The reference is not versioned; the document is.** `/api` is the entry point to the
API as a whole — the URL that ends up in a README or a bookmark — so it must survive a
v2. The document it loads, `/api/v1/openapi.json`, describes exactly one version and is
versioned accordingly. When a v2 lands, the page gains a second document to switch
between rather than a second address.

**The document has two halves, kept apart on purpose:**

| Half                           | Lives in                                   | Written how                |
| ------------------------------ | ------------------------------------------ | -------------------------- |
| Which paths exist, and why     | the `@swagger` block above each handler    | by hand, once per endpoint |
| Schemas, parameters, responses | `components.yaml`, generated from `dto.ts` | never by hand              |

Prose belongs next to the code it describes. Schemas belong wherever they are already
defined once — which is the Valibot schemas the endpoints validate and serialise with.
Writing response shapes into a JSDoc comment, as the plugin's own examples do, would
reintroduce exactly the drift this split exists to prevent: the constraints go first,
because nobody remembers to update a `maximum` in a comment.

**The generated half.** `bun run openapi:components` serialises `openApiComponents()`
to `src/lib/server/api/v1/components.yaml`, which the plugin merges in. It runs as part
of `bun run build`, and `openapi.test.ts` regenerates it in memory and fails if the
committed file disagrees — so a schema change that was not regenerated is a red test,
not a wrong published contract.

**Adding an endpoint** means an `@swagger` block above the handler. Everything it
refers to — `#/components/parameters/Environment`, `#/components/schemas/DomainPage` —
already exists.

**What the tests catch**, because the plugin checks none of it:

- an annotation that is not valid YAML (`swagger-jsdoc` _skips_ those silently, so the
  endpoint would vanish from the document with no error)
- a route under `/api/v1` with no annotation, and an annotation naming a path that has
  no route — the annotation repeats the route in its own text, so a typo is otherwise
  invisible
- a `$ref` pointing at a component that does not exist
- an operation missing its scope parameters, its `security`, or its error responses
- a duplicate `operationId`, which would collide in a generated client
- a tag used by an operation but never described
- `components.yaml` being stale

**Watch out for YAML in comments.** An unquoted `key: value` colon or a leading quote
inside a `description` ends the scalar and breaks the block. Use `>-` folded scalars for
any description with punctuation. The parse test is what tells you.

**Two gaps filled at serve time** in `src/routes/api/v1/openapi.json/+server.ts`,
because the plugin's base document has no option for either and it merges only
`components.*` from the shared file: the root-level `security` (without it Scalar
reports "no authentication selected" for an API that 401s everyone) and the `tags`
array carrying descriptions and order.

The plugin emits OpenAPI **3.0.0**, not 3.1. Scalar renders both.

The document is served without a token: it describes the shape of the API, not any
data, and the reference UI fetches it before anyone has authenticated.

### Charts are arithmetic, not a dependency

`src/lib/platform/chart.ts` holds the layout maths — scales, ticks, point placement,
bar rectangles — and `LineChart` / `BarChart` turn the results into SVG. No charting
library, by the API selection order: the requirement is points on a grid and
rectangles on a baseline, which SVG does natively.

The split matters more than the saving. Because the maths is pure and takes its bounds
as arguments, an axis can be asserted in a test — and that is how the axis labelled
0, 12.5, 25 was caught. `niceScale` returns a ceiling **and** its step together for
that reason: rounding them independently produces numbers each defensible alone and
unreadable side by side.

### A fixture must cover what another fixture claims

A domain states a `serviceCount`; the service catalog had six hand-written services in
total. The domain header therefore said 24 services over a table listing 2 — two
renderings of one number, disagreeing. `listServiceVitals` now takes the domain's split
and its count and returns exactly that many rows, generating the ones nobody wrote by
hand and dealing the states out to match. A test asserts the table's length equals the
count and its statuses sum to the header's parts.

The general rule: when two fixtures describe the same quantity, one of them derives from
the other. Seeding both is how a dashboard ends up telling two stories.

### Fixtures: ask for the window, never slice it

`buildSeries` defaults to 24 points. Callers that need more must pass `points`, because
slicing a longer window out of a shorter series yields `undefined` entries that pass
silently through arithmetic and land in whichever bucket a `NaN` comparison falls into.
That is exactly how the latency heatmap ended up with eight blank columns per row, and
how the cost chart would have lost days after the 24th of a month. `series.test.ts`
asserts the requested length is honoured; no fixture slices any more.

**A number a reader sees twice must be pinned once.** The metrics tab plots a series
and prints its latest value in a tile, while the overview tab prints the catalog's
figure for the same metric. Left alone those disagree, and a reader switching tabs
watches P95 move by a hundred milliseconds for no reason — so the newest bucket of each
series is pinned to the stated reading, and a test compares the two tabs.

### A rollup is not always worst-wins

`rollUpStatus` is right for a service — one dead instance of three is an incident — and
wrong for an estate. Fifty nodes always have one rebuilding, and a headline reading
"At risk" whenever a single node is down is a headline nobody reads twice.
`estateHealth()` judges on proportion instead, with its bands stated beside it. When a
new screen rolls many things into one verdict, decide which of the two it is.

### The client declares no data

If a value is not a literal constant of the app's own structure, it arrives from the
server. That includes lists the UI merely _offers_: the domain table's status filters
and sort options travel in `getShell`, built from the same `src/lib/platform/query.ts`
arrays the Valibot picklists are built from. A hardcoded option list in a component is
a second source of truth that drifts until the endpoint rejects something the UI
offered.

The same rule covers copy that restates a rule: the health-score tooltip is generated
by `describeHealthThresholds()` from the constants `statusFromScore()` applies, so it
cannot describe bands the code no longer uses.

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

### Detail routes: 404 is an answer, not a failure

`/services/[slug]` asks the source for a service and gets `null` when there is none.
That is an ordinary answer to an ordinary question — someone edited a URL — so the page
renders a not-found panel inside the shell rather than throwing. A thrown error would
replace the nav and the chrome, making a typo look like an outage.

The sub-tabs are the other half of the same rule. The strip has eight destinations and
every one of them navigates, so back, middle-click and a pasted link all behave; the
seven that are not built yet share one `[tab]` route that says so. Its `+page.ts`
validates the segment against `SERVICE_TABS` and 404s anything else — the one case this
codebase keeps a `load` for, because a route-level guard has to run before render.
`overview` is rejected there too, so a tab never has two URLs.

### Do not ship links to routes that do not exist

A row that navigates to a 404 is worse than a row that does not navigate. Render it as
a row; make it a link when the destination lands.

`resolve()` is typed against the literal route union, so it cannot be applied to an href
that is only known at runtime — a nav list supplied by the server is the one legitimate
reason to disable `svelte/no-navigation-without-resolve`, and the override is scoped to
the two components that need it.

## Data layer: remote functions, not `+page.server.ts`

Remote functions are the default way this app talks to the server. Prefer them over `load` functions and `+server.ts` endpoints. Reach for a `load` function only when SvelteKit genuinely requires it (e.g. route-level redirects/guards before render), and for `+server.ts` only for true external HTTP surfaces (webhooks, OAuth callbacks, RSS/sitemap).

Remote functions live in `*.remote.ts` files, anywhere under `src/` **except** `src/lib/server/`.
Name them after what they serve, not the page that first needed them: `shell.remote.ts`
is the chrome every route renders inside, `domains.remote.ts` the domain table and the
domains page, `overview.remote.ts` only the overview's own composite. A module named
after one page is the wrong home for a query two pages call. They are called from anywhere in the app but always run on the server, so they may import server-only modules (env vars, DB clients).

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
- Component subfolders group by role, not by page: `components/app/` is the shell (sidebar, top bar), `components/overview/` and `components/domains/` are one screen's panels, and anything reused across screens sits at the top of `components/`. `DomainToolbar`, `DomainTable` and `DomainPager` live there because two screens compose them differently — the overview into a narrow summary, the domains page into the full table.
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

Overview, Domains, Deployments, the Service detail view and Infrastructure built and
verified, plus the service Metrics tab and the Domain detail view. `bun test` (244 tests), `bun run check`, `bun run lint`,
and `bun run build` all pass, and the production server boots and serves.

What exists:

- `src/lib/platform/` — `types.ts` (the server↔UI contract), `query.ts` (the domain-query
  vocabulary shared by the schemas and the toolbar), plus `health.ts`, `format.ts`,
  `geometry.ts` and `pagination.ts`, each with a test file
- `src/lib/server/platform/` — the `PlatformSource` / `WorkspaceSource` ports, the fixture
  implementation, the resolver, and one assembler per screen (`snapshot.ts` for the
  overview, `domains-view.ts`, `deployments-view.ts`, `service-view.ts`,
  `service-metrics-view.ts`, `domain-view.ts`, `infrastructure-view.ts`). **Replacing the fixture with real
  telemetry is a new file plus a resolver entry**; nothing above the ports changes
- `src/lib/server/platform/service.ts` — the in-process API both transports call
- `src/routes/shell.remote.ts` — `getShell`, `getSystemStatus`
- `src/routes/overview.remote.ts` — `getOverview`
- `src/routes/domains.remote.ts` — `getDomainPage`, `getDomainsView`, `getDomainView`
- `src/routes/deployments.remote.ts` — `getDeploymentPage`, `getDeploymentsView`
- `src/routes/services.remote.ts` — `getServices`, `getServiceView`, `getServiceMetrics`
  (its own query: the two tabs are never on screen together, and six series is a lot to
  fetch for a reader looking at the dependency graph)
- `src/routes/infrastructure.remote.ts` — `getInfrastructureView`, one query because
  every panel reflects the same estate at the same moment. All remote
  functions are Valibot-validated against the schemas the JSON API shares, the service
  slug included: it arrives from a URL anyone can edit
- `src/routes/api/v1/` — public JSON API, sixteen paths: `domains` (+ `summary`,
  `owners`, `changes`), `services` (+ `{slug}` and its `health`, `dependencies`,
  `endpoints`), `deployments` (+ `summary`), `activity`, `metrics`, `incidents`,
  `infrastructure`, `status`. Token-authenticated, frozen DTOs in
  `src/lib/server/api/v1/dto.ts` with a shape test per resource
- `/api/v1/openapi.json` and `/api` — the generated OpenAPI document and
  the Scalar reference that renders it
- `src/hooks.server.ts` — `handleValidationError`: generic message to the client,
  detail to the log
- `src/lib/platform/chart.ts` — chart layout maths (lines, bars, stacks, axes,
  equirectangular projection), and `world.ts` — the coarse land mask the region map
  draws. Both have test files; the mask's asserts that the cities the regions are named
  after are on land and the open oceans are not
- `src/lib/components/` — app shell (`app/`), one folder per screen (`overview/`,
  `domains/`, `deployments/`, `services/`, `infrastructure/`), the shared `StatTiles`
  strip, the shared table pieces (`DomainToolbar`, `DomainTable`,
  `TablePager`), `LineChart` / `BarChart`, the cards, the icon registry and `tone.ts`
- `src/lib/scope.svelte.ts` — environment / time range / auto-refresh, held in context
- `src/routes/status/` — the original health-probe slice, kept as the minimal end-to-end reference
- Placeholder routes for every nav destination, so the sidebar navigates instead of 404ing
- `.env.example` — the source selection and the production server's `PORT`/`ORIGIN`

**Deliberate deviations from the deployments mock**, both by the "do not ship a dead
control" rule: the date filter is a preset window select (Any time / Today / Last 7 /
Last 30) rather than a calendar, because a real filter with no new dependency beats a
picker that needs one; and the Filters button reports and clears the active filters
rather than opening a panel of controls that are already on screen. The insight rows
have no "View report" link, because those reports do not exist yet.

**Where the fixtures deliberately differ from the mocks.** Two figures in the metrics
mock are not derivable and are computed properly here instead. The error budget reads
"21m remaining", not "21h 36m": a 99.90% target over 30 days allows 43.2 minutes of
downtime, and achieving 99.95% spends half of it — no window and no target produce 21
hours. And "Budget burn" is labelled with the window it actually measures, because the
mock's percentage and its "last 7 days" caption describe different periods.

**The deferred links have landed.** `/domains/[slug]` exists, so the domain table's rows,
the service breadcrumb's domain step and the service info card's Domain row are links
now rather than plain text — which is what "make it a link when the destination lands"
was waiting for. Per-incident and per-deployment routes are still unbuilt, so the row
actions menu and those rows stay non-navigating. The domains
table's column-settings button is likewise inert — the columns a screen shows are still a
prop, not a preference, and there is nowhere yet to persist one.

**The domain table is width-budgeted.** Eleven columns fit a 1680px viewport beside the
368px side column with nothing to spare, which is why the widths are explicit and why the
compact identity mode exists: `identity="compact"` prints `shortName` alone, and that is
what buys the other ten columns their room. Adding a column means taking the width from
somewhere — measure it in a browser rather than estimating, because table auto-layout
makes cells wider than their `w-[…]` hint whenever content demands it.

**Known behaviour:** with an async `<svelte:boundary>`, SSR renders the `pending` snippet and the
awaited content resolves on the client. Expect the skeletons in view-source rather than the table.
If a route needs its data present in the initial HTML for SEO or first paint, that route is a case
for a `load` function.
