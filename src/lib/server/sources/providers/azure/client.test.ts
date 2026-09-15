import { describe, expect, test } from 'bun:test';
import { AzureClient, isoDuration } from './client';

/**
 * The client, against a server that behaves the way ARM does.
 *
 * The paging test is the one worth having. ARM pages with an absolute `nextLink` rather
 * than a skip offset, and a client that assumed offsets would re-read page one forever —
 * looking like it worked, because page one is full of real data.
 */

const credential = {
	getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3_600_000 })
};

function client(baseUrl: string, overrides: Partial<{ scope: string }> = {}) {
	return new AzureClient({
		baseUrl,
		costBaseUrl: baseUrl,
		monitorBaseUrl: baseUrl,
		subscriptionId: 'sub-1',
		credential,
		...overrides
	});
}

describe('paging', () => {
	test('follows nextLink rather than assuming an offset', async () => {
		let served = 0;
		const server = Bun.serve({
			port: 0,
			fetch: (request) => {
				served++;
				const url = new URL(request.url);
				const page = Number(url.searchParams.get('page') ?? 1);

				return Response.json({
					value: [{ id: `r${page}` }],
					nextLink: page < 4 ? `${url.origin}/x?page=${page + 1}` : undefined
				});
			}
		});

		try {
			const rows = await client(`http://localhost:${server.port}`).collect<{ id: string }>('/x', {
				limit: 10
			});

			expect(rows.map((one) => one.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
			expect(served).toBe(4);
		} finally {
			server.stop(true);
		}
	});

	test('stops as soon as it has enough rows, rather than walking the estate', async () => {
		let served = 0;
		const server = Bun.serve({
			port: 0,
			fetch: (request) => {
				served++;
				const url = new URL(request.url);
				const page = Number(url.searchParams.get('page') ?? 1);

				return Response.json({
					value: [{ id: `r${page}` }, { id: `r${page}b` }],
					nextLink: `${url.origin}/x?page=${page + 1}`
				});
			}
		});

		try {
			const rows = await client(`http://localhost:${server.port}`).collect('/x', { limit: 3 });

			expect(rows).toHaveLength(3);
			// Two pages of two covers three. A third would be a page nobody needed.
			expect(served).toBe(2);
		} finally {
			server.stop(true);
		}
	});
});

describe('authentication', () => {
	test('attaches a bearer token to every request', async () => {
		const seen: Array<string | null> = [];
		const server = Bun.serve({
			port: 0,
			fetch: (request) => {
				seen.push(request.headers.get('authorization'));
				return Response.json({ value: [] });
			}
		});

		try {
			await client(`http://localhost:${server.port}`).get('/x');
			expect(seen).toEqual(['Bearer test-token']);
		} finally {
			server.stop(true);
		}
	});

	test('asks for one token, not one per request', async () => {
		let issued = 0;
		const counting = {
			getToken: async () => {
				issued++;
				return { token: 't', expiresOnTimestamp: Date.now() + 3_600_000 };
			}
		};

		const server = Bun.serve({ port: 0, fetch: () => Response.json({ value: [] }) });

		try {
			const one = new AzureClient({
				baseUrl: `http://localhost:${server.port}`,
				costBaseUrl: `http://localhost:${server.port}`,
				monitorBaseUrl: `http://localhost:${server.port}`,
				subscriptionId: 'sub-1',
				credential: counting
			});

			await one.get('/a');
			await one.get('/b');
			await one.get('/c');

			expect(issued).toBe(1);
		} finally {
			server.stop(true);
		}
	});

	test('a token about to expire is replaced before it is used', async () => {
		// Expiring mid-flight fails the request rather than the refresh, which is the
		// confusing way round — so the cache retires a token a minute early.
		let issued = 0;
		const expiring = {
			getToken: async () => {
				issued++;
				return { token: `t${issued}`, expiresOnTimestamp: Date.now() + 30_000 };
			}
		};

		const server = Bun.serve({ port: 0, fetch: () => Response.json({ value: [] }) });

		try {
			const one = new AzureClient({
				baseUrl: `http://localhost:${server.port}`,
				costBaseUrl: `http://localhost:${server.port}`,
				monitorBaseUrl: `http://localhost:${server.port}`,
				subscriptionId: 'sub-1',
				credential: expiring
			});

			await one.get('/a');
			await one.get('/b');

			expect(issued).toBe(2);
		} finally {
			server.stop(true);
		}
	});
});

describe('failures', () => {
	test("carry ARM's error code, and not the body", async () => {
		// A body can hold the resource ids of a whole subscription, and an exception
		// message ends up in logs.
		const server = Bun.serve({
			port: 0,
			fetch: () =>
				Response.json(
					{ error: { code: 'AuthorizationFailed', message: 'secret-looking detail' } },
					{ status: 403 }
				)
		});

		try {
			await client(`http://localhost:${server.port}`).get('/x');
			throw new Error('should have thrown');
		} catch (cause) {
			const message = (cause as Error).message;
			expect(message).toContain('AuthorizationFailed');
			expect(message).not.toContain('secret-looking detail');
		} finally {
			server.stop(true);
		}
	});
});

describe('metrics', () => {
	test('returns the series in the order asked for, with absent ones empty', async () => {
		// A caller lining three metrics up on one axis should not have to discover that
		// the middle one is missing.
		const server = Bun.serve({
			port: 0,
			fetch: () =>
				Response.json({
					value: [
						{
							name: { value: 'Percentage CPU' },
							timeseries: [{ data: [{ timeStamp: '2026-09-15T00:00:00Z', average: 42 }] }]
						}
					]
				})
		});

		try {
			const series = await client(`http://localhost:${server.port}`).metrics(
				'/subscriptions/sub-1/resourceGroups/g/providers/Microsoft.Compute/virtualMachines/vm',
				['Percentage CPU', 'Network In Total'],
				{ from: new Date(0), to: new Date(60_000), stepSeconds: 60 }
			);

			expect(series.map((one) => one.name)).toEqual(['Percentage CPU', 'Network In Total']);
			expect(series[0].points[0].value).toBe(42);
			expect(series[1].points).toEqual([]);
		} finally {
			server.stop(true);
		}
	});
});

describe('isoDuration', () => {
	test('translates the steps this app actually uses', () => {
		expect(isoDuration(60)).toBe('PT1M');
		expect(isoDuration(3_600)).toBe('PT1H');
		expect(isoDuration(86_400)).toBe('P1D');
	});

	test('snaps to an interval Monitor accepts, rather than a faithful one it rejects', () => {
		// PT90S is the correct translation of ninety seconds and a request Azure refuses.
		expect(isoDuration(90)).toBe('PT1M');
		expect(isoDuration(400)).toBe('PT5M');
	});

	test('snaps down, so a step never returns fewer points than its grid expects', () => {
		expect(isoDuration(3_599)).toBe('PT30M');
	});

	test('never asks for finer than a minute, which Monitor does not offer', () => {
		expect(isoDuration(5)).toBe('PT1M');
		expect(isoDuration(0)).toBe('PT1M');
	});
});
