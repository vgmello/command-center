# A gap-capable route's 501/502 is real but undocumented

**Status:** open. Minor, and consistent with an existing sitewide pattern rather than a
defect in the two routes that surfaced it.

## What is missing

`GET /api/v1/domains/{slug}/deployments` and `GET /api/v1/domains/{slug}/slo` (Task 11)
both genuinely answer 501 (`CapabilityUnavailableError`) or 502 (`SourceFailedError`) at
runtime when a source cannot serve one of their panels — `requirePanel<T>` reconstructs the
capability error from an already-resolved `Panel` so the existing `errorResponse` mapping
handles it, exactly as every other gap-capable read does. Neither route documents a `501`
or `502` response in its `@swagger` block.

The reason is `openapi.test.ts:192-211` ("every operation is authenticated, scoped, and has
an error contract"), which asserts the **exact** response-key set for every operation —
`['200', '400', '401']`, or `['200', '400', '401', '404']` for a parameterised path — with
no allowance for a route-specific extra code. `/api/v1/activity`, the literal precedent for
this shape (a composed read that can throw a capability gap), does not document a 5xx
either, despite being able to return one at runtime by the same path. So the two new routes
were built to the already-established pattern: the runtime guarantee holds and is asserted
at the unit level (`respond.test.ts`'s three `requirePanel` cases), but the published
OpenAPI document is silent on it, for these routes and for `activity` alike.

## Why it matters

An external caller reading the OpenAPI reference has no way to know a 501/502 is possible
on these paths, or what shape it takes (`CapabilityUnavailableError`'s named capability and
kind, `SourceFailedError`'s named source) — the document undersells the API's own honesty
about gaps. Not urgent: the runtime behaviour is correct and tested, and this is a
documentation gap rather than a behavioural one.

## What to do

Widen `openapi.test.ts`'s exact-response-set assertion to allow (or require) a `501` and/or
`502` entry on any route whose handler can throw a capability error, then document those
responses in the `@swagger` blocks for every such route — `activity`, `domains/{slug}/deployments`,
`domains/{slug}/slo`, and whichever others compose a source-backed read outside `panel()`
or call `requirePanel` on one that is. Do this once, sitewide, rather than carving a
one-off exception into the assertion for two routes — the whole reason the test asserts an
exact set is that "a route-specific extra code" is exactly the kind of quiet drift it
exists to catch.

## Where

- `src/lib/server/api/v1/openapi.test.ts:192-211` — the exact response-key-set assertion
- `src/routes/api/v1/domains/[slug]/deployments/+server.ts`,
  `src/routes/api/v1/domains/[slug]/slo/+server.ts` — the two new routes, undocumented
- `src/routes/api/v1/activity/+server.ts` — the pre-existing precedent, also undocumented
- `src/lib/server/api/error-response.ts` — `requirePanel`, `errorResponse`
- `src/lib/server/api/respond.test.ts` — the three `requirePanel` cases proving the runtime
  behaviour already
