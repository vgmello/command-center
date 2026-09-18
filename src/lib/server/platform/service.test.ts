import { describe, expect, test } from 'bun:test';
import type { PlatformScope } from '$lib/platform/query';
import { gapSentence } from '$lib/platform/gaps';
import { errorResponse } from '$lib/server/api/error-response';
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

const { readDomain, readRegions } = await import('./service');

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

/**
 * The domain infrastructure routes (Task 12) 404 an unknown slug via `readDomain`
 * above, then read straight through the same `owner`-scoped readers the estate routes
 * use. A domain with no declared cloud binding — `tax-domain` — is the case that must
 * surface as a 501 rather than an empty 200: `errorResponse` maps the reader's
 * `CapabilityUnavailableError` to the same sentence a gapped panel would show.
 */
describe('readRegions for a domain with no cloud binding', () => {
	test('rejects with reason "no-binding"', async () => {
		await expect(readRegions(scope, 'tax-domain')).rejects.toMatchObject({
			reason: 'no-binding'
		});
	});

	test('errorResponse maps it to a 501 with the panel gap sentence', async () => {
		const cause = await readRegions(scope, 'tax-domain').catch((error) => error);
		const response = errorResponse(cause);

		expect(response?.status).toBe(501);
		const body = await response?.json();
		expect(body.message).toBe(gapSentence('no-binding', 'cloud', 'cloud.regions'));
	});
});
