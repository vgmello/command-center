import { describe, expect, test } from 'bun:test';
import type { PlatformScope } from '$lib/platform/query';
import { stubPrivateEnv } from '$lib/server/testing/sveltekit-env-stub';

/**
 * `readDomain` is the read every domain tab's header shares with `/api/v1/domains/
 * [slug]` — the one place a slug resolves to a domain or `null`. It must stay a single
 * catalog lookup: a tab that fetched the overview composite for a name would drag in
 * the service table, the deployment log and the incident list to print one heading.
 *
 * `service.ts` reaches `platformSource()` through `./index`, which needs
 * `$env/dynamic/private` stubbed to import under plain `bun test` — see
 * `sveltekit-env-stub.ts` for why. That stub must be installed, and `./service`
 * dynamically imported, before this file's own top-level code runs: a static import of
 * `./service` would already have started loading `./index`.
 */
stubPrivateEnv();

const { readDomain } = await import('./service');

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

describe('readDomain', () => {
	test('the domain header is one catalog read, not the overview composite', async () => {
		const header = await readDomain(scope, 'payment-domain');

		expect(header?.slug).toBe('payment-domain');
	});

	test('an unknown slug is null, which the page renders as not-found', async () => {
		expect(await readDomain(scope, 'no-such-domain')).toBeNull();
	});
});
