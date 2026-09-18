import { describe, expect, test } from 'bun:test';
import { CAPABILITIES, SOURCE_KINDS, kindOf } from './sources';

describe('the capability vocabulary', () => {
	test('every capability is namespaced by the kind that answers it', () => {
		for (const capability of CAPABILITIES) {
			const kind = kindOf(capability);
			expect((SOURCE_KINDS as readonly string[]).includes(kind)).toBe(true);
		}
	});

	test('kindOf reads the kind out of the name, so the two cannot disagree', () => {
		expect(kindOf('cloud.cost')).toBe('cloud');
		expect(kindOf('apm.slo')).toBe('apm');
		expect(kindOf('deployment.log')).toBe('deployment');
	});

	test('no capability is declared twice', () => {
		expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
	});

	test('every kind has at least one capability', () => {
		for (const kind of SOURCE_KINDS) {
			expect(
				CAPABILITIES.some((one) => kindOf(one) === kind),
				kind
			).toBe(true);
		}
	});
});
