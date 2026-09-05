import { describe, expect, test } from 'bun:test';
import {
	HEALTH_CHANGE_LABELS,
	HEALTH_THRESHOLDS,
	buildDistribution,
	describeHealthThresholds,
	healthChangeDirection,
	rollUpStatus,
	statusFromScore,
	statusSeverity
} from './health';
import type { DomainStatusCounts } from './types';

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
	const counts = (
		healthy: number,
		degraded: number,
		down: number,
		unknown = 0
	): DomainStatusCounts => ({ healthy, degraded, down, unknown });

	test('keeps the slice order stable and totals the counts', () => {
		const result = buildDistribution(counts(2, 1, 1));

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
		const result = buildDistribution(counts(0, 0, 0));
		expect(result.total).toBe(0);
		expect(result.slices.every((slice) => slice.percentage === 0)).toBe(true);
	});
});

describe('describeHealthThresholds', () => {
	test('states the same bands statusFromScore applies', () => {
		const sentence = describeHealthThresholds();

		expect(sentence).toContain(String(HEALTH_THRESHOLDS.healthy));
		expect(sentence).toContain(String(HEALTH_THRESHOLDS.degraded));
		expect(statusFromScore(HEALTH_THRESHOLDS.healthy)).toBe('healthy');
		expect(statusFromScore(HEALTH_THRESHOLDS.healthy - 1)).toBe('degraded');
		expect(statusFromScore(HEALTH_THRESHOLDS.degraded - 1)).toBe('down');
	});
});

describe('health-score changes', () => {
	test('direction comes from the two scores, so no caller invents its own', () => {
		expect(healthChangeDirection(58, 72)).toBe('up');
		expect(healthChangeDirection(72, 58)).toBe('down');
		expect(healthChangeDirection(72, 72)).toBe('flat');
	});

	test('every direction has copy, so the feed cannot render a blank line', () => {
		for (const direction of ['up', 'down', 'flat'] as const) {
			expect(HEALTH_CHANGE_LABELS[direction].length).toBeGreaterThan(0);
		}
	});

	test('improving and degrading do not read the same', () => {
		expect(HEALTH_CHANGE_LABELS.up).not.toBe(HEALTH_CHANGE_LABELS.down);
	});
});
