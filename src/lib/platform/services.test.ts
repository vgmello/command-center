import { describe, expect, test } from 'bun:test';
import {
	SERVICE_TABS,
	SERVICE_TAB_LABELS,
	describeInstanceHealth,
	formatInstances,
	isServiceTab,
	serviceTabHref
} from './services';

describe('the service tab vocabulary', () => {
	test('every tab has a label, so the strip cannot render a blank', () => {
		for (const tab of SERVICE_TABS) {
			expect(SERVICE_TAB_LABELS[tab].length).toBeGreaterThan(0);
		}
	});

	test('recognises its own tabs and nothing else', () => {
		for (const tab of SERVICE_TABS) expect(isServiceTab(tab)).toBe(true);
		for (const other of ['', 'Overview', 'settings', '../admin', 'metrics/']) {
			expect(isServiceTab(other)).toBe(false);
		}
	});

	test('overview lives at the bare service path, so a service has one canonical URL', () => {
		expect(serviceTabHref('payment-api', 'overview')).toBe('/services/payment-api');
	});

	test('every other tab is a segment under it', () => {
		for (const tab of SERVICE_TABS.filter((one) => one !== 'overview')) {
			expect(serviceTabHref('payment-api', tab)).toBe(`/services/payment-api/${tab}`);
		}
	});

	test('no two tabs share an href', () => {
		const hrefs = SERVICE_TABS.map((tab) => serviceTabHref('x', tab));

		expect(new Set(hrefs).size).toBe(hrefs.length);
	});
});

describe('instance counts', () => {
	test('reads as a share only when every instance agrees', () => {
		expect(describeInstanceHealth(3, 3)).toBe('100% healthy');
	});

	test('names the counts when they do not, because a percentage hides which one', () => {
		expect(describeInstanceHealth(2, 3)).toBe('2 of 3 healthy');
		expect(describeInstanceHealth(0, 3)).toBe('0 of 3 healthy');
	});

	test('a service with no instances says so rather than dividing by zero', () => {
		expect(describeInstanceHealth(0, 0)).toBe('No instances');
	});

	test('the ratio is a slash, not a fraction', () => {
		expect(formatInstances(3, 3)).toBe('3 / 3');
	});
});
