import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CoralogixClient, CoralogixHttpError, rowData } from './client';
import { buildEstate } from './mock/data';
import { startCoralogixMock } from './mock/server';
import { DEFAULT_METRICS, requestRate } from './promql';

const KEY = 'cxtp-testtesttesttest';
const NOW = new Date('2026-09-04T12:00:00.000Z');
const estate = buildEstate({ now: NOW, points: 120, stepSeconds: 60 });

let mock: ReturnType<typeof startCoralogixMock>;
const client = () => new CoralogixClient({ baseUrl: mock.url, apiKey: KEY });

const production = { service: 'payment-api', environment: 'production' };

beforeAll(() => {
	mock = startCoralogixMock({ estate, apiKey: KEY });
});

afterAll(() => {
	mock.stop();
});

describe('authentication', () => {
	test('sends the bearer token the API requires', async () => {
		const vector = await client().instant(requestRate(DEFAULT_METRICS, production, '1h'), NOW);
		expect(vector.result.length).toBeGreaterThan(0);
	});

	test('a wrong key is a 401, not an empty result', async () => {
		// An empty result would read as "this service has no traffic".
		const wrong = new CoralogixClient({ baseUrl: mock.url, apiKey: 'cxtp-wrong' });
		const error = await wrong.instant('up', NOW).catch((e) => e as CoralogixHttpError);

		expect(error).toBeInstanceOf(CoralogixHttpError);
		expect((error as CoralogixHttpError).status).toBe(401);
	});

	test('an error never carries the response body or the key', async () => {
		const wrong = new CoralogixClient({ baseUrl: mock.url, apiKey: 'cxtp-secretlooking' });
		const error = (await wrong.instant('up', NOW).catch((e) => e)) as Error;

		expect(error.message).toContain('401');
		expect(error.message).not.toContain('cxtp-secretlooking');
		expect(error.message).not.toContain('Invalid API key');
	});
});

describe('metrics', () => {
	test('a range query returns a matrix across the window', async () => {
		const from = new Date(NOW.getTime() - 3600_000);
		const matrix = await client().range(
			requestRate(DEFAULT_METRICS, production, '1h'),
			from,
			NOW,
			300
		);

		expect(matrix.resultType).toBe('matrix');
		expect(matrix.result[0].values.length).toBe(13);
	});

	test('an instant query returns a vector', async () => {
		const vector = await client().instant(requestRate(DEFAULT_METRICS, production, '1h'), NOW);

		expect(vector.resultType).toBe('vector');
		expect(Number(vector.result[0].value[1])).toBeGreaterThan(0);
	});

	test('a malformed expression fails rather than returning zero', async () => {
		// A query the server cannot run must surface, not read as "no data".
		const error = await client()
			.instant('topk(3, foo)', NOW)
			.catch((e) => e as CoralogixHttpError);

		expect(error).toBeInstanceOf(CoralogixHttpError);
		expect((error as CoralogixHttpError).status).toBe(400);
	});

	test('an unreachable server fails rather than hanging', async () => {
		const dead = new CoralogixClient({
			baseUrl: 'http://localhost:1',
			apiKey: KEY,
			timeoutMs: 500
		});

		const error = await dead.instant('up', NOW).catch((e) => e as CoralogixHttpError);
		expect((error as CoralogixHttpError).status).toBe(0);
	});
});

describe('dataprime', () => {
	test('reads the NDJSON stream into rows', async () => {
		const rows = await client().dataprime(
			'source logs | filter severity == "critical"',
			new Date(NOW.getTime() - 86_400_000),
			NOW
		);

		expect(rows.length).toBeGreaterThan(0);
		expect(rowData<{ title: string }>(rows[0])?.title).toBeDefined();
	});

	test('honours the window it was asked for', async () => {
		// The mock filters on the dates, so a narrow window proves the client sent them.
		const narrow = await client().dataprime(
			'source logs',
			new Date(NOW.getTime() - 10 * 60_000),
			NOW
		);
		const wide = await client().dataprime('source logs', new Date(NOW.getTime() - 86_400_000), NOW);

		expect(narrow.length).toBeLessThan(wide.length);
	});

	test('honours the limit', async () => {
		const rows = await client().dataprime(
			'source logs',
			new Date(NOW.getTime() - 86_400_000),
			NOW,
			1
		);

		expect(rows.length).toBe(1);
	});

	test('rowData returns null for a row that is not JSON, rather than throwing', () => {
		expect(rowData({ userData: 'not json' })).toBeNull();
		expect(rowData({})).toBeNull();
	});
});
