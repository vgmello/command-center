import { describe, expect, test } from 'bun:test';
import {
	ASSIGNMENTS,
	FIXTURE_STORAGE_BYTES,
	boundDomains,
	fixtureOwnerOf,
	ownsResource,
	seedOwnerOf
} from './ownership';

describe('ownsResource', () => {
	test("key is case-insensitive, value is case-sensitive — ARM's own rule", () => {
		expect(ownsResource({ Domain: 'payment-domain' }, 'domain', 'payment-domain')).toBe(true);
		expect(ownsResource({ domain: 'Payment-Domain' }, 'domain', 'payment-domain')).toBe(false);
	});
	test('a missing tag never matches', () => {
		expect(ownsResource(undefined, 'domain', 'payment-domain')).toBe(false);
		expect(ownsResource({}, 'domain', 'payment-domain')).toBe(false);
	});
});

describe('two worlds, one assignment', () => {
	test('fixture and seed names resolve to the same domain for the same role', () => {
		expect(fixtureOwnerOf('eu-west-1')).toBe(ASSIGNMENTS['region-1']);
		expect(seedOwnerOf('cc-westeurope')).toBe(ASSIGNMENTS['region-1']);
		expect(fixtureOwnerOf('payment-db')).toBe('payment-domain');
		expect(seedOwnerOf('cc-payments')).toBe('payment-domain');
	});
	test('clusters inherit their region', () => {
		expect(fixtureOwnerOf('prod-eu-west-1-a')).toBe(fixtureOwnerOf('eu-west-1'));
		expect(fixtureOwnerOf('prod-eu-west-1-b')).toBe(fixtureOwnerOf('eu-west-1'));
		expect(seedOwnerOf('cc-westeurope-aks')).toBe(seedOwnerOf('cc-westeurope'));
	});
	test('fixtures bind six domains, the seed five', () => {
		expect(boundDomains('fixture').sort()).toEqual([
			'analytics-domain',
			'inventory-domain',
			'notification-domain',
			'order-domain',
			'payment-domain',
			'user-domain'
		]);
		expect(boundDomains('seed')).toHaveLength(5);
		expect(boundDomains('seed')).not.toContain('analytics-domain');
	});
	test('tax-domain is bound in neither world', () => {
		expect(boundDomains('fixture')).not.toContain('tax-domain');
		expect(boundDomains('seed')).not.toContain('tax-domain');
	});
	test('an unknown name belongs to nobody', () => {
		expect(fixtureOwnerOf('nope')).toBeNull();
		expect(seedOwnerOf('nope')).toBeNull();
	});
	test("per-domain storage sums to the estate's three classes", () => {
		// infrastructure-fixtures.ts readStorage(): block 5.1 TiB, object 4.8 TiB, file 2.5 TiB.
		const TIB = 1024 ** 4;
		const sum = (cls: 'block' | 'object' | 'file') =>
			Object.values(FIXTURE_STORAGE_BYTES).reduce((t, d) => t + d[cls], 0);
		expect(sum('block')).toBeCloseTo(5.1 * TIB, -6);
		expect(sum('object')).toBeCloseTo(4.8 * TIB, -6);
		expect(sum('file')).toBeCloseTo(2.5 * TIB, -6);
	});
});
