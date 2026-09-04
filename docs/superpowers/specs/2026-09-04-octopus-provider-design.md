# Octopus Deploy provider

An increment of [the data-source plugin design](2026-09-04-data-source-plugins-design.md).
That work built the framework and shipped three fixture providers. This one writes the
first **real** provider: a `DeploymentProvider` speaking the actual Octopus Deploy REST
API, plus a mock that serves the same wire contract so it can be tested without an
instance.

**The whole point:** the adapter is written against the real API. Pointing `baseUrl` at
the mock or at a customer's Octopus server is a configuration change and nothing else —
no branch in the code, no test double injected, no "if mock" anywhere.

## The contract, as it actually is

Taken from the live Swagger document at `https://demo.octopus.app/api/swagger.json`
(Octopus Server API, `swagger: "2.0"`, `basePath: /api`), not from memory.

| Need                   | Endpoint                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| Deployments            | `GET /api/{spaceId}/deployments?skip&take&projects&environments&taskState` |
| One deployment         | `GET /api/{spaceId}/deployments/{id}`                                      |
| Tasks (status, timing) | `GET /api/tasks?ids&take&skip&states&fromStartDate&toStartDate`            |
| Releases (version)     | `GET /api/{spaceId}/releases?ids&take`                                     |
| Projects               | `GET /api/{spaceId}/projects?ids&take`                                     |
| Project groups         | `GET /api/{spaceId}/projectgroups?take`                                    |
| Environments           | `GET /api/{spaceId}/environments?take`                                     |

Authentication is the header **`X-Octopus-ApiKey`**. Collections are paged and wrapped:

```jsonc
{ "Items": [...], "ItemsPerPage": 30, "TotalResults": 412, "NumberOfPages": 14, "Links": {} }
```

Thirty items per page is the server's default.

### The join this forces

`DeploymentResource` carries **no status, no duration and no outcome**. Its fields are
`Id, ProjectId, EnvironmentId, ReleaseId, TaskId, Created, DeployedBy, DeployedById,
SpaceId, Comments, Name`. Everything a deployment row needs to _report_ lives on
`TaskResource`: `State`, `Duration`, `StartTime`, `CompletedTime`, `ErrorMessage`,
`FinishedSuccessfully`.

So one page of rows is **two calls, not one plus N**: fetch the deployments, collect
their `TaskId`s, and fetch those tasks in a single `?ids=` batch. Asking per row would
issue thirty requests for thirty rows, and a real server would rate-limit long before a
reader noticed the page was slow.

Projects, project groups and environments are small and slow-moving. They are fetched
once per connection and held behind the existing `SourceCache` under their own long TTLs,
because a deployment row needs a project's _name_ and every row would otherwise re-read
the same handful of records.

## Mapping Octopus onto the domain

### Status

`TaskResource.State` is `Queued | Executing | Failed | Canceled | TimedOut | Success |
Cancelling`. Ours is `success | failed | in-progress | rolled-back`.

| Octopus                             | Ours          | Why                                                                                   |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `Success`                           | `success`     |                                                                                       |
| `Failed`, `TimedOut`                | `failed`      | A run that timed out did not deploy.                                                  |
| `Canceled`                          | `failed`      | It did not succeed, and counting it as success would flatter the change-failure rate. |
| `Queued`, `Executing`, `Cancelling` | `in-progress` | Cancelling is still running.                                                          |

**`rolled-back` is never emitted.** Octopus has no such task state — a rollback there is
an ordinary deployment of an earlier release, indistinguishable at this layer from any
other deployment. Inferring one by comparing release versions would misreport a
deliberate downgrade, and inferring it from a name containing "rollback" would depend on
a customer's naming convention. `DeploymentSummary.changeFailureRatePct` counts failures
and rollbacks together, so against Octopus it counts failures alone; that is stated here
rather than silently under-reported.

### Trigger

Octopus records **who** ran a deployment (`DeployedById`), not **what kind of thing** they
were. A user account gives `manual`; anything else — a service account, a runbook, an
automated process — gives `ci-cd`. `gitops` and `rollback` are never emitted, for the
same reason as above: the API does not carry the distinction and guessing it would put a
label on a row that nothing in the upstream supports.

### Environment

