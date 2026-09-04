import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_METRICS,
	RANGE_SECONDS,
	escapeLabel,
	p95Latency,
	requestRate,
	selector,
	stepFor
} from './promql';

describe('escapeLabel', () => {
	test('escapes a quote, so a slug cannot close the matcher', () => {
		// A service slug arrives from a URL anyone can edit. Unescaped, everything after
		// the quote would be read as PromQL against an API that runs what it is given.
		expect(escapeLabel('pay"ment')).toBe('pay\\"ment');
	});

	test('escapes a backslash before it can escape our quote', () => {
		expect(escapeLabel('pay\\ment')).toBe('pay\\\\ment');
	});

	test('escapes a newline, which would otherwise end the expression', () => {
		expect(escapeLabel('pay\nment')).toBe('pay\\nment');
	});

	test('leaves an ordinary slug alone', () => {
		expect(escapeLabel('payment-api')).toBe('payment-api');
	});
});

describe('selector', () => {
	test('builds a quoted matcher', () => {
		expect(selector({ service: 'payment-api', environment: 'production' })).toBe(
			'{service="payment-api",environment="production"}'
		);
	});

	test('drops labels with no value rather than matching on empty string', () => {
		// `{service=""}` matches series that have no such label at all, which is a
		// different and much larger set than "any service".
		expect(selector({ service: 'a', environment: undefined, region: '' })).toBe('{service="a"}');
	});

	test('a hostile slug cannot escape the matcher', () => {
		const built = selector({ service: 'a"} or up{' });

		expect(built).toBe('{service="a\\"} or up{"}');
		// One opening brace and one closing brace: the injection did not add a matcher.
		expect(built.match(/\{/g)?.length).toBe(2);
	});
});

describe('stepFor', () => {
	test('keeps a long range to a readable number of points', () => {
		const step = stepFor('7d', 24);
		expect(RANGE_SECONDS['7d'] / step).toBeCloseTo(24, 0);
	});

	test('never goes below a scrape interval, however short the range', () => {
		// A step under the scrape interval yields empty buckets between real samples.
		expect(stepFor('15m', 1000)).toBeGreaterThanOrEqual(15);
	});

	test('a longer range gets a coarser step', () => {
		expect(stepFor('7d')).toBeGreaterThan(stepFor('15m'));
	});
});

describe('the expressions', () => {
	const labels = { service: 'payment-api', environment: 'production' };

	test('the rate window tracks the range rather than being fixed', () => {
		expect(requestRate(DEFAULT_METRICS, labels, '15m')).toContain('[1m]');
		expect(requestRate(DEFAULT_METRICS, labels, '7d')).toContain('[1h]');
	});

	test('p95 comes from the histogram and is converted to milliseconds', () => {
		const query = p95Latency(DEFAULT_METRICS, labels, '1h');

		expect(query).toContain('histogram_quantile(0.95');
		expect(query).toContain('sum by (le)');
		// OTel records seconds; every latency this app prints is in milliseconds.
		expect(query).toContain('* 1000');
	});

	test('every expression carries the scope, so one environment cannot answer for another', () => {
		for (const query of [
			requestRate(DEFAULT_METRICS, labels, '1h'),
			p95Latency(DEFAULT_METRICS, labels, '1h')
		]) {
			expect(query).toContain('environment="production"');
			expect(query).toContain('service="payment-api"');
		}
	});
});
