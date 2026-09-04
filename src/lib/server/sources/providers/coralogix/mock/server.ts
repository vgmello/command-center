import { buildEstate, type CoralogixEstate } from './data';
import { PromEvaluator } from './promql-eval';

/**
 * A mock Coralogix, speaking both of its wire contracts.
 *
 * The metrics half is Prometheus-compatible and answers real PromQL by evaluating it
 * against seeded series. The DataPrime half answers NDJSON, with the `queryId`,
 * `result` and `statistics` lines a real query returns.
 *
 * It enforces the contract rather than merely answering it: a missing or wrong bearer
 * token is a 401, an unparseable expression is Prometheus's own `error` envelope, and a
 * DataPrime request without a query is a 400.
 */

function unauthorised() {
	return Response.json({ message: 'Invalid API key.' }, { status: 401 });
}

/** Prometheus reports a bad expression in its envelope with HTTP 400. */
function promError(message: string) {
	return Response.json({ status: 'error', errorType: 'bad_data', error: message }, { status: 400 });
}

async function readParams(request: Request): Promise<URLSearchParams> {
	const url = new URL(request.url);

	if (request.method === 'POST') {
		const body = await request.text();
		const posted = new URLSearchParams(body);
		// Prometheus accepts either; a client may legitimately mix them.
		for (const [key, value] of url.searchParams) if (!posted.has(key)) posted.set(key, value);
		return posted;
	}

	return url.searchParams;
}

export function coralogixMockHandler(options: { estate?: CoralogixEstate; apiKey?: string } = {}) {
	const estate = options.estate ?? buildEstate({ now: new Date() });
	const apiKey = options.apiKey ?? 'cxtp-mockmockmockmock';
	const evaluator = new PromEvaluator(estate);

	return async function handle(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, '');

		if (request.headers.get('authorization') !== `Bearer ${apiKey}`) return unauthorised();

		if (path === '/metrics/api/v1/query') {
			const params = await readParams(request);
			const query = params.get('query');
			if (!query) return promError('missing query');

			const at = Number(params.get('time') ?? Date.now() / 1000);

			try {
				const series = evaluator.evaluateAt(query, Math.floor(at));

				return Response.json({
					status: 'success',
					data: {
						resultType: 'vector',
						result: series.map((one) => ({
							metric: one.labels,
							value: [one.points[0]?.at ?? at, String(one.points[0]?.value ?? 0)]
						}))
					}
				});
			} catch (cause) {
				return promError(cause instanceof Error ? cause.message : 'bad expression');
			}
		}

		if (path === '/metrics/api/v1/query_range') {
			const params = await readParams(request);
			const query = params.get('query');
			if (!query) return promError('missing query');

			const start = Number(params.get('start'));
			const end = Number(params.get('end'));
			const step = Number(params.get('step'));

			if (!Number.isFinite(start) || !Number.isFinite(end) || !(step > 0)) {
				return promError('invalid start, end or step');
			}

			// Prometheus refuses a query that would exceed its point limit rather than
			// silently truncating, and so does this — a client that asks for 100k points
			// has a bug worth surfacing.
			if ((end - start) / step > 11_000) return promError('exceeded maximum resolution');

			try {
				const series = evaluator.evaluate(query, Math.floor(start), Math.floor(end), step);

				return Response.json({
					status: 'success',
					data: {
						resultType: 'matrix',
						result: series.map((one) => ({
							metric: one.labels,
							values: one.points.map((point) => [point.at, String(point.value)])
						}))
					}
				});
			} catch (cause) {
				return promError(cause instanceof Error ? cause.message : 'bad expression');
			}
		}

		if (path === '/api/v1/dataprime/query') {
			const body = (await request.json().catch(() => null)) as {
				query?: string;
				metadata?: { startDate?: string; endDate?: string; limit?: number };
			} | null;

			if (!body?.query) return Response.json({ message: 'missing query' }, { status: 400 });

			const from = body.metadata?.startDate ? Date.parse(body.metadata.startDate) : 0;
			const to = body.metadata?.endDate ? Date.parse(body.metadata.endDate) : Date.now();
			const limit = body.metadata?.limit ?? 1000;

			// The query language itself is not evaluated — what the adapter is tested on is
			// whether it asks over the right window and reads the NDJSON correctly. The
			// window IS honoured, because that is the part a wrong request gets wrong.
			const rows = estate.events
				.filter((event) => {
					const at = Date.parse(event.timestamp);
					return at >= from && at <= to;
				})
				.slice(0, limit)
				.map((event) => ({
					metadata: [{ key: 'timestamp', value: event.timestamp }],
					labels: [{ key: 'service', value: event.service }],
					userData: JSON.stringify(event)
				}));

			const lines = [
				JSON.stringify({ queryId: { queryId: 'mock-query-id' } }),
				JSON.stringify({ result: { results: rows } }),
				JSON.stringify({
					statistics: { status: 'COMPLETED', outputRowCount: String(rows.length) }
				})
			];

			return new Response(lines.join('\n') + '\n', {
				headers: { 'Content-Type': 'application/x-ndjson' }
			});
		}

		return Response.json({ message: 'Not found.' }, { status: 404 });
	};
}

/** `port: 0` asks the OS for a free port, so parallel test files never collide. */
export function startCoralogixMock(
	options: { estate?: CoralogixEstate; apiKey?: string; port?: number } = {}
) {
	const handle = coralogixMockHandler(options);
	const server = Bun.serve({ port: options.port ?? 0, fetch: handle });

	return {
		url: `http://localhost:${server.port}`,
		port: server.port,
		stop: () => server.stop(true)
	};
}
