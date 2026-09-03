import { describe, expect, test } from 'bun:test';
import { buildDistribution, rollUpStatus, statusFromScore, statusSeverity } from './health';
import type { HealthStatus } from './types';

describe('statusFromScore', () => {
	test('maps the documented thresholds', () => {
		expect(statusFromScore(92)).toBe('healthy');
		expect(statusFromScore(75)).toBe('healthy');
		expect(statusFromScore(74)).toBe('degraded');
		expect(statusFromScore(50)).toBe('degraded');
		expect(statusFromScore(49)).toBe('down');
	});

	test('treats a non-finite score as unknown rather than down', () => {
		expect(statusFromScore(Number.NaN)).toBe('unknown');
	});
});

test('statusSeverity ranks outages worst', () => {
	expect(statusSeverity('down')).toBeLessThan(statusSeverity('degraded'));
	expect(statusSeverity('degraded')).toBeLessThan(statusSeverity('healthy'));
});

describe('rollUpStatus', () => {
	test('an aggregate is only as healthy as its weakest part', () => {
		expect(rollUpStatus(['healthy', 'degraded', 'healthy'])).toBe('degraded');
		expect(rollUpStatus(['degraded', 'down'])).toBe('down');
		expect(rollUpStatus(['healthy', 'healthy'])).toBe('healthy');
	});

	test('an empty set is unknown, not healthy', () => {
		expect(rollUpStatus([])).toBe('unknown');
	});
});

describe('buildDistribution', () => {
	const domains = (...statuses: HealthStatus[]) => statuses.map((status) => ({ status }));

	test('counts every status and keeps the slice order stable', () => {
		const result = buildDistribution(domains('healthy', 'healthy', 'degraded', 'down'));

		expect(result.total).toBe(4);
		expect(result.slices.map((slice) => slice.status)).toEqual([
			'healthy',
			'degraded',
			'down',
			'unknown'
		]);
		expect(result.slices.map((slice) => slice.count)).toEqual([2, 1, 1, 0]);
		expect(result.slices[0].percentage).toBe(50);
	});

	test('does not divide by zero on an empty platform', () => {
		const result = buildDistribution([]);
		expect(result.total).toBe(0);
		expect(result.slices.every((slice) => slice.percentage === 0)).toBe(true);
	});
});
