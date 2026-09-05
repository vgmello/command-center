import { describe, expect, test } from 'bun:test';
import {
	formatChange,
	formatCompact,
	formatLatency,
	formatPercent,
	formatRelativeTime,
	trendSentiment
} from './format';

describe('formatCompact', () => {
	test('abbreviates thousands and millions', () => {
		expect(formatCompact(18_700)).toBe('18.7k');
		expect(formatCompact(1_240_000)).toBe('1.24M');
	});

	test('leaves small numbers alone and drops trailing zeros', () => {
		expect(formatCompact(412)).toBe('412');
		expect(formatCompact(9.5)).toBe('9.5');
		expect(formatCompact(9)).toBe('9');
	});
});

describe('formatLatency', () => {
	test('stays in milliseconds below a second', () => {
		expect(formatLatency(412)).toEqual({ value: '412', unit: 'ms' });
	});

	test('switches to seconds at a second and above', () => {
		expect(formatLatency(1820)).toEqual({ value: '1.82', unit: 's' });
	});
});

test('formatPercent keeps two decimals', () => {
	expect(formatPercent(1.384)).toBe('1.38%');
	expect(formatPercent(72, 0)).toBe('72%');
});

test('formatChange prefixes an arrow and drops the sign', () => {
	expect(formatChange(8.4, '%', 1)).toBe('↑ 8.4%');
	expect(formatChange(-28, 'ms', 0)).toBe('↓ 28ms');
	expect(formatChange(0, '%')).toBe('→ 0%');
});

describe('trendSentiment', () => {
	test('reads direction against the metric polarity, not the arrow', () => {
		// Error rate rising is bad even though "up" sounds positive.
		expect(trendSentiment('up', 'lower-is-better')).toBe('bad');
		expect(trendSentiment('down', 'lower-is-better')).toBe('good');
		expect(trendSentiment('up', 'higher-is-better')).toBe('good');
	});

	test('flat and neutral never colour', () => {
		expect(trendSentiment('flat', 'lower-is-better')).toBe('neutral');
		expect(trendSentiment('up', 'neutral')).toBe('neutral');
	});
});

describe('formatRelativeTime', () => {
	const now = new Date('2026-09-03T12:00:00.000Z');

	test('scales the unit with the age', () => {
		expect(formatRelativeTime('2026-09-03T11:58:00.000Z', now)).toBe('2m ago');
		expect(formatRelativeTime('2026-09-03T11:00:00.000Z', now)).toBe('1h ago');
		expect(formatRelativeTime('2026-08-31T12:00:00.000Z', now)).toBe('3d ago');
		expect(formatRelativeTime('2026-09-03T11:59:50.000Z', now)).toBe('10s ago');
	});

	test('returns a placeholder rather than NaN for an unparseable value', () => {
		expect(formatRelativeTime('not-a-date', now)).toBe('—');
	});
});
