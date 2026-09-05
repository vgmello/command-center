import { describe, expect, test } from 'bun:test';
import { healthScoreOf, mergeService, rollUpDomain, type ServiceReading } from './catalog-merge';
import type { CatalogDomain, CatalogService } from './catalog';

function service(overrides: Partial<CatalogService> = {}): CatalogService {
	return {
		id: 'payment-api',
		slug: 'payment-api',
		name: 'payment-api',
		description: 'API gateway',
		domainId: 'payments',
		owner: '@payments-team',
		serviceType: 'API Gateway',
		language: '.NET 8',
		runtime: 'Kubernetes',
		icon: 'box',
		accent: 'blue',
		repository: { label: 'Repository', href: 'https://example.com/repo' },
		chatChannel: null,
		runbook: null,
		dashboard: null,
		identity: {},
		...overrides
	};
}

const domain: CatalogDomain = {
	id: 'payments',
	slug: 'payments',
	name: 'Payment Domain',
	shortName: 'Payment',
	icon: 'landmark',
	accent: 'blue',
	criticality: 'mission-critical',
	owner: '@payments-team'
};

function reading(overrides: Partial<ServiceReading> = {}): ServiceReading {
	return {
		service: 'payment-api',
		errorRatePct: 0,
		p95LatencyMs: 150,
		requestsPerSecond: 42,
		instancesHealthy: 3,
		instancesTotal: 3,
		activeAlerts: 0,
		...overrides
	};
}

describe('healthScoreOf', () => {
	test('a clean service scores full marks', () => {
		expect(healthScoreOf(reading())).toBe(100);
	});

	test('errors weigh heaviest, because a failed request is a failed request', () => {
		const errors = healthScoreOf(reading({ errorRatePct: 5 }));
		const slow = healthScoreOf(reading({ p95LatencyMs: 1200 }));

		expect(errors).toBeLessThan(slow);
	});

	test('a dead instance costs points even when everything else is clean', () => {
		expect(healthScoreOf(reading({ instancesHealthy: 2 }))).toBeLessThan(100);
	});

	test('never falls below zero or rises above a hundred', () => {
		expect(healthScoreOf(reading({ errorRatePct: 100, p95LatencyMs: 90_000 }))).toBe(0);
		expect(healthScoreOf(reading({ p95LatencyMs: 0 }))).toBe(100);
	});

	test('latency inside the first 200ms is free', () => {
		// Otherwise every healthy service loses points for being merely fast.
		expect(healthScoreOf(reading({ p95LatencyMs: 199 }))).toBe(100);
	});
});

describe('mergeService', () => {
	test('identity comes from the catalog and readings from the source', () => {
		const merged = mergeService(service(), 'Payment Domain', reading({ activeAlerts: 2 }));

		expect(merged.owner).toBe('@payments-team');
		expect(merged.runtime).toBe('Kubernetes');
		expect(merged.domainName).toBe('Payment Domain');
		expect(merged.activeAlerts).toBe(2);
		expect(merged.instancesTotal).toBe(3);
	});

	test('a service nothing is watching is unknown — not healthy, not down', () => {
		// The three are different statements and an operator acts on them differently.
		const merged = mergeService(service(), 'Payment Domain', undefined);

		expect(merged.status).toBe('unknown');
		expect(merged.instancesTotal).toBe(0);
	});

	test('a failing service is down rather than degraded', () => {
		const merged = mergeService(service(), 'Payment Domain', reading({ errorRatePct: 8 }));
		expect(merged.status).toBe('down');
	});

	test('an absent link stays absent rather than becoming a blank one', () => {
		const merged = mergeService(service(), 'Payment Domain', reading());

		expect(merged.runbook).toBeNull();
		expect(merged.repository?.href).toBe('https://example.com/repo');
	});
});

describe('rollUpDomain', () => {
	const services = [
		service({ slug: 'payment-api' }),
		service({ slug: 'payment-gateway', id: 'payment-gateway' })
	];

	test('the service count is what the catalog declares, not a separate figure', () => {
		// Two fixtures describing one quantity is how a header says 24 over a table of 2.
		const rolled = rollUpDomain(domain, services, new Map());
		expect(rolled.serviceCount).toBe(2);
	});

	test('identity comes from the catalog and is never a reading', () => {
		const rolled = rollUpDomain(domain, services, new Map());

		expect(rolled.accent).toBe('blue');
		expect(rolled.criticality).toBe('mission-critical');
		expect(rolled.shortName).toBe('Payment');
	});

	test('health is the mean of the services that are actually reporting', () => {
		const readings = new Map([
			['payment-api', reading({ service: 'payment-api' })],
			['payment-gateway', reading({ service: 'payment-gateway', errorRatePct: 5 })]
		]);

		const rolled = rollUpDomain(domain, services, readings);

		expect(rolled.healthScore).toBe(80);
		expect(rolled.errorRatePct).toBe(2.5);
	});

	test('a domain nothing is watching is unknown, and sorts last rather than worst', () => {
		const rolled = rollUpDomain(domain, services, new Map());

		expect(rolled.status).toBe('unknown');
		// The zero is not a claim that its health is nought — the status carries that.
		// It exists so the table has something to sort by.
		expect(rolled.healthScore).toBe(0);
	});

	test('a partially watched domain scores on what is known', () => {
		const readings = new Map([['payment-api', reading({ service: 'payment-api' })]]);
		const rolled = rollUpDomain(domain, services, readings);

		expect(rolled.status).toBe('healthy');
		expect(rolled.serviceCount).toBe(2);
	});

	test('open alerts across the domain add up', () => {
		const readings = new Map([
			['payment-api', reading({ service: 'payment-api', activeAlerts: 1 })],
			['payment-gateway', reading({ service: 'payment-gateway', activeAlerts: 2 })]
		]);

		expect(rollUpDomain(domain, services, readings).activeIncidents).toBe(3);
	});

	test('an empty domain is still a domain', () => {
		const rolled = rollUpDomain(domain, [], new Map());

		expect(rolled.serviceCount).toBe(0);
		expect(rolled.status).toBe('unknown');
	});
});
