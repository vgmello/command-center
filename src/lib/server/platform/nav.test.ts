import { describe, expect, test } from 'bun:test';
import { NAV_ITEMS } from './fixtures';

/**
 * What the sidebar offers, and what it only mentions.
 *
 * The rule the repo already had was "do not ship links to routes that do not exist". This
 * is the other half of it: a route may exist and still have nothing on it, and offering it
 * as a destination spends a reader's click on a placeholder. Logs, Traces and Reports are
 * listed so the product's shape stays honest, and marked so the sidebar can group them
 * apart rather than sell them as finished.
 */

const PLANNED = ['logs', 'traces', 'reports'];

describe('the navigation', () => {
	test('names the sections that are not built', () => {
		const planned = NAV_ITEMS.filter((item) => item.available === false).map((item) => item.id);

		expect(planned.sort()).toEqual([...PLANNED].sort());
	});

	test('every other section is offered without qualification', () => {
		// `available` is absent rather than `true` on a built section, so a new entry does
		// not have to remember to say so — but nothing built may be marked otherwise.
		for (const item of NAV_ITEMS) {
			const expected = PLANNED.includes(item.id) ? false : undefined;
			expect(`${item.id}: ${item.available}`).toBe(`${item.id}: ${expected}`);
		}
	});

	test('the built sections still come first, so the order is not an accident', () => {
		const lastBuilt = NAV_ITEMS.findLastIndex((item) => item.available !== false);
		const firstPlanned = NAV_ITEMS.findIndex((item) => item.available === false);

		expect(lastBuilt).toBeLessThan(firstPlanned);
	});

	test('a planned section still has a real href, because the route exists', () => {
		// Not offered is not the same as not there: the placeholder pages still resolve for
		// anyone holding the URL, and deleting the route would turn a bookmark into a 404.
		for (const item of NAV_ITEMS.filter((one) => one.available === false)) {
			expect(item.href.startsWith('/')).toBe(true);
		}
	});
});
