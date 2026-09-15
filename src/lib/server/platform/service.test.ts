import { describe, expect, mock, test } from 'bun:test';
import type { PlatformScope } from '$lib/platform/query';

/**
 * `readDomainHeader` is the read every domain tab shares. It must stay a single catalog
 * lookup — a tab that fetched the overview composite for a name would drag in the
 * service table, the deployment log and the incident list to print one heading.
 *
 * `service.ts` reaches `platformSource()` through `./index`, which reads `$env/dynamic/
 * private` at module scope. That module is a SvelteKit virtual specifier the Vite plugin
 * synthesises at build/dev time; plain `bun test` has no file to resolve it to. Every
 * other test in this codebase sidesteps the problem by constructing a router or a fixture
 * source directly instead of going through `service.ts`'s singleton. This is the first
 * test of a `service.ts` wrapper function itself, so it stubs the virtual module before
 * dynamically importing `./service` — a static import would already have started loading
 * `./index` before this file's own top-level code got a chance to run.
 */
mock.module('$env/dynamic/private', () => ({ env: {} }));

const { readDomainHeader } = await import('./service');

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

describe('readDomainHeader', () => {
	test('the domain header is one catalog read, not the overview composite', async () => {
		const header = await readDomainHeader(scope, 'payment-domain');

		expect(header?.slug).toBe('payment-domain');
	});

	test('an unknown slug is null, which the page renders as not-found', async () => {
		expect(await readDomainHeader(scope, 'no-such-domain')).toBeNull();
	});
});
