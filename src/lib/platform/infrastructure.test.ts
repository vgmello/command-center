import { describe, expect, test } from 'bun:test';
import { accentFor, toCostView, toStorageView, toUsageView } from './infrastructure';
import type { CostBreakdown, ResourceReading, StorageClass } from './types';

/**
 * Presentation derived from facts, above the port.
 *
 * These functions exist because `CloudProvider` used to demand the opposite: a provider
 * returned `formatted` strings and a `DomainAccent`, so writing a real adapter meant
 * deciding that Blob Storage is tinted violet. That is not a fact about Azure.
 *
 * It was also losing data. The old `StorageClass` kept a rounded percentage and a string
 * instead of the byte count, so the public API had to recover bytes by multiplying the
 * share back out — publishing an approximation of a figure it had been handed exactly.
 */

describe('storage presentation', () => {
	const storage = {
		totalBytes: 1000,
		classes: [
			{ id: 'hot', label: 'Hot', bytes: 750 },
			{ id: 'cool', label: 'Cool', bytes: 250 }
		] satisfies StorageClass[]
	};

	test('shares are computed from the bytes, not the other way round', () => {
		const view = toStorageView(storage);

		expect(view.classes.map((one) => one.percentage)).toEqual([75, 25]);
		expect(view.classes.map((one) => one.bytes)).toEqual([750, 250]);
	});

	test('shares are rounded, because they are printed as well as measured', () => {
		// Unrounded they reach the page as "41.12903225806452%". The bytes stay exact,
		// which is what lets the share be rounded without losing anything.
		const view = toStorageView({
			totalBytes: 12.4,
			classes: [{ id: 'block', label: 'Block', bytes: 5.1 }]
		});

		expect(view.classes[0].percentage).toBe(41);
	});

	test('a total of zero divides into zero shares rather than NaN', () => {
		const view = toStorageView({ totalBytes: 0, classes: [{ id: 'a', label: 'A', bytes: 0 }] });

		expect(view.classes[0].percentage).toBe(0);
	});

	test('every class gets a stable accent, so two renders agree', () => {
		expect(accentFor('hot')).toBe(accentFor('hot'));
	});

	test('accents are assigned by id, so adding a class does not recolour the others', () => {
		// Positional assignment would shift every tint when a class is inserted, which
		// reads as though the estate changed.
		const before = toStorageView(storage).classes.map((one) => one.accent);
		const after = toStorageView({
			totalBytes: 1100,
			classes: [{ id: 'archive', label: 'Archive', bytes: 100 }, ...storage.classes]
		}).classes;

		expect(after.find((one) => one.id === 'hot')?.accent).toBe(before[0]);
	});
});

describe('utilization presentation', () => {
	const reading: ResourceReading = {
		id: 'network',
		label: 'Network I/O',
		value: 1.2e9,
		unit: 'bps',
		series: { id: 'network', label: 'Network I/O', points: [], min: 0, max: 0 },
		axisMax: 2e9,
		change: -8,
		direction: 'down',
		polarity: 'lower-is-better'
	};

	test('a bitrate headline is formatted in its own unit, not in bits', () => {
		const view = toUsageView(reading);

		expect(view.formatted).toBe('1.2');
		expect(view.displayUnit).toBe('Gbps');
	});

	test('the stated unit survives, because the DTO publishes the base unit', () => {
		// Pairing the display unit with the series would label 1,200,000,000 as gigabits.
		expect(toUsageView(reading).unit).toBe('bps');
	});

	test('a percentage reads as a whole number', () => {
		const view = toUsageView({ ...reading, id: 'cpu', unit: '%', value: 67.4 });

		expect(view.formatted).toBe('67');
		expect(view.displayUnit).toBe('%');
	});
});

describe('cost presentation', () => {
	const cost: CostBreakdown = {
		labels: ['1', '2'],
		categories: [
			{ id: 'compute', label: 'Compute', amount: 750, daily: [300, 450] },
			{ id: 'storage', label: 'Storage', amount: 250, daily: [100, 150] }
		],
		total: 1000,
		changePct: 4,
		forecast: 1200,
		forecastChangePct: 6
	};

	test('shares come from the amounts, and the amounts are untouched', () => {
		const view = toCostView(cost);

		expect(view.categories.map((one) => one.percentage)).toEqual([75, 25]);
		expect(view.categories.map((one) => one.amount)).toEqual([750, 250]);
	});

	test('spend keeps one decimal place, as it did before the share moved up here', () => {
		const view = toCostView({
			...cost,
			total: 5726,
			categories: [{ id: 'compute', label: 'Compute', amount: 2527, daily: [] }]
		});

		expect(view.categories[0].percentage).toBe(44.1);
	});

	test('the totals are formatted once, here, rather than by every source', () => {
		const view = toCostView(cost);

		expect(view.totalFormatted).toBe('$1,000');
		expect(view.forecastFormatted).toBe('$1,200');
	});
});
