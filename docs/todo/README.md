# Todo

One file per piece of open work. Each states what is missing, why it matters, what
"done" looks like, and where the code is — enough that somebody who did not write it
can pick it up.

This is not a backlog of ideas. Everything here is a gap in something that already
exists: a path the tests do not run, a capability a screen asks for and nothing
answers, a control that is on screen and does nothing. Ideas belong in a spec under
`docs/superpowers/specs/`.

| File                                                                                 | What                                                                       | Blocked on                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------- |
| [azure-e2e-in-ci.md](azure-e2e-in-ci.md)                                             | The only real-cloud e2e mode never runs in CI                              | nothing                               |
| [monitor-batch-endpoint.md](monitor-batch-endpoint.md)                               | 26 Monitor requests per infrastructure page                                | nothing                               |
| [azure-owner-server-side-narrowing.md](azure-owner-server-side-narrowing.md)         | Domain ownership is filtered client-side, after the estate list is capped  | floci-az has no `/resources` list     |
| [cloud-queues.md](cloud-queues.md)                                                   | `cloud.queues` undeclared — the queue panel is always a gap                | floci-az cannot provision Service Bus |
| [cloud-alerts.md](cloud-alerts.md)                                                   | `cloud.alerts` undeclared — the alert panel is always a gap                | a second Monitor API                  |
| [unbuilt-screen-sections.md](unbuilt-screen-sections.md)                             | 16 of 25 sub-tabs say "not built yet"                                      | product decisions                     |
| [detail-routes.md](detail-routes.md)                                                 | Incidents and deployments have no page of their own                        | nothing                               |
| [column-preferences.md](column-preferences.md)                                       | The domain table's column button is inert                                  | nowhere to persist a preference       |
| [warm-store-grain-switch-double-counts.md](warm-store-grain-switch-double-counts.md) | Reading a second grain against a warm store double-counts deployment runs  | a design decision                     |
| [sweep-hides-failures.md](sweep-hides-failures.md)                                   | The capability sweep's loop hides every failure after the first            | nothing                               |
| [fixture-catalog-vs-deployment-log.md](fixture-catalog-vs-deployment-log.md)         | The fixture catalog and deployment log disagree on which services exist    | nothing (sizeable)                    |
| [estate-trends-mixed-registry.md](estate-trends-mixed-registry.md)                   | A trends-only connection's runs vanish from the estate in a mixed registry | nothing                               |
| [api-501-undocumented.md](api-501-undocumented.md)                                   | A gap-capable route's 501/502 is real but undocumented in the OpenAPI doc  | nothing                               |
