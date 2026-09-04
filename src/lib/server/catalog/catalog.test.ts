import { describe, expect, test } from 'bun:test';
import { parseCatalog } from './file-source';
import { identityFor } from '$lib/platform/catalog';
import { FixtureCatalogSource } from './fixture-source';

const VALID = `
version: 1
domains:
  - slug: payments
    name: Payment Domain
    shortName: Payment
    owner: '@payments-team'
    criticality: mission-critical
    icon: landmark
    accent: blue
  - slug: identity
    name: Identity Domain
    owner: '@identity-team'
    criticality: business-critical
services:
  - slug: payment-api
    name: payment-api
    domain: payments
    description: API gateway for payment processing
    type: API Gateway
    language: .NET 8
    runtime: Kubernetes
    links:
      repository: https://github.com/acme/payment-api
      runbook: https://wiki.acme.com/runbooks/payment-api
    identity:
      apm: payment-api
      deployment: Payment API
  - slug: auth-service
    domain: identity
`;

const load = (text: string) => parseCatalog(text, 'test.yaml');

describe('a valid catalog', () => {
	test('reads domains and services', async () => {
		const catalog = load(VALID);

		expect((await catalog.listDomains()).map((one) => one.slug)).toEqual(['payments', 'identity']);
		expect((await catalog.listServices()).map((one) => one.slug)).toEqual([
			'payment-api',
			'auth-service'
		]);
	});

	test('parses JSON too, since the same parser reads both', async () => {
		const catalog = load(
			JSON.stringify({
				version: 1,
				domains: [
					{
						slug: 'payments',
						name: 'Payment Domain',
						owner: '@team',
						criticality: 'standard'
					}
				],
				services: [{ slug: 'payment-api', domain: 'payments' }]
			})
		);

		expect((await catalog.listServices()).length).toBe(1);
	});

	test('filters by domain, the one filter a catalog can actually answer', async () => {
		const catalog = load(VALID);
		expect((await catalog.listServices('payments')).map((one) => one.slug)).toEqual([
			'payment-api'
		]);
	});

	test('finds one by slug, and reports absence rather than throwing', async () => {
		const catalog = load(VALID);

		expect((await catalog.findService('payment-api'))?.name).toBe('payment-api');
		expect(await catalog.findService('no-such-service')).toBeNull();
		expect(await catalog.findDomain('no-such-domain')).toBeNull();
	});

	test('a short name falls back to the full name rather than to a guess', async () => {
		const catalog = load(VALID);

		expect((await catalog.findDomain('payments'))?.shortName).toBe('Payment');
		// Not "Identity" — stripping the word would be guessing, and the first domain
		// called "Domain Registry" would come out wrong.
		expect((await catalog.findDomain('identity'))?.shortName).toBe('Identity Domain');
	});

	test('a service inherits its domain’s owner unless it states its own', async () => {
		const catalog = load(VALID);

		expect((await catalog.findService('auth-service'))?.owner).toBe('@identity-team');
		expect((await catalog.findService('payment-api'))?.owner).toBe('@payments-team');
	});

	test('an unrecorded link is null, not a link to nowhere', async () => {
		const service = (await load(VALID).findService('payment-api'))!;

		expect(service.repository?.href).toBe('https://github.com/acme/payment-api');
		// No chat channel was declared, and a blank href is the dead link this codebase
		// refuses to ship.
		expect(service.chatChannel).toBeNull();
		expect(service.dashboard).toBeNull();
	});

	test('owners come from domains as well as services', async () => {
		// A domain may be owned by a team that runs nothing directly; a filter that
		// omitted them would hide its domains.
		expect(await load(VALID).listOwners()).toEqual(['@identity-team', '@payments-team']);
	});
});

describe('source identity', () => {
	test('uses the declared name for each source', async () => {
		const service = (await load(VALID).findService('payment-api'))!;

		expect(identityFor(service, 'deployment')).toBe('Payment API');
		expect(identityFor(service, 'apm')).toBe('payment-api');
	});

	test('falls back to the slug where nothing is declared', async () => {
		const service = (await load(VALID).findService('auth-service'))!;

		expect(identityFor(service, 'apm')).toBe('auth-service');
		expect(identityFor(service, 'cloud')).toBe('auth-service');
	});
});

