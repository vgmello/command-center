# Azure provider, and choosing between invented and real

**Status:** proposed
**Implements** increments 4–5 of `2026-09-04-data-source-plugins-design.md`, which the
framework plan deferred: _"Scope of this plan: spec increments 1–3 only. Increments 4–6
(floci-az harness, Azure provider, catalog bindings, `/api/v1/sources`) are a separate
plan."_

## Where things stand

There is no Azure integration. `REAL_PROVIDERS` is Octopus and Coralogix; there is no
`@azure/*` dependency and no `azure/` provider directory. Every mention of Azure in the
source is a doc comment or an example label.

So the `cloud` kind has exactly one provider — `fixture-cloud`, in-process and seeded — and
everything on `/infrastructure` is invented: regions, nodes, clusters, databases, queues,
storage and spend.

## Choosing between the fixture and the real thing

**The mechanism already exists, and no new selection machinery is needed.** There are two
independent switches, and they are separate on purpose.

### Switch 1 — which provider serves a kind

The connections file that `SOURCES_CONFIG` names. One entry per connection, and its
`provider` field decides.

| `SOURCES_CONFIG`       | `cloud` served by | Used for                                   |
| ---------------------- | ----------------- | ------------------------------------------ |
| unset                  | `fixture-cloud`   | unit tests, and a checkout with no setup   |
| `sources.example.json` | `fixture-cloud`   | local stack — real Octopus/Coralogix paths |
| `sources.local.json`   | `azure`           | full E2E against floci-az                  |
| `sources.<env>.json`   | `azure`           | a real subscription                        |

The fixture is never deleted and never needs to be. It stays registered and is what the
app falls back to with no configuration at all, which is the property that keeps `bun test`
fast and a fresh clone runnable.

`SOURCES_ALLOW_FIXTURES=true` is what lets a connections file name a fixture at all.
Without it a file naming one is refused, so a production config cannot quietly serve seeded
numbers — the same doctrine as the resolver's throw-on-unknown-name.

### Switch 2 — where the real provider points

`baseUrl` in the Azure connection's own settings, exactly as it already works for Octopus
and Coralogix against their mocks:

```jsonc
{ "id": "azure-local", "provider": "azure",
  "settings": { "baseUrl": "http://localhost:4577", "subscriptionId": "…" } }   // floci-az

{ "id": "azure-prod", "provider": "azure",
  "settings": { "subscriptionId": "…", "clientSecret": { "$env": "AZURE_SECRET" } } }
```

Omitting `baseUrl` means real Azure. Only the endpoint differs — the provider, its mapping,
its paging and its auth are the production code path in both cases. That is the whole point
of the harness: an E2E run exercises the code that runs in production, not a stand-in for
it.

### What must never happen: both at once

Already implemented, ahead of this spec, because it is a live foot-gun the moment an Azure
provider exists.

The aggregate dispatch rule fans out across **every** capable connection and concatenates.
Two connections of one kind is a supported and deliberate arrangement — two Azure
subscriptions, two Octopus spaces, merged into one estate. That is exactly what makes
mixing a fixture in dangerous: `/infrastructure` would show real regions plus invented ones,
every total wrong, with nothing on the page admitting it.

So `ProviderDefinition` gained a `synthetic` flag, the three fixtures set it, and
`loadConnections` refuses a synthetic connection that shares its kind with any other:

```
Connection "fx" invents its data, so it must be the only cloud source.
Also connected: "azure-prod". Remove one — a fixture beside a real source
merges invented rows into real ones.
```

Refused at boot, not rendered. A misconfiguration that shows plausible numbers is worse
than one that will not start. Two _real_ sources of a kind remain allowed, and a test pins
that so the guard cannot over-reach.

## Increment 4 — the harness

A `floci-az` service in `docker-compose.yml` on `:4577`, alongside the Postgres that is
already there, plus a `sources.local.json` naming it.

floci-az serves ARM, Monitor and Entra, so `@azure/identity` authenticates against it and
the provider talks to it as it would to Azure.

**The known gap, recorded in the original spec:** floci-az does not emulate Cost
Management. `cloud.cost` therefore needs an in-repo mock REST server, the way Octopus and
Coralogix already have one, started by the same `bun run dev:stack` script. Worth knowing
before starting rather than discovering at the end.

## Increment 5 — the provider

`CloudProvider` against ARM and Monitor. Nine capabilities:
`cloud.regions`, `nodes`, `clusters`, `utilization`, `storage`, `databases`, `queues`,
`alerts`, `cost`.

**Declare only what is implemented.** A provider that answers nodes but not queues declares
eight and the ninth becomes a stated gap. The capability sweep added in
`capability-gaps.test.ts` already asserts that a partial cloud provider costs the reader
that panel and not the dashboard, so a staged rollout is safe by construction — which is
the payoff for the framework work having gone first.

**One new dependency:** `@azure/identity`, which the original spec already sanctioned. It
is security-sensitive (token acquisition), which is the case where the API selection order
says take the dependency rather than hand-roll.

**Tier the capabilities.** Regions, nodes, clusters, databases, queues, storage and cost are
`reference`; utilization and alerts are `live`. That mirrors the existing table and needs no
new tier. Nothing should be declared `series` — `tiers.test.ts` now refuses a `series`
capability that no router accumulates.

**Push the query down.** Same rule the ports already encode: ask ARM for the aggregate, not
for every resource to count in memory.

## Testing

Three layers, each answering a different question, and the switch above is what selects
between them:

| Layer          | Config               | Answers                                      |
| -------------- | -------------------- | -------------------------------------------- |
| unit           | none — fixtures      | does the logic hold                          |
| contract / E2E | `sources.local.json` | does the adapter speak the real API          |
| smoke          | `sources.<env>.json` | does the real subscription behave as assumed |

The contract layer is the one worth building carefully, and it is where the request-budget
and capability-gap tests should be extended to cover the cloud kind — both currently prove
nothing about a real cloud adapter because there is not one.

## Out of scope

- **Increment 6** — catalog bindings and `/api/v1/sources`.
- **A second cloud provider.** `floci`, `floci-gcp` and `floci-oci` make one cheap to
  validate later, and the point of doing Azure behind `CloudProvider` is that a second is a
  provider file rather than a refactor.
