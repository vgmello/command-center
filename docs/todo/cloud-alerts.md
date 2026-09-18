# `cloud.alerts` — nothing answers it

**Status:** open. Not blocked, just a second API nobody has written yet.

## What is missing

Same shape as the queue gap: `listAlerts` is on the port, the router dispatches
`cloud.alerts`, the screen has a panel and `/api/v1/infrastructure/alerts` is published.
No provider declares it, so the panel states the gap.

The reason it was not picked up with the other four is that alerts are **not a metric**.
Monitor's metrics API answers "what was this resource's CPU"; alerts live in
`Microsoft.AlertsManagement/alerts` and `Microsoft.Insights/metricAlerts` — different
paths, different shapes, and a different question ("what fired"). Adding a metric name to
the existing call does not reach them.

## Why it matters

More than the queue gap. The sidebar carries an Alerts destination with a badge, the
infrastructure screen has an alert panel, and both are currently fed by fixtures or by
nothing. Alerts are also the one part of this estate where a wrong answer is worse than
no answer — a panel reading "no alerts" when nothing is watching is the exact failure
that the `null`-not-zero rule exists to prevent, so if this is built, the gap handling
has to stay honest.

## What to do

1. Decide which API. `Microsoft.AlertsManagement/alerts` lists _fired_ alerts, which is
   what the panel is about. `metricAlerts` lists rules, which is a different screen.
2. Mock it. floci-az does not serve either, so this needs a stand-in beside
   `mock/monitor.ts` — and, as with Monitor, one that answers the real contract rather
   than a convenient one. A separate file: it is a separate service, and the metrics mock
   should not grow a second personality.
3. Map its severity and state onto `InfraAlert`. Check what the type actually requires
   before writing the mock, so the mock is not shaped by what was easy.
4. Implement `listAlerts`, declare the capability, seed some alerts in
   `scripts/seed-azure.ts` if the mock needs a subject to talk about.

## How to know it worked

The infrastructure page stops rendering a gap for alerts and starts rendering rows — and
the `capability-gaps.test.ts` sweep still passes, which is what proves the panel would
degrade rather than take the page down if the source went away.

## Where

- `src/lib/server/sources/contracts.ts` — `listAlerts`
- `src/lib/platform/types.ts` — `InfraAlert`
- `src/lib/server/sources/providers/azure/mock/` — where a second mock would live
- `src/lib/server/sources/providers/azure/index.ts` — the capability list
