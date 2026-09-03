import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { openApiDocument } from './openapi';

const doc = openApiDocument('https://example.test');

/** Routes that serve the documentation itself are not part of the documented API. */
const UNDOCUMENTED = new Set(['/api/v1/openapi.json', '/api/v1/reference']);

/**
 * The routes that actually exist on disk, derived from the filesystem rather than
 * from a list — a list would be the third place this information lives.
 */
async function routePaths(): Promise<string[]> {
	const glob = new Glob('src/routes/api/v1/**/+server.ts');
	const paths: string[] = [];

	for await (const file of glob.scan('.')) {
		paths.push('/' + file.replace('src/routes/', '').replace('/+server.ts', ''));
	}

	return paths.sort();
}

describe('the published document', () => {
	test('documents every endpoint that exists', async () => {
		const documented = new Set(Object.keys(doc.paths));
		const missing = (await routePaths()).filter(
			(path) => !UNDOCUMENTED.has(path) && !documented.has(path)
		);

		// A new +server.ts under /api/v1 is either part of the contract and belongs in
		// the document, or it does not belong under /api/v1.
		expect(missing).toEqual([]);
	});

	test('documents no endpoint that does not exist', async () => {
		const actual = new Set(await routePaths());
		expect(Object.keys(doc.paths).filter((path) => !actual.has(path))).toEqual([]);
	});

	test('every $ref resolves to a defined schema', () => {
		const defined = new Set(Object.keys(doc.components.schemas));
		const refs = [...JSON.stringify(doc).matchAll(/"#\/components\/schemas\/([^"]+)"/g)].map(
			(match) => match[1]
		);

		expect(refs.length).toBeGreaterThan(0);
		expect([...new Set(refs)].filter((name) => !defined.has(name))).toEqual([]);
	});

	test('every operation is authenticated, scoped, and has an error contract', () => {
		expect(doc.security).toEqual([{ bearerAuth: [] }]);

		for (const [path, item] of Object.entries(doc.paths)) {
			const names = item.get.parameters.map((parameter) => (parameter as { name: string }).name);

			expect(names, path).toContain('environment');
			expect(names, path).toContain('timeRange');
			expect(Object.keys(item.get.responses).sort(), path).toEqual(['200', '400', '401']);
			expect(item.get.operationId, path).toBeTruthy();
		}
	});

	test('operation ids are unique, since clients generate method names from them', () => {
		const ids = Object.values(doc.paths).map((item) => item.get.operationId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('constraints survive the conversion from Valibot', () => {
		const domain = doc.components.schemas.Domain as {
			properties: Record<string, { type?: string; minimum?: number; maximum?: number }>;
		};

		// A hand-written spec loses these first; a generated one cannot.
		expect(domain.properties.healthScore).toMatchObject({ minimum: 0, maximum: 100 });
		expect(domain.properties.serviceCount.type).toBe('integer');
	});

	test('names this deployment as the server, so try-it-out targets the right host', () => {
		expect(doc.servers[0].url).toBe('https://example.test');
	});
});
