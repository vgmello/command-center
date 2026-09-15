# Route resource reads through `dispatcher.one()`

**Status:** ready to do. The blocker it was waiting on has landed.

## What is missing

`Dispatcher` has two rules: `all()` fans out across every capable connection, and
`one()` routes a resource-scoped read to the connection its binding names. `one()` is
implemented and tested. **Nothing calls it.** Every router uses the fan-out helpers,
including for reads that are about one resource.

Two comments still describe that as a wait for work that is now done:

- `dispatch.ts` — "adopted when bindings land on the catalog records (spec increment 6)"
- `routers/platform.ts` — `bindingFor()`, "a binding standing in for the catalog's, until
  bindings land on domain records"

Bindings landed in `feat: catalog bindings, and publish what is connected`.
`CatalogBinding`, `bindings` on `CatalogDomain` and `CatalogService`, and `bindingFor()` /
`identityFor()` all exist and prefer a declared binding. So the stand-in in
`routers/platform.ts` is now a stand-in for something real.

## Why it matters

Today it costs nothing, and that is the whole reason it is easy to leave: with one
connection per kind, fanning out and routing reach the same place. It starts costing the
moment a second cloud or a second APM is configured — a resource-scoped read would query
every connection, and the one that does not own the resource answers about something
else or fails. Adopting it while the two are equivalent is how it gets adopted without a
bug report.

## What to do

1. Replace `bindingFor(slug)` in `routers/platform.ts` with the catalog record's own
   binding — the record is what `catalogBindingFor` was always meant to be handed.
2. Switch the resource-scoped reads from `fanOutSingle` to a `one()`-backed helper.
   `readDomainVitals` is the clear case: it takes a slug and asks about that domain.
   Audit the rest against the question "is this about one resource, or about the
   estate?" — `listPlatformInsights`, `readRates` and `listIncidents` are fleet-wide and
   stay on fan-out, and the comment above `listPlatformInsights` already says why.
3. Delete both stale comments.

## How to know it worked

Configure two connections of one kind in a test and assert a resource-scoped read hits
only the one the binding names. That test cannot pass today and is the point of the
change — write it first and watch it fail.

`dispatch-tiers.test.ts` already asserts every capability's dispatch helper matches its
tier; check it still holds, and extend it if `one()` needs a tier rule of its own.

## Where

- `src/lib/server/sources/dispatch.ts` — `Dispatcher.one()`, implemented and tested
- `src/lib/server/sources/routers/platform.ts` — `bindingFor()`, the stand-in
- `src/lib/platform/catalog.ts` — `CatalogBinding`, `bindingFor`, `identityFor`
- `src/lib/server/sources/routers/shared.ts` — the fan-out helpers `one()` would sit beside
