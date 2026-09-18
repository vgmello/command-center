# Incidents and deployments have no page of their own

**Status:** open. Nothing blocks it.

## What is missing

Incident rows and deployment rows are rows, not links. The domain table's row-actions
menu does not navigate either, and the deployment insight rows have no "View report"
link. All of that is the "do not ship links to routes that do not exist" rule holding —
`/incidents/[id]` and `/deployments/[id]` are not built, so nothing offers them.

The rule has already been paid off once: `/domains/[slug]` landed, and the domain table's
rows, the service breadcrumb's domain step and the service info card's Domain row became
links in the same change. These two are the remainder.

## Why it matters

A deployment row carries a version, an environment, a status and a duration, and that is
all a reader can ever learn about it — there is nowhere to go for the logs, the diff, the
runbook or the rollback. Same for an incident. The deployments screen is a feed with no
depth behind it.

## What to do

For each of the two:

1. Decide what the page is for. A deployment detail page that repeats the row is not
   worth a route; one that carries the run's steps, its artifacts and a link back into
   Octopus is. `resourceLink()` on the provider already knows how to address a resource in
   its own system — that is what the "Show in Azure" deep link uses, and the deployment
   equivalent is the same mechanism.
2. Check the source can answer it. `DeploymentSource` serves a log and its aggregates; a
   single run by id may be a new capability, in which case it is declared only once
   implemented.
3. Build the route, publish its resource under `/api/v1`, and only then make the rows
   links — in that order, so the rule is never briefly broken.
4. Add the route to `ROUTES` in `e2e/harness.ts`.

## Where

- `src/lib/components/deployments/` — the rows
- `src/routes/deployments/` — where `[id]` would live
- `src/lib/server/sources/contracts.ts` — `DeploymentProvider`, if a by-id read is new
- `src/lib/server/sources/provider.ts` — `resourceLink`, `LinkView`
- `CLAUDE.md`, "Do not ship links to routes that do not exist" — the rule this is under
