# The service catalog

Where the services and domains themselves come from — as opposed to how they are doing,
which the [data-source plugins](2026-09-04-data-source-plugins-design.md) already answer.

**The catalog starts as a git-backed file and is expected to become a database.** Every
decision below is made so that swap is one new class and one environment variable, with
nothing above it changing.

## Why this is a port and not a table

Split `Service`'s fields by who could possibly know them:

|                | Fields                                                                                                                                      | Who knows                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Declared**   | `name` `description` `serviceType` `language` `runtime` `owner` `repository` `chatChannel` `runbook` `dashboard` `domainId` `icon` `accent` | only a person or a registry |
| **Discovered** | `status` `instancesHealthy` `instancesTotal` `activeAlerts`                                                                                 | APM                         |
| **Identity**   | `slug` `id`                                                                                                                                 | both                        |

`Domain` splits the same way: `name`, `shortName`, `criticality`, `owner` and `accent` are
declared; `healthScore`, `errorRatePct`, `p95LatencyMs`, `activeIncidents` and
`availability7dPct` are read; `serviceCount` is derived.

Coralogix knows what is emitting telemetry. Octopus knows what is deploying. **Neither
knows what a service _is_** — who owns it, where its runbook lives, which domain it
belongs to. That is a third kind of question, so it gets its own port.

## The shape

`CatalogSource` is a fifth port, resolved the way `WorkspaceSource` is — from
`CATALOG_SOURCE`, **not** through the router and dispatcher.

Fan-out is wrong here. The dispatcher exists to ask "which connection owns this
resource" and to merge answers from several; a catalog answers "what is `payment-api`"
and there is exactly one right answer. Routing it would mean deciding what to do when two
catalogs disagree about a service's owner, which is a question with no good answer and one
nobody asked.

```ts
interface CatalogSource {
	readonly id: string;
	listDomains(): Promise<CatalogDomain[]>;
	findDomain(slug: string): Promise<CatalogDomain | null>;
	listServices(domainId?: string): Promise<CatalogService[]>;
	findService(slug: string): Promise<CatalogService | null>;
	listOwners(): Promise<string[]>;
}
```

### What the port returns is not what the UI renders

`CatalogDomain` and `CatalogService` are **new types carrying the declared half only**.
They are deliberately not `Domain` and `Service`, which carry readings a catalog cannot
produce.

This is the load-bearing decision for replaceability. A port that returned `Service`
would force every implementation — the file, and later the database — to invent a
`status` and an `activeAlerts` it has no way to know. The types make that impossible to
express, so the merge happens in one place above the port instead of being fudged inside
each implementation.

```ts
interface SourceIdentity {
	/** How this service is named in each connected source. Defaults to the slug. */
	apm?: string;
	deployment?: string;
	cloud?: string;
}
```

`identity` is declared, not discovered: only a person knows that Octopus calls it
`Payment API` while Coralogix calls it `payment-api`. It is also the seed of the bindings
that make "Show in Coralogix" resolve to the right resource — cheap to record now, a
migration to add later.

### What the port deliberately does not have

- **No scope.** A catalog describes what exists; whether something is running in staging
  is a reading, not identity. A port that took `PlatformScope` would invite an
  implementation to return different services per environment, and then two screens would
  disagree about how many services there are.
- **No paging or sorting.** The domain table sorts by health score, which the catalog does
  not hold — so pushing sort down is impossible in principle, and pretending otherwise
  would give a database an interface it cannot honour. `listServices(domainId)` is the one
  filter a catalog _can_ answer, so it is the one filter the port takes.
- **No file, path, format or reload.** Nothing in the signature admits that today's
  implementation reads a file. A `reload()` would be a file concept leaking into a
  contract a database would have to implement as a no-op.

Every method is `async` even though the file implementation resolves immediately, for the
same reason the data-source ports are: a synchronous port would have to be rewritten,
along with every caller, the first time real I/O appeared.

## The file

`Bun.YAML.parse` is native, so YAML costs no dependency — tier 2 of the API selection
order. JSON parses through the same path, so a deployment that would rather generate JSON
can.

```yaml
version: 1

domains:
  - slug: payments
    name: Payment Domain
    shortName: Payment
    owner: '@payments-team'
    criticality: critical
    icon: landmark
    accent: blue

services:
  - slug: payment-api
    name: payment-api
    domain: payments
    description: API gateway for payment processing
    owner: '@payments-team'
    type: API Gateway
    language: .NET 8
    runtime: Kubernetes
    links:
      repository: https://github.com/acme/payment-api
      chat: https://acme.slack.com/archives/C123
      runbook: https://wiki.acme.com/runbooks/payment-api
      dashboard: https://coralogix.com/…
    identity:
      apm: payment-api
      deployment: Payment API
```

`shortName` is written rather than derived by stripping "Domain": a domain is called what
its owners call it, and a client that guesses gets it wrong the first time one is named
"Domain Registry".

### Validation

Valibot, and **a bad file refuses to boot** — the same doctrine as `SOURCES_CONFIG` and
the port resolver's throw-on-unknown-name. A catalog that silently drops the entries it
could not parse is a dashboard quietly describing a smaller platform than the one that
exists.

Three errors are worth naming because a schema alone would not catch them:

- a service naming a domain that is not declared
- two services, or two domains, sharing a slug
- a link that is not a URL — a runbook field holding a Confluence page _title_ is the
  commonest way this file goes wrong, and it fails at the click rather than at boot

## What the swap to a database costs

One class implementing `CatalogSource`, and one entry in the resolver. Concretely, nothing
else changes because:

- the port speaks in domain types, not rows or documents
- the declared/discovered split is in the _types_, so a database cannot accidentally be
  asked for a health status
- the merge with live readings already lives above the port
- ids are provider-assigned; the file derives them from slugs, a database may use its own,
  and nothing above depends on their shape

The one thing a database gains that the file cannot have is writes. `CatalogSource` is
read-only on purpose: adding `createService` now would be designing an editing surface
against a file that has no way to implement it, and the shape of that surface should be
decided when there is a real store and a real form behind it.

## The consequence, stated plainly

Once the file is the catalog, it supplies identity only — so **every service reads
`unknown` until the readings are joined back on.** `HealthStatus` already carries
`'unknown'`, so this renders honestly rather than as a broken page, but it is a visible
degradation and it is why the join is in scope here rather than deferred.

The join is a new capability, `apm.serviceHealth`: status, instance counts and alert
counts **per service, in one grouped query**. Asking per service would be N round trips to
draw one table, and the fleet-insight queries already established that the metrics API
answers this shape in a single request.

Where no APM source is connected, or none implements the capability, the readings stay
`unknown` and the catalog still renders. That is the correct answer to "what is the health
of a service nothing is watching".

## Out of scope

- **Discovery and reconciliation.** Comparing the declared catalog against what is
  actually emitting or deploying — unregistered services, dead entries, identity drift —
  is the obvious next thing and is deliberately not here. A catalog that telemetry churn
  can rewrite is not a catalog.
- **Writes**, for the reason above.
- **Per-environment existence.** A service is declared once.
