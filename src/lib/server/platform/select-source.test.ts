import { describe, expect, test } from 'bun:test';
import { selectSource } from './select-source';

describe('selectSource', () => {
	const registry = { fixture: () => 'fixture-instance', http: () => 'http-instance' };

	test('falls back to fixtures when nothing is configured', () => {
		expect(selectSource('PLATFORM_SOURCE', undefined, registry)).toBe('fixture-instance');
		expect(selectSource('PLATFORM_SOURCE', '  ', registry)).toBe('fixture-instance');
	});

	test('returns the configured implementation', () => {
		expect(selectSource('PLATFORM_SOURCE', 'http', registry)).toBe('http-instance');
	});

	test('throws on an unknown name rather than quietly serving fixtures', () => {
		// A typo that silently falls back would make production show invented numbers
		// with nothing on the page admitting it.
		expect(() => selectSource('PLATFORM_SOURCE', 'htpp', registry)).toThrow(
			'PLATFORM_SOURCE="htpp" is not a known source. Available: fixture, http'
		);
	});
});
