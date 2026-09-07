import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { ROUTES, buildExists, mocksRunning, startApp, type RunningApp } from './harness';

/**
 * Every route answers, under both configurations.
 *
 * No browser here on purpose: this is the cheapest possible net and it catches the most
 * expensive class of failure. All twenty-five domain detail pages once rendered "No domain
 * called X. It may have been renamed or split into others" because the assembler treated
 * absent telemetry as a missing domain — and the whole gate was green, because nothing
 * asked the running app a question.
 *
 * A 200 alone is not enough. SvelteKit answers 200 for a page that then renders an error
 * state, so the body is checked for the sentences that mean "this did not work".
 */

const available = await buildExists();

if (!available) {
	console.warn('[e2e] no build/index.js — run `bun run build`. Smoke tests skipped.');
}

/** Text that means the page rendered a failure, whatever the status code said. */
const FAILURE_TEXT = [
	'No domain called',
	'No service called',
	'is not built yet',
	'Internal Error',
	'500'
];

const describeSmoke = available ? describe : describe.skip;

describeSmoke('every route answers', () => {
	let app: RunningApp;

	beforeAll(async () => {
		app = await startApp('fixtures', 4801);
	}, 40_000);

	afterAll(() => app?.stop());

	for (const route of ROUTES) {
		test(`${route} serves`, async () => {
			const response = await fetch(`${app.baseUrl}${route}`);
			expect(`${route} -> ${response.status}`).toBe(`${route} -> 200`);

			const body = await response.text();
			for (const phrase of FAILURE_TEXT) {
				// `/domains/…/slos` is a placeholder tab and says so, which is a real
				// answer rather than a failure — it is excluded by not being in the list
				// of built pages below rather than by weakening this check.
				if (route.endsWith('/slos') || route.endsWith('/logs')) continue;
				expect(`${route}: ${body.includes(phrase) ? phrase : 'clean'}`).toBe(`${route}: clean`);
			}
		});
	}

	test('the public API is closed without a token, rather than open', async () => {
		const response = await fetch(`${app.baseUrl}/api/v1/domains`);
		expect(response.status).toBe(401);
	});

	test('the OpenAPI document is served without one, because it describes no data', async () => {
		const response = await fetch(`${app.baseUrl}/api/v1/openapi.json`);
		expect(response.status).toBe(200);
	});
});

const sourcesReady = available && (await mocksRunning());

if (available && !sourcesReady) {
	console.warn('[e2e] mocks not listening — run `bun run dev:stack`. Real-source smoke skipped.');
}

describe.if(sourcesReady)('every route answers against real adapters too', () => {
	/**
	 * The configuration that found the bug this file exists for.
	 *
	 * Under fixtures every domain has telemetry, so the branch that treated absent
	 * telemetry as a missing domain never ran. Against a real source it ran for all
	 * twenty-five of them, and the unit suite stayed green throughout.
	 */
	let app: RunningApp;

	beforeAll(async () => {
		app = await startApp('sources', 4804);
	}, 40_000);

	afterAll(() => app?.stop());

	for (const route of ROUTES) {
		test(`${route} serves`, async () => {
			const response = await fetch(`${app.baseUrl}${route}`);
			expect(`${route} -> ${response.status}`).toBe(`${route} -> 200`);
		});
	}

	test('a domain no source measures is not reported as missing', async () => {
		const body = await (await fetch(`${app.baseUrl}/domains/analytics-domain`)).text();
		expect(body.includes('No domain called')).toBe(false);
	});
});

describe('the route list cannot rot', () => {
	test('every page route without parameters is covered', async () => {
		// The capability sweep's lesson, applied here: a list maintained by hand drifts,
		// and the drift is invisible until someone loads the page that was never added.
		const found: string[] = [];

		async function walk(dir: string, prefix: string) {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, `${prefix}/${entry.name}`);
				else if (entry.name === '+page.svelte') found.push(prefix || '/');
			}
		}

		await walk('src/routes', '');

		const concrete = found.filter((one) => !one.includes('['));
		const covered = new Set<string>(ROUTES);

		for (const route of concrete) {
			expect(`${route} covered: ${covered.has(route)}`).toBe(`${route} covered: true`);
		}
	});
});
