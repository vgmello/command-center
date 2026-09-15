# The domain table's column button does nothing

**Status:** open, and genuinely blocked on something that does not exist yet.

## What is missing

The domains table has a column-settings button. It is inert. The columns a screen shows
are a prop, not a preference, and there is nowhere to persist one — no per-user settings
store, and `WorkspaceSource` currently carries the signed-in user and their pins and
nothing else.

Leaving it inert is a live exception to the "do not ship a dead control" rule that the
deployments screen follows elsewhere: its date filter became a preset select rather than
a calendar, and its Filters button reports and clears rather than opening a panel of
controls already on screen. This button got neither treatment.

## Why it matters

Small, but it is a control that lies. Every other dead control on the platform was either
made real or reshaped into something honest; this one was left, and it is the kind of
thing that reads as broken rather than unbuilt.

It also has a constraint most preferences do not: the table is width-budgeted. Eleven
columns fit a 1680px viewport beside the 368px side column with nothing to spare, which
is why `identity="compact"` exists. A column preference that lets a reader turn on a
twelfth column has to answer what gives — measure in a browser, because table auto-layout
makes cells wider than their `w-[…]` hint whenever content demands it.

## What to do

Either:

**Make it real.** Extend `WorkspaceSource` with column preferences — it is already the
port for per-user state, and pins prove the shape works. Persist per user, per table.
Then the button opens a real popover and the width budget becomes a real constraint to
design against.

**Or reshape it.** Drop the button, or turn it into something that does what it can do
without persistence — toggling the compact identity mode, say, which is per-render state
and belongs in the scope context rather than in a store.

The second is a much smaller change and would close the honesty gap today. The first is
the better product. Pick deliberately rather than leaving it.

## Where

- `src/lib/components/DomainTable.svelte` — the column-settings affordance in the
  header's action cell, the `columns` prop and the `identity` mode
- `src/lib/server/platform/source.ts` — `WorkspaceSource`
- `src/lib/scope.svelte.ts` — where per-render state lives if it does not persist
- `CLAUDE.md`, "Deliberate deviations from the deployments mock" — how the other dead
  controls were resolved
