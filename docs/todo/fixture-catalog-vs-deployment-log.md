# The fixture catalog and deployment log disagree on which services exist

**Status:** open, and sizeable — not a one-file fix.

## What is missing

Two fixture sets describe overlapping ground and were seeded independently. The service
catalog (`FixtureCatalogSource`) holds **6** services in total. The deployment log
fixtures (`src/lib/server/sources/fixtures/deployment.ts`) name **26** distinct services
across their rows. A domain's per-service deployment rollup is catalog-scoped — it only
ever sums the services the domain's catalog entry owns — while the log beneath it lists
every run _attributed_ to the domain, naming services the catalog has never heard of.

Concretely, on `payment-domain`: the catalog says it owns 2 services, and the Deployments
tab's per-service table has exactly 2 rows for that reason. The domain's own deployment
log (same tab, `deployment.log` tier) lists 12 rows naming 8 distinct services, only 2 of
which match a catalog entry. The tab states the discrepancy in its own caption — "Last 14
days · services this domain owns" — rather than paper over it, but the two numbers on one
screen still disagree with each other by construction.

## Why it matters

This is exactly the failure `CLAUDE.md`'s "A fixture must cover what another fixture
claims" rule exists to prevent: two fixtures, one quantity two different fixture sets
answer differently, and a reader comparing a header total against a row count is handed
the difference with no explanation beyond a caption. It was caught here because the tab
states its scope; a screen that assumed agreement instead would just look wrong.

Pre-existing — this is not something Task 9 introduced, only exposed by building the
first screen that puts the catalog's service count and the deployment log's service names
side by side.

## What to do

Per the "A fixture must cover what another fixture claims" rule: derive one seed from the
other rather than seeding both by hand.

1. Decide direction. Growing the catalog to 26 services (matching the log) is the more
   complete fixture but moves every domain's service count, the domain tables and the
   service pages — a wide blast radius for a fixture change. Shrinking the log's service
   vocabulary to the catalog's 6 is narrower but makes the deployment log fixture data
   thinner and less representative of a real estate.
2. Whichever direction: generate the losing side from the winning one (the way
   `listServiceVitals` already derives its rows from a domain's `serviceCount`, per
   `CLAUDE.md`'s own fixture rule), so the two sets cannot drift apart again by
   construction rather than by discipline.
3. Re-check every fixture-backed number that reads either set — domain service counts,
   the domains table, service detail pages, the deployments screen's per-domain
   breakdown — since whichever direction is chosen changes several of them at once.

## Where

- `src/lib/server/catalog/fixture-source.ts` — the 6-service catalog
- `src/lib/server/sources/fixtures/deployment.ts` — the 26-service deployment log
- `src/lib/server/platform/domain-tabs-view.ts` — `buildDomainDeploymentsSnapshot`, the
  screen that puts both numbers on one page today
- `CLAUDE.md`, "A fixture must cover what another fixture claims"
