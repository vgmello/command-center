# Run the Azure e2e stack in CI

**Status:** ready to do. Nothing blocks it but the workflow.

## What is missing

`e2e` runs three stacks — fixtures, `sources.example.json`, and `sources.local.json`.
CI runs the first two. The third skips, because it needs floci-az on 4577 and a seeded
subscription, and the workflow starts neither.

It skips honestly: `azureStackRunning()` probes 4577, 4593 and 4594 and prints
`[e2e] floci-az or the Azure mocks not listening … Azure tests skipped.` So nobody is
misled. But `sources.local.json` is the **only** mode where the infrastructure page is
drawn from a cloud API rather than from seeds, and the only one where a panel
legitimately has nothing to draw — so the coverage that exists for it exists on one
laptop.

## Why it matters

The Monitor work found three bugs that no fixture could have produced: a stub credential
issuing a token both mocks rejected, a cluster judged on its control plane rather than
its pools, and a byte reading that would have printed `5482128896 B`. Each one needed a
real adapter against a real API shape. That class of bug is exactly what this mode
catches, and right now it catches it only when somebody remembers to run it locally.

## What to do

In `.github/workflows/ci.yml`, before the `bun run test:e2e` step:

1. Bring up floci-az. `docker-compose.yml` already defines it; the runner has Docker, so
   this is a `docker compose up -d floci-az` plus a readiness probe in the same Bun-`fetch`
   shape the mock probe uses (`bun -e 'await fetch("http://localhost:4577/health")'`), not
   curl — the reason is in the Testing section of `CLAUDE.md`.
2. Seed it: `bun run seed:azure`. floci-az starts empty, and an unseeded emulator makes
   every Azure test assert against an estate of nothing — which passes, and proves
   nothing.
3. Nothing else. `scripts/mocks.ts` already starts the Cost and Monitor mocks, and
   `sources.local.json` already names all three base URLs.

## How to know it worked

The run should show the three Azure tests executing rather than the skip warning:
`/infrastructure` and `/infrastructure/compute` rendering cleanly, and "the readings are
scaled, and the two gaps say so".

Verify the guard actually bites before trusting a green run — break one assertion, push,
watch it fail. A suite that silently skips looks identical to a suite that passes, which
is the failure mode this whole mode exists to avoid.

## Where

- `.github/workflows/ci.yml` — the job
- `e2e/harness.ts` — `azureStackRunning()`, `envFor()`, the `azure` stack mode
- `e2e/render.test.ts` — the suite itself
- `scripts/ci-local.sh` — worth the same treatment, but its 4GiB Colima VM may not hold
  floci-az beside a Chromium; measure before assuming
