import { describe, expect, test } from 'bun:test';
import { buildHealth, describeRuntime, rollUpStatus, type ServiceHealth } from './health';

const service = (name: string, status: ServiceHealth['status']): ServiceHealth => ({
	name,
	status,
	latencyMs: 1
});

describe('rollUpStatus', () => {
	test('is ok when every service is ok', () => {
		expect(rollUpStatus([service('a', 'ok'), service('b', 'ok')])).toBe('ok');
	});

	test('degrades on a single degraded service', () => {
		expect(rollUpStatus([service('a', 'ok'), service('b', 'degraded')])).toBe('degraded');
	});

	test('down beats degraded', () => {
		expect(rollUpStatus([service('a', 'degraded'), service('b', 'down')])).toBe('down');
	});

	test('is ok when there is nothing to report', () => {
		expect(rollUpStatus([])).toBe('ok');
	});
});

describe('describeRuntime', () => {
	test('reports bun, proving the suite runs on the Bun runtime', () => {
		expect(describeRuntime()).toStartWith('bun ');
	});
});

describe('buildHealth', () => {
	test('carries the services through and rolls up their status', () => {
		const services = [service('db', 'ok'), service('cache', 'degraded')];
		const health = buildHealth(services);

		expect(health.status).toBe('degraded');
		expect(health.services).toEqual(services);
	});
});
