import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { OctopusClient, OctopusHttpError } from './client';
import { buildEstate } from './mock/data';
import { startOctopusMock, MAX_TAKE } from './mock/server';
import type { OctopusDeployment } from './mock/data';

const KEY = 'API-TESTTESTTESTTESTTESTTEST';
const estate = buildEstate({ now: new Date('2026-09-04T12:00:00.000Z'), count: 95 });

let mock: ReturnType<typeof startOctopusMock>;

beforeAll(() => {
	mock = startOctopusMock({ estate, apiKey: KEY });
});

afterAll(() => {
	mock.stop();
});

const client = () => new OctopusClient({ baseUrl: mock.url, apiKey: KEY, spaceId: estate.spaceId });

describe('OctopusClient against a server speaking the real contract', () => {
	test('sends the API key header the server actually requires', async () => {
		const body = await client().get<{ TotalResults: number }>(client().spaced('deployments'));
		expect(body.TotalResults).toBe(95);
	});

	test('a wrong key is a 401, not an empty result', async () => {
		const wrong = new OctopusClient({
			baseUrl: mock.url,
			apiKey: 'API-WRONG',
			spaceId: estate.spaceId
		});

		// An empty page would read as "nothing deployed" — the failure this asserts against.
		await expect(wrong.get(wrong.spaced('deployments'))).rejects.toThrow(OctopusHttpError);
		await wrong.get(wrong.spaced('deployments')).catch((error: OctopusHttpError) => {
			expect(error.status).toBe(401);
		});
	});

	test('an error never carries the response body, which can echo request context', async () => {
		const wrong = new OctopusClient({
			baseUrl: mock.url,
			apiKey: 'API-SECRETLOOKING-KEY',
			spaceId: estate.spaceId
		});

		const error = (await wrong.get(wrong.spaced('deployments')).catch((e) => e)) as Error;
		expect(error.message).toContain('401');
		expect(error.message).not.toContain('API-SECRETLOOKING-KEY');
		expect(error.message).not.toContain('logged in');
	});

	test('an unknown id is a 404', async () => {
		const error = await client()
			.get(client().spaced('deployments/Deployments-nope'))
			.catch((e) => e as OctopusHttpError);

		expect(error).toBeInstanceOf(OctopusHttpError);
		expect((error as OctopusHttpError).status).toBe(404);
	});

	test('an unreachable server fails rather than hanging', async () => {
		const dead = new OctopusClient({
			baseUrl: 'http://localhost:1',
			apiKey: KEY,
			spaceId: 'Spaces-1',
			timeoutMs: 500
		});

		const error = await dead.get(dead.spaced('deployments')).catch((e) => e as OctopusHttpError);
		expect(error).toBeInstanceOf(OctopusHttpError);
		expect((error as OctopusHttpError).status).toBe(0);
	});
});

describe('paging', () => {
	test('follows the server past its 30-item cap to collect what was asked for', async () => {
		const items = await client().collect<OctopusDeployment>(client().spaced('deployments'), {
			limit: 75
		});

		// Proves the loop ran: one request could not have returned more than MAX_TAKE.
		expect(items.length).toBe(75);
		expect(MAX_TAKE).toBeLessThan(75);
		expect(new Set(items.map((one) => one.Id)).size).toBe(75);
	});

	test('stops at the end rather than looping on a server that runs out', async () => {
		const items = await client().collect<OctopusDeployment>(client().spaced('deployments'), {
			limit: 500
		});

		expect(items.length).toBe(95);
	});

	test('honours a limit below one page', async () => {
		const items = await client().collect<OctopusDeployment>(client().spaced('deployments'), {
			limit: 7
		});

		expect(items.length).toBe(7);
	});
});

describe('byIds', () => {
	test('fetches a page of records in one request rather than one each', async () => {
		let calls = 0;
		const counting = new OctopusClient({
			baseUrl: mock.url,
			apiKey: KEY,
			spaceId: estate.spaceId,
			fetch: (url, init) => {
				calls++;
				return globalThis.fetch(url, init);
			}
		});

		const ids = estate.tasks.slice(0, 30).map((one) => one.Id);
		const found = await counting.byIds<{ Id: string }>('/api/tasks', ids);

		expect(found.size).toBe(30);
		// The whole point of the batch: thirty rows must not cost thirty requests.
		expect(calls).toBe(1);
	});

	test('splits past the server cap and de-duplicates', async () => {
		const ids = estate.tasks.slice(0, 45).map((one) => one.Id);
		const found = await client().byIds<{ Id: string }>('/api/tasks', [...ids, ...ids]);

		expect(found.size).toBe(45);
	});

	test('an id the server does not know is simply absent', async () => {
		const found = await client().byIds<{ Id: string }>('/api/tasks', ['ServerTasks-999999']);
		expect(found.size).toBe(0);
	});
});
