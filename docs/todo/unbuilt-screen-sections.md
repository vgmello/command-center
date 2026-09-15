# The sub-tabs that say "not built yet"

**Status:** open, and mostly a product question rather than an engineering one.

## What is missing

Three screens publish a tab strip; most of the destinations are placeholders.

| Screen         | Tabs | Built                      |
| -------------- | ---: | -------------------------- |
| Domain detail  |    8 | `overview`, `dependencies` |
| Service detail |    8 | `overview`, `metrics`      |
| Infrastructure |    9 | `overview`                 |

The rest share one `[tab]` route per screen that validates the segment and renders "… is
not built yet", 404ing anything not in the list. The sidebar does the same thing at the
top level: Logs, Traces and Reports are listed with `available: false` and grouped under
"Coming soon", shown but not linked.

That is deliberate and it is the right default — a nav that omits half the product tells
a reader it does not exist, and a row that navigates to a 404 is worse than a row that
does not navigate. This file exists to record the size of the remainder, not to call it a
bug.

## Why it matters

20 of 25 sub-destinations are placeholders, so the product is a good deal smaller than
its own navigation claims. Worth knowing before promising a demo, and worth deciding
deliberately rather than discovering when somebody clicks.

## What to do

Not "build them all". Each tab is its own screen with its own data needs, and several
would need capabilities no provider declares — infrastructure's `messaging` wants
`cloud.queues`, `security` and `capacity` want readings nothing currently produces. Pick
them off in the order the product wants them, and for each:

1. Check which capabilities it needs and whether anything answers them. If nothing does,
   that is a source task first — see the `cloud-queues` and `cloud-alerts` files.
2. Give it a real route rather than an entry in the `[tab]` fallback. The fallback's job
   is to be the honest answer for what is not built, not a place to grow a screen.
3. Add its resources to `/api/v1` in the same change. "Every new screen owes the API its
   resources" is in `CLAUDE.md`, and it is the rule most easily forgotten under a
   deadline.
4. Add its route to `ROUTES` in `e2e/harness.ts`, so the render sweep covers it.

## Where

- `src/lib/platform/domains.ts` — `DOMAIN_TABS`
- `src/lib/platform/services.ts` — `SERVICE_TABS`
- `src/lib/platform/infrastructure.ts` — `INFRA_TABS`
- `src/routes/{domains/[slug],services/[slug],infrastructure}/[tab]/` — the fallbacks
- `src/lib/server/platform/fixtures.ts` — the nav list and its `available: false` entries
- `src/lib/components/app/AppSidebar.svelte` — the built / "Coming soon" split