Octopus environments are free text: an instance may call production `Production`,
`Prod`, or `PRD`. The provider normalises the name (lowercased, non-alphanumerics
stripped) and matches `production|prod|live`, `staging|stage|uat|qa`,
`development|dev|test`. A connection may override the whole thing with an explicit
`environments` map from Octopus environment id to ours, because no normaliser survives
contact with every customer's naming.

An environment that matches nothing is **skipped, not guessed** — its deployments do not
appear under a scope they may not belong to.

### Domain

An Octopus **project group** is our domain, and a **project** is our service. This is a
native mapping rather than a placeholder: `ProjectResource.ProjectGroupId` exists,
`/projectgroups` lists them, and grouping projects is what project groups are _for_.

This is the one place this increment does better than the framework's interim helpers —
`readDomainBreakdown` and `listDeployingDomains` are real here, not stand-ins.

### Remaining fields

| Ours              | From                                                      |
| ----------------- | --------------------------------------------------------- |
| `id`              | `DeploymentResource.Id`                                   |
| `reference`       | the numeric tail of the id, printed `#1234`               |
| `service`         | `ProjectResource.Slug`                                    |
| `version`         | `ReleaseResource.Version`                                 |
| `deployedBy`      | `DeploymentResource.DeployedBy`                           |
| `deployedAt`      | `TaskResource.StartTime`, falling back to `Created`       |
| `durationSeconds` | `CompletedTime − StartTime`, and **`null` while running** |
| `icon`            | a fixed key per provider; icons are ours, not Octopus's   |

## Capabilities

Seven of the eight `DeploymentProvider` methods are implemented. **`deployment.insights`
is not declared** — Octopus reports what ran, not an opinion about what it means, and an
insight invented in the adapter would be our editorial dressed as the upstream's. The
router turns the undeclared capability into a stated gap, which is exactly what the
capability model is for.

`deployment.summary`, `deployment.statusTrend`, `deployment.trends` and
`deployment.breakdown` are computed from a window of deployments the provider fetches
once and reuses, rather than from four separate sweeps of the same rows.

## The mock

`mock/octopus.ts` is a **`Bun.serve` handler** implementing the endpoints above, with
seeded, deterministic, Octopus-shaped data: real-looking project names and slugs, project
groups, environments, release versions, task states with plausible durations, and paging
that honours `skip`/`take` and reports `TotalResults` and `NumberOfPages` correctly.

It is a mock **server**, not a stubbed `fetch`. The provider's own HTTP path, auth header,
paging loop, query-string building and error mapping all execute for real. A test double
inside the client would leave exactly those parts unexercised — and they are the parts
that break against a real instance.

The mock enforces the contract rather than merely answering: a request with no
`X-Octopus-ApiKey`, or the wrong one, gets `401`; an unknown id gets Octopus's own
`{ "ErrorMessage": "The resource you requested was not found." }` with `404`; `take`
above the server maximum is clamped.

## Errors

The client maps transport and HTTP failures onto the framework's existing vocabulary. A
`401` or `403` is a configuration fault and must not read as an outage; a `404` on a
lookup is an ordinary answer; `429` and `5xx` are the upstream failing. All of them
surface as `SourceFailedError` from the dispatcher, which the panel layer will render as
"Octopus did not answer" rather than as an empty estate — the distinction the framework
already draws between a gap and a failure.

**No response body is ever put into an error message.** An Octopus error can echo request
context, and the settings that built the request hold an API key.

## Settings

```jsonc
{
	"id": "octopus-prod",
	"provider": "octopus",
	"label": "Octopus — Production",
	"settings": {
		"baseUrl": "https://octopus.example.com", // or the mock's URL
		"apiKey": { "$env": "OCTOPUS_API_KEY" },
		"spaceId": "Spaces-1",
		"environments": { "Environments-1": "production" } // optional override
	}
}
```

`baseUrl` is what makes the mock and a real server interchangeable. `apiKey` is an `$env`
reference, resolved by the existing loader, and never printed — the settings validator
already reports failing key paths without their values.

## Out of scope

- Coralogix, which is the next increment and shares this one's HTTP groundwork.
- `deployment.insights`, for the reason above.
- Writing to Octopus. This provider reads; nothing here creates or cancels a deployment.
- Bindings — spec increment 6. The project-group mapping is genuine, so this increment
  does not add a placeholder, but per-resource routing still waits on bindings.
