# The capability sweep's loop hides every failure after the first

**Status:** open. Safe to defer, but worth fixing before the sweep grows its next entry.

## What is missing

`capability-gaps.test.ts`'s per-screen loop is:

```ts
for (const screen of SCREENS) {
	const result = await outcome(screen, dropped);
	expect(`${screen.name}: ${result}`).toBe(`${screen.name}: rendered`);
}
```

`expect` throws on the first mismatch, which unwinds out of the loop — so a run that
breaks several screens at once only ever reports the first one. Task 8b found this the
hard way: correcting the sweep's vacuous slugs (see `CLAUDE.md`'s capability-sweep
paragraph) predicted five failures and produced twelve, five and then four and then three
at a time, each round hiding the next behind the one just fixed. The true count was only
ever visible by fixing and re-running.

## Why it matters

The sweep is this project's central guard — CLAUDE.md credits it with finding seventeen
gaps and "making the eighteenth a red test instead of a blank page." A guard that
under-reports when several screens break at once is a guard that gives a wrong sense of
how much is broken on exactly the runs where that matters most: a capability removed from
a shared dependency, or a `SCREENS` entry added with a bad slug (see the "vacuous entries"
correction in `CLAUDE.md`), both break more than one screen at a time.

Currently low-risk in practice: the sweep is green, so the next single new failure
surfaces cleanly. It only hides when several fail together — which is exactly the
condition under which this file was written.

## What to do

Collect outcomes across the whole `SCREENS` array before asserting, so one run reports
everything broken instead of just the first:

```ts
const results = await Promise.all(SCREENS.map((screen) => outcome(screen, dropped)));
expect(results.map((r, i) => `${SCREENS[i].name}: ${r}`)).toEqual(
	SCREENS.map((s) => `${s.name}: rendered`)
);
```

Same shape as the existing per-test assertions, so the failure message stays readable —
just collected once instead of thrown on the first mismatch. Apply to both `describe`
blocks (`one capability missing`, `a whole kind missing`).

## Where

- `src/lib/server/platform/capability-gaps.test.ts` — both `for (screen of SCREENS)
expect(...)` loops
