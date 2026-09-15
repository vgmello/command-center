# `cloud.queues` — nothing answers it

**Status:** blocked. The emulator cannot provision the resource.

## What is missing

`InfrastructureSource.listQueues` exists, the router dispatches `cloud.queues`, the
screen has a panel and `/api/v1/infrastructure/queues` is published. No provider
declares the capability, so the panel renders a stated gap: "no connected cloud source
provides this".

Azure's queues are Service Bus (or Storage queues). floci-az will not provision a
Service Bus namespace through ARM at all — this is not a metrics gap that a mock fixes,
it is a resource that does not exist to read.

## Why it matters

Less than it looks. A stated gap is a correct answer, and the sweep in
`capability-gaps.test.ts` proves the panel degrades rather than the page. The cost is
that one panel of the infrastructure screen has never shown a real number, so the path
from a real queue depth to a rendered row has never run.

## What to do

Three options, in the order worth trying:

1. **Storage queues instead of Service Bus.** Storage accounts _do_ provision through
   floci-az — `readStorage` reads five of them. Queue metrics
   (`QueueMessageCount`, `QueueCount`) come from Monitor against the storage account's
   queue sub-resource, which the Monitor mock could serve with a new entry in
   `METRIC_CENTRES` and nothing else. This is the cheap path and it is real Azure, not a
   stand-in.
2. **Check whether floci-az has gained Service Bus.** It was refused when the Azure
   provider was written; that may have changed. Try provisioning one in
   `scripts/seed-azure.ts` before assuming.
3. **Leave it undeclared.** A gap that says so beats a number nobody measured. This stays
   the right answer until one of the above is done.

Whichever: declare the capability only once it is implemented. The rule is in `CLAUDE.md`
and the sweep enforces it.

## Where

- `src/lib/server/sources/contracts.ts` — `listQueues` on `CloudProvider`
- `src/lib/server/sources/providers/azure/index.ts` — the capability list and the note
  explaining what is missing and why
- `src/lib/server/sources/providers/azure/mock/monitor.ts` — `METRIC_CENTRES`
- `scripts/seed-azure.ts` — where a namespace would be seeded
