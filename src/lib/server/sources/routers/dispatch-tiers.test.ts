import { describe, expect, test } from 'bun:test';
import { CAPABILITIES, type Capability } from '$lib/platform/sources';
import { CAPABILITY_TIER } from '../tiers';

/**
 * Every capability is read the way its tier promises.
 *
 * The defect this exists to prevent was silent and expensive.
 * `deployment.trends`, `deployment.statusTrend` and `apm.latencyHeatmap` were declared
 * `series` while `fanOutSeries` was called for none of them, so they fell through both
 * storage strategies: not documents, so the cache never persisted them, and not
 * accumulated, so they never reached `source_series`. Every read fetched a whole
 * four-hundred-row window, forever, and nothing anywhere reported a problem.
 *
 * `tiers.test.ts` closed one direction of that — the `series` tier now holds exactly what
 * is accumulated. This closes the other: it reads the routers and checks that the helper
 * each capability is actually dispatched with matches the tier it is classified as. A
 * capability nothing reads at all is caught here too, since a declared capability no
 * screen can reach is a promise to a provider author that nothing keeps.
 *
 * Source-reading rather than runtime: the routers are four small files whose whole job is
 * this mapping, and invoking every capability to observe its path would need a provider
 * for each. The regex is deliberately narrow — it matches the call form the routers
 * actually use, and a call it cannot see shows up as a missing capability rather than as
 * a silent pass.
 */

const ROUTERS = ['deployment', 'service', 'platform', 'infrastructure'] as const;

type Helper = 'fanOut' | 'fanOutSingle' | 'fanOutSeries' | 'routeOne';

/** The estate fan-out an owner-scoped call takes when no owner is given. */
type ScopedMode = 'list' | 'single';

/** Which helpers a tier may legitimately be read through. */
const ALLOWED: Record<(typeof CAPABILITY_TIER)[Capability], Helper[]> = {
	// Both go through the cache, which persists a `reference` answer as a document.
	// `routeOne` also goes through the cache, on the resource-scoped path.
	live: ['fanOut', 'fanOutSingle', 'routeOne'],
	reference: ['fanOut', 'fanOutSingle', 'routeOne'],
	// Only the series path reaches `source_series`. Anything else and the capability is
	// classified into a strategy nothing implements for it.
	series: ['fanOutSeries']
};

/**
 * Every `(capability, helper)` pair the routers contain, plus the owner-scoped calls on
 * their own so a test can prove each one was parsed.
 *
 * The capability may sit on the same line as the call or on its own, because the generic
 * form (`fanOut<ServiceReading>(`) wraps — so the pattern spans a little whitespace rather
 * than assuming one line.
 */
async function readDispatches(): Promise<{
	dispatches: Map<Capability, Set<Helper>>;
	scopedCalls: number;
	scopedModes: Map<Capability, ScopedMode>;
}> {
	const found = new Map<Capability, Set<Helper>>();
	const scopedModes = new Map<Capability, ScopedMode>();
	let scopedCalls = 0;
	const pattern = /\b(fanOutSeries|fanOutSingle|fanOut)\b\s*(?:<[^>]*>)?\s*\(\s*deps,\s*'([^']+)'/g;
	// The owner-scoped path never spells a helper per capability. It goes through
	// `scoped(deps, catalog, 'cap', 'list' | 'single', …)`, which calls `routeOne` for an
	// owner and `fanOut` or `fanOutSingle` for the estate, by the mode argument — so this
	// pattern captures the mode too and records both helpers the first one cannot see.
	// The mode sits right after the capability so the regex stays this simple; a `scoped(`
	// call that does not match here is counted below and fails the parsed-mode test.
	const scopedPattern = /\bscoped\s*\(\s*deps,\s*catalog,\s*'([^']+)',\s*'(list|single)'/g;
	const scopedCallPattern = /\bscoped\s*\(\s*deps,\s*catalog,/g;

	for (const router of ROUTERS) {
		const source = await Bun.file(new URL(`./${router}.ts`, import.meta.url).pathname).text();

		for (const match of source.matchAll(pattern)) {
			const helper = match[1] as Helper;
			const capability = match[2] as Capability;

			found.set(capability, (found.get(capability) ?? new Set()).add(helper));
		}

		scopedCalls += [...source.matchAll(scopedCallPattern)].length;

		for (const match of source.matchAll(scopedPattern)) {
			const capability = match[1] as Capability;
			const mode = match[2] as ScopedMode;

			scopedModes.set(capability, mode);
			found.set(
				capability,
				(found.get(capability) ?? new Set())
					.add('routeOne')
					.add(mode === 'single' ? 'fanOutSingle' : 'fanOut')
			);
		}
	}

	return { dispatches: found, scopedCalls, scopedModes };
}

const { dispatches, scopedCalls, scopedModes } = await readDispatches();

describe('how each capability is actually read', () => {
	test('the routers were parsed, so an empty result cannot pass as agreement', () => {
		// Without this, a regex that stopped matching would make every assertion below
		// vacuously true — which is exactly how the original defect stayed invisible.
		expect(dispatches.size).toBeGreaterThanOrEqual(CAPABILITIES.length);
	});

	for (const capability of CAPABILITIES) {
		test(`${capability} is dispatched as a ${CAPABILITY_TIER[capability]} capability`, () => {
			const helpers = dispatches.get(capability);

			// A declared capability nothing reads is a promise to a provider author that
			// nothing keeps: they implement it and no screen ever asks.
			expect(helpers, `${capability} is declared but no router reads it`).toBeDefined();

			const allowed = ALLOWED[CAPABILITY_TIER[capability]];
			for (const helper of helpers!) {
				expect(
					`${capability} via ${helper}`,
					`${capability} is tier "${CAPABILITY_TIER[capability]}" but read with ${helper}`
				).toBe(`${capability} via ${allowed.find((one) => one === helper) ?? allowed[0]}`);
			}
		});
	}

	test('every owner-scoped call names its estate fan-out, and the mode was parsed', () => {
		// `scoped()` picks `fanOut` or `fanOutSingle` from its mode argument rather than
		// spelling the helper per capability, so the helper only reaches the tier check
		// above if the pattern read the mode. A `scoped(` call whose mode is not where the
		// pattern looks would silently record `routeOne` alone — green, and blind.
		expect(scopedCalls).toBeGreaterThan(0);
		expect(scopedModes.size, 'a scoped() call was found whose mode was not parsed').toBe(
			scopedCalls
		);

		for (const [capability, mode] of scopedModes) {
			const fanOuts = [...dispatches.get(capability)!].filter(
				(one) => one === 'fanOut' || one === 'fanOutSingle'
			);

			expect(`${capability}: ${fanOuts.join(',')}`).toBe(
				`${capability}: ${mode === 'single' ? 'fanOutSingle' : 'fanOut'}`
			);
		}
	});

	test('nothing is read through two different strategies', () => {
		// A capability read one way on one screen and another way elsewhere would be
		// cached under one strategy and accumulated under another, and the two would
		// disagree about what is stored.
		for (const [capability, helpers] of dispatches) {
			const strategies = new Set(
				[...helpers].map((one) => (one === 'fanOutSeries' ? 'series' : 'cached'))
			);

			expect(`${capability}: ${strategies.size}`).toBe(`${capability}: 1`);
		}
	});
});
