# A trends-only connection's runs vanish from the estate in a mixed registry

**Status:** open. Minor — pre-existing in kind, not a regression this branch caused.

## What is missing

`readTrends` decides which of its two paths to take by asking the _whole registry_
whether any connection supports `deployment.serviceTrends`
(`deps.registry.supporting('deployment.serviceTrends').length > 0`), not by asking each
connection individually. In a mixed registry — one connection declaring
`deployment.serviceTrends`, another declaring only `deployment.trends` — that check is
true, so `readTrends` takes the per-service path for the _entire_ estate read. The
per-service path is built from `readServiceTrends`, which dispatches
`deployment.serviceTrends` to `supporting(cap)[0]` — the first connection that declares
it — so the trends-only connection's own runs are never read at all and silently drop out
of the estate figure.

Pre-existing in kind: `fanOutSeries` already reads `supporting(cap)[0]` rather than
fanning out across every connection that declares a capability, so "only the first
declaring connection answers" is not new here. What is new is that `readTrends` — the
estate read every deployments screen depends on — now inherits that same single-connection
behaviour by way of the `serviceTrends` migration, where before it had its own
`deployment.trends` accumulation that every declaring connection could still write to.

The comment at `src/lib/server/sources/routers/deployment.ts:~64-70` over-promises: it
describes the estate figure as "the sum over every entity", which is true within a single
connection's rows but not across a registry where connections disagree on which
capability they declare.

## Why it matters

A production deployment with more than one connection behind `DeploymentSource` — plausible
during any staged rollout of a new adapter — would show an estate deployment count that
quietly excludes one connection's runs, with nothing on the page saying so. Low urgency
today because no shipped configuration mixes connections this way, but it is exactly the
shape of silent undercount `CLAUDE.md`'s stated-gap doctrine exists to prevent.

## Also, two smaller Task 9 findings worth fixing alongside this one

- **`estateTrendsOf`'s `meanDuration` is asserted nowhere.** `routers.test.ts`'s
  `'the estate figure is the sum of the services'` test only sums `frequency`
  (`runs`/`durationTotal`'s frequency side); nothing exercises the `meanDuration` field
  `estateTrendsOf` also computes. One assertion in `domain-deployments.test.ts` — or a
  second assertion in the router test — closes it.
- **The capability sweep proves the fallback _renders_, not that it _answers correctly_.**
  `capability-gaps.test.ts`'s `outcome()` only distinguishes "threw" from "did not throw" —
  dropping `deployment.serviceTrends` and taking the `deployment.trends` fallback passes
  the sweep as long as _something_ comes back, with no check that the fallback's numbers
  are the right numbers.

## What to do

Make the per-connection nature of the decision explicit, rather than a registry-wide
either/or: either fan `readTrends` out across every connection and merge the results per
connection's own capability (mirroring what `readServiceTrends` would do if it were
extended to fan out rather than take the first), or accept the current one-connection
behaviour explicitly and correct the comment at `deployment.ts:~64-70` to say so instead
of promising a sum over every entity.

## Where

- `src/lib/server/sources/routers/deployment.ts` — `readTrends`, the registry-wide
  `supporting('deployment.serviceTrends').length > 0` check, and the over-promising
  comment
- `src/lib/server/sources/routers/shared.ts` — `fanOutSeries`'s `supporting(cap)[0]`
  single-connection dispatch
- `src/lib/server/sources/routers/routers.test.ts` — where a mixed-registry test would
  live, and where the `meanDuration` assertion belongs
- `src/lib/server/platform/capability-gaps.test.ts` — `outcome()`, if the fallback's
  correctness is ever worth asserting there too