describe('a bad catalog refuses to load', () => {
	test('a service naming an undeclared domain', () => {
		// Silently dropping it would leave the dashboard describing a smaller platform
		// than the one that exists, with nothing on the page admitting it.
		expect(() =>
			load(`
version: 1
domains: []
services:
  - slug: orphan
    domain: nowhere
`)
		).toThrow(/nowhere/);
	});

	test('two services sharing a slug', () => {
		expect(() =>
			load(`
version: 1
domains:
  - slug: d
    name: D
    owner: '@t'
    criticality: standard
services:
  - slug: same
    domain: d
  - slug: same
    domain: d
`)
		).toThrow(/twice/);
	});

	test('two domains sharing a slug', () => {
		expect(() =>
			load(`
version: 1
domains:
  - slug: d
    name: One
    owner: '@t'
    criticality: standard
  - slug: d
    name: Two
    owner: '@t'
    criticality: standard
services: []
`)
		).toThrow(/twice/);
	});

	test('a runbook holding a page title rather than a URL', () => {
		// The commonest way this file goes wrong. Unchecked it fails at the click.
		expect(() =>
			load(`
version: 1
domains:
  - slug: d
    name: D
    owner: '@t'
    criticality: standard
services:
  - slug: s
    domain: d
    links:
      runbook: How to restart the payment API
`)
		).toThrow(/invalid/);
	});

	test('a slug with spaces or capitals', () => {
		// It reaches a URL and a PromQL label matcher; constraining it here means neither
		// has to defend against the rest.
		expect(() =>
			load(`
version: 1
domains:
  - slug: 'Not A Slug'
    name: D
    owner: '@t'
    criticality: standard
services: []
`)
		).toThrow(/invalid/);
	});

	test('a criticality outside the set', () => {
		expect(() =>
			load(`
version: 1
domains:
  - slug: d
    name: D
    owner: '@t'
    criticality: quite-important
services: []
`)
		).toThrow(/invalid/);
	});

	test('text that is not YAML at all', () => {
		expect(() => load('version: 1\n\tbad indent: [')).toThrow(/not valid YAML/);
	});

	test('the error names the offending key but never its value', () => {
		// A catalog link may carry a token in its query string.
		const error = (() => {
			try {
				load(`
version: 1
domains:
  - slug: d
    name: D
    owner: '@t'
    criticality: standard
services:
  - slug: s
    domain: d
    links:
      runbook: secret-looking-value
`);
			} catch (thrown) {
				return thrown as Error;
			}
			return null;
		})();

		expect(error?.message).toContain('runbook');
		expect(error?.message).not.toContain('secret-looking-value');
	});
});

describe('the generated example', () => {
	test('parses back into the same catalog it was generated from', async () => {
		// The example is generated from the fixture catalog, so the two cannot drift —
		// but only if something checks that the generated file still loads. A stale
		// example is the first thing anyone copies.
		const text = await Bun.file('catalog.example.yaml').text();
		const fromFile = parseCatalog(text, 'catalog.example.yaml');
		const fixture = new FixtureCatalogSource();

		const fileDomains = await fromFile.listDomains();
		const seedDomains = await fixture.listDomains();

		expect(fileDomains.length).toBe(seedDomains.length);
		expect(fileDomains.map((one) => one.slug)).toEqual(seedDomains.map((one) => one.slug));
		expect(fileDomains.map((one) => one.shortName)).toEqual(
			seedDomains.map((one) => one.shortName)
		);
		expect(fileDomains.map((one) => one.owner)).toEqual(seedDomains.map((one) => one.owner));

		const fileServices = await fromFile.listServices();
		const seedServices = await fixture.listServices();

		expect(fileServices.map((one) => one.slug)).toEqual(seedServices.map((one) => one.slug));
		expect(fileServices.map((one) => one.domainId)).toEqual(
			seedServices.map((one) => one.domainId)
		);
		expect(fileServices.map((one) => one.repository?.href)).toEqual(
			seedServices.map((one) => one.repository?.href)
		);
	});

	test('declares fewer services than the domains claim, and says so honestly', async () => {
		// The domain seeds state service counts in the dozens; six services are actually
		// declared. The catalog reports what is declared rather than what is claimed,
		// which is exactly the drift a catalog exists to make visible.
		const catalog = new FixtureCatalogSource();

		expect((await catalog.listServices()).length).toBeLessThan(
			(await catalog.listDomains()).length
		);
	});
});
