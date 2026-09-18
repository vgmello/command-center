# Narrow Azure ownership reads server-side, not after the fact

**Status:** a stated ceiling, not a bug. Do it when a real subscription outgrows the
current shape.

## What is missing

A domain's Infrastructure tab asks Azure for the resources it owns, and today "asks" means
"fetch everything the estate screen would fetch, then keep the rows tagged
`<ownerTagKey>=<slug>`". `ownsResource(tags, key, value)` is applied in memory to lists
`loadMachines()` and the cluster/storage/database collects already return — there is no
tag-filtered request on the wire. Two compounding gaps, not one:

1. **No server-side narrowing.** ARM documents tag `$filter=tagName eq '<key>' and tagValue
eq '<value>'` on `/subscriptions/{id}/resources` and the resource-group-scoped `/resources`
   — not on the type-specific lists this provider already calls
   (`Microsoft.Compute/virtualMachines` and the rest). So even a correct implementation of
   this ceiling would need a different endpoint, not a parameter on the current one.
2. **`owned()` runs after `collect(limit)`.** In `listClusters`, `readStorage` and
   `listDatabases`, the owner filter is applied to a list already capped at `limit` — so a
   domain whose resources sit past that cap in query order is undercounted even before the
   first gap is reached.

## Why it matters

Not yet. The seeded estate is well under any list's page size, so every bound domain sees
its full set today. It matters the moment a subscription is large enough that `limit` (or
`nodeLimit`) truncates the estate before the domain filter runs — a domain could report
fewer clusters or databases than it actually owns, with nothing on the panel admitting a
cap was hit before ownership was even checked.

## What to do

1. Pre-select the domain's resource ids via `/subscriptions/{id}/resources?$filter=tagName
eq '<key>' and tagValue eq '<value>'` (or Azure Resource Graph, which answers the same
   question across resource types in one query), then fetch details for those ids only.
   This is the same shape as the Monitor `metrics:getBatch` ceiling already on record — a
   different endpoint, not a parameter on this one.
2. Once ownership is resolved before the list call, apply `limit` to the _owned_ set, not
   the estate's — fixing gap 2 as a consequence of fixing gap 1, not as a separate patch.
3. Keep the client-side `ownsResource` check as the estate path's mechanism (the estate
   screen has no owner to filter by) and as the fallback for any list this provider adds
   that Azure's tag `$filter` does not cover.

## How to know it worked

Seed a subscription (or a test double) with more owned resources than `limit`, and assert a
domain's cluster/storage/database counts match the true owned count, not `limit`. That
assertion fails today and is the point of the change.

Count the requests too: a real subscription's ownership read should no longer be "fetch the
whole estate, then filter" — the wire should show the `$filter`ed (or Resource Graph) call
instead of the full list.

## Where

- `src/lib/server/sources/providers/azure/index.ts` — `owned()`, `loadMachines()`, and the
  three `collect(limit)` call sites (`listClusters`, `readStorage`, `listDatabases`)
- `src/lib/server/sources/providers/azure/client.ts` — where a `/resources?$filter=…` or
  Resource Graph method would live alongside the existing list methods

## Blocked on

floci-az does not emulate the generic `/resources` list (or Resource Graph), only the
type-specific lists this provider already calls — so the filtered call this fix needs has
nothing to verify against locally until the emulator grows it, or until this is tried
against a real Azure subscription.
