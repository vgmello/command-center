import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	HYDRATED,
	openView,
	ROUTES,
	azureStackRunning,
	buildExists,
	mocksRunning,
	settle,
	startApp,
	type RunningApp
} from './harness';

/**
 * What the pages actually say once they have rendered.
 *
 * `Bun.WebView` rather than a browser-automation dependency: it is in the runtime, which
 * makes this tier 2 of the API selection order instead of tier 4, and it needs no browser
 * download in CI. Navigate, evaluate, click — that is the whole surface this needs.
 *
 * The sweep below is the highest-value assertion in the suite and the cheapest. Every one
 * of these tokens has actually reached a page in this codebase: the services table read
 * "2.1387043477711356 req/s" against a real source, and the storage panel read
 * "41.12903225806452%" after formatting moved a layer up. Both shipped past a full green
 * gate, because a logic test cannot see a number that was never formatted.
 */

const available = await buildExists();

if (!available) {
	console.warn('[e2e] no build/index.js — run `bun run build`. Render tests skipped.');
}

const describeRender = available ? describe : describe.skip;

/** Text that means something was printed rather than formatted. */
const GARBAGE: Array<[RegExp, string]> = [
	// Four decimals is past anything this app formats deliberately.
	[/\d\.\d{4,}/, 'an unformatted float'],
	[/\bundefined\b/, 'the word undefined'],
	[/\bNaN\b/, 'NaN'],
	[/\[object Object\]/, 'a stringified object'],
	[/\bInfinity\b/, 'Infinity']
];

function findGarbage(text: string): string[] {
	return GARBAGE.flatMap(([pattern, label]) => {
		const hit = text.match(pattern);
		return hit ? [`${label} (${hit[0]})`] : [];
	});
}

describeRender('what a reader actually sees', () => {
	let app: RunningApp;
	let view: InstanceType<typeof Bun.WebView>;

	beforeAll(async () => {
		app = await startApp('fixtures', 4802);
		view = openView();
	}, 40_000);

	afterAll(() => {
		view?.close();
		app?.stop();
	});

	for (const route of ROUTES) {
		test(`${route} renders without printing raw values`, async () => {
			await view.navigate(`${app.baseUrl}${route}`);
			const text = await settle(view, HYDRATED);

			expect(`${route}: ${findGarbage(text).join(', ') || 'clean'}`).toBe(`${route}: clean`);
		}, 40_000);
	}

	test('a domain page shows its readings, not just its chrome', async () => {
		// Guards the sweep itself: a page that rendered nothing would pass every pattern
		// above, which is exactly how a broken test looks like a working one.
		await view.navigate(`${app.baseUrl}/domains/payment-domain`);
		const text = await settle(view, (one) => one.includes('Domain Health'));

		for (const heading of ['Domain Health', 'Services Health', 'Domain Dependencies']) {
			expect(`${heading}: ${text.includes(heading)}`).toBe(`${heading}: true`);
		}
	}, 40_000);

	test('the dependency graph draws its wires and both column captions', async () => {
		await view.navigate(`${app.baseUrl}/domains/payment-domain/dependencies`);
		await settle(view, (one) => one.includes('CALLS THIS DOMAIN'));

		// Both sides can hold the same family, so the captions are the only thing saying
		// which way the wires run — they were missing on the first render of this page.
		const wires = await view.evaluate("document.querySelectorAll('path[id^=dep-wire-]').length");
		expect(wires as number).toBeGreaterThan(0);
	}, 40_000);
});

const sourcesReady = available && (await mocksRunning());

if (available && !sourcesReady) {
	console.warn('[e2e] mocks not listening — run `bun run dev:stack`. Real-source tests skipped.');
}

describe.if(sourcesReady)('the same pages, against real adapters', () => {
	/**
	 * The mode that finds what fixtures cannot.
	 *
	 * Fixtures answer every question and return whole numbers, so the paths that handle
	 * "the source cannot say" never run and nothing is ever printed unformatted. Three of
	 * this session's bugs — every domain page 404ing, the raw request rates, the health
	 * check published in the wrong unit — existed only here.
	 */
	let app: RunningApp;
	let view: InstanceType<typeof Bun.WebView>;

	beforeAll(async () => {
		app = await startApp('sources', 4803);
		view = openView();
	}, 40_000);

	afterAll(() => {
		view?.close();
		app?.stop();
	});

	for (const route of ROUTES) {
		test(`${route} renders cleanly against real sources`, async () => {
			await view.navigate(`${app.baseUrl}${route}`);
			const text = await settle(view, HYDRATED);

			expect(`${route}: ${findGarbage(text).join(', ') || 'clean'}`).toBe(`${route}: clean`);
		}, 40_000);
	}

	test('a domain no source measures still renders, and says why', async () => {
		// The exact page that used to claim the domain did not exist.
		await view.navigate(`${app.baseUrl}/domains/analytics-domain`);
		const text = await settle(view, (one) => one.includes('Analytics Domain'));

		expect(text.includes('No domain called')).toBe(false);
		expect(text.includes('Not reported')).toBe(true);
	}, 40_000);
});

const azureReady = available && (await azureStackRunning());

if (available && !azureReady) {
	console.warn(
		'[e2e] floci-az or the Azure mocks not listening — run `bun run db:up`, `bun run seed:azure` and `bun run dev:stack`. Azure tests skipped.'
	);
}

describe.if(azureReady)('the infrastructure page, against a real cloud API', () => {
	/**
	 * The only mode where the estate is read from a cloud rather than from seeds.
	 *
	 * It is worth its own boot because every reading on this screen takes a different path
	 * here: regions and nodes come from ARM resource metadata, clusters, utilisation,
	 * storage and databases from Monitor metrics, spend from Cost Management — and queues
	 * and alerts from nothing at all, which is the case fixtures can never produce.
	 */
	let app: RunningApp;
	let view: InstanceType<typeof Bun.WebView>;

	beforeAll(async () => {
		app = await startApp('azure', 4804);
		view = openView();
	}, 40_000);

	afterAll(() => {
		view?.close();
		app?.stop();
	});

	for (const route of ['/infrastructure', '/infrastructure/compute'] as const) {
		test(`${route} renders cleanly against Azure`, async () => {
			await view.navigate(`${app.baseUrl}${route}`);
			const text = await settle(view, HYDRATED);

			expect(`${route}: ${findGarbage(text).join(', ') || 'clean'}`).toBe(`${route}: clean`);
		}, 40_000);
	}

	test('the readings are scaled, and the two gaps say so', async () => {
		// Available memory is bytes and disk is bytes per second, so both would print
		// ten-digit integers if the headline units were not there. Queues and alerts are
		// the capabilities Azure does not declare, and a stated gap is the whole point of
		// declaring seven rather than nine.
		await view.navigate(`${app.baseUrl}/infrastructure`);
		const text = await settle(view, HYDRATED);

		expect(/\d+(\.\d+)? (K|M|G|T)B\b/.test(text)).toBe(true);
		expect(text).toContain('Memory available');
		expect(text.toLowerCase()).toContain('no connected');
	}, 40_000);
});
