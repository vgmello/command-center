# Read Monitor in batches, not one resource at a time

**Status:** a stated ceiling, not a bug. Do it when an estate outgrows the current shape.

## What is missing

One infrastructure page against Azure costs **31 requests, 26 of them Monitor**
(measured, not estimated: ARM 4, Cost 1, Monitor 26). Monitor's metrics endpoint answers
about one resource, so every cluster, storage account and database is its own call, and
the estate's utilisation is a call per machine.

`metricSampleSize` caps that last one at twelve machines and the panel says it is a
sample. That is honest and it is a cap, not a fix: a subscription with two thousand VMs
would be two thousand requests without it, and twelve machines is a thin sample of two
thousand.

## Why it matters

Not yet. The seeded estate is 49 VMs across 5 regions and 26 requests is fine against a
local mock. It matters against a real subscription, where Monitor has a request budget
and a dashboard that refreshes is a dashboard that spends it.

## What to do

Azure Monitor has a batch endpoint:

```
POST /subscriptions/{id}/providers/Microsoft.Insights/metrics:getBatch
```

It takes a list of resource ids and returns a series per resource. **It is a different
path, not a parameter on the existing one** — `client.metrics()` cannot grow into it, and
`mock/monitor.ts` does not serve it. So this is three pieces:

1. A `metricsBatch()` on `AzureClient` alongside `metrics()`. Batch has its own
   constraints — all resources must share a subscription and a region, and there is a cap
   per request — so it is a real method, not a loop wearing a new name.
2. The mock learns the route, answering the real contract the way the metrics one does.
   Same seeding (`azure-monitor:${resourceId}:${name}`) so the numbers do not move.
3. The four Monitor-backed capabilities call it, and `metricSampleSize` is raised or
   removed depending on what the caps allow.

## How to know it worked

Count the requests again. The probe is four lines: wrap `globalThis.fetch`, tally by
port, call all seven capabilities. The number is the test — a batch implementation that
did not reduce it did not work.

Then check the readings did not change. Same seed, same estate, same numbers; if a value
moved, the batch path is reading something different from the single path.

## Where

- `src/lib/server/sources/providers/azure/client.ts` — `metrics()`, `isoDuration()`
- `src/lib/server/sources/providers/azure/mock/monitor.ts` — the mock
- `src/lib/server/sources/providers/azure/index.ts` — `metricSampleSize`, the four callers
- `CLAUDE.md`, "What that costs" — the measured figure to update
