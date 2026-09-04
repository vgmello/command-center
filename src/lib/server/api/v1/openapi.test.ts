import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import * as yaml from 'js-yaml';
import { renderComponents } from '../../../../../scripts/generate-openapi-components';

/**
 * These check the two halves of the published document and the seam between them.
 *
 * The halves are the `@swagger` JSDoc blocks beside each handler and the
 * `components.yaml` generated from the Valibot schemas. The plugin's job is to merge
 * them; ours is to make sure neither half is missing, stale, or pointing at something
 * that is not there — none of which the plugin checks.
 *
 * The annotations are parsed here exactly as `swagger-jsdoc` parses them: strip the
 * comment furniture, then load the remainder as YAML.
 */

const COMPONENTS_PATH = 'src/lib/server/api/v1/components.yaml';

/** Routes that serve the documentation itself are not part of the documented API. */
const UNDOCUMENTED = new Set(['/api/v1/openapi.json']);

interface Operation {
	summary?: string;
	description?: string;
	operationId?: string;
	tags?: string[];
	security?: unknown[];
	parameters?: Array<{ $ref?: string; name?: string }>;
	responses?: Record<string, unknown>;
}

interface ScanResult {
	found: Map<string, { file: string; get: Operation }>;
	/** Blocks that are annotations but do not parse, reported with their file. */
	broken: Array<{ file: string; message: string }>;
}

/**
 * The cost of documenting in comments: the annotation is YAML embedded in a comment,
 * and YAML is unforgiving about things that read fine in prose — an unquoted `key:`
 * inside a description silently ends the scalar. `swagger-jsdoc` skips a block it
 * cannot parse, so the endpoint would vanish from the document with no error.
 *
 * Collected rather than thrown, so the failure names the file instead of surfacing
 * as a stack trace from inside the YAML parser.
 */
async function scan(): Promise<ScanResult> {
	const found = new Map<string, { file: string; get: Operation }>();
	const broken: Array<{ file: string; message: string }> = [];

	for await (const file of new Glob('src/routes/api/v1/**/+server.ts').scan('.')) {
		const source = await Bun.file(file).text();

		for (const block of source.matchAll(/\/\*\*\s*\n([\s\S]*?)\*\//g)) {
			const body = block[1]
				.split('\n')
				.map((line) => line.replace(/^\s*\* ?/, ''))
				.join('\n');

			// Keyed off the tag on its own line: a prose comment that happens to mention
			// `@swagger` is not an annotation.
			if (!/^@swagger\s*$/m.test(body)) continue;

			try {
				const parsed = yaml.load(body.replace(/^@swagger\s*$/m, '')) as Record<
					string,
					{ get: Operation }
				>;

				for (const [path, item] of Object.entries(parsed ?? {})) {
					found.set(path, { file, get: item.get });
				}
			} catch (cause) {
				broken.push({ file, message: (cause as Error).message.split('\n')[0] });
			}
		}
	}

	return { found, broken };
}

async function annotations() {
	return (await scan()).found;
}

async function routePaths(): Promise<string[]> {
	const paths: string[] = [];
	for await (const file of new Glob('src/routes/api/v1/**/+server.ts').scan('.')) {
		paths.push('/' + file.replace('src/routes/', '').replace('/+server.ts', ''));
	}
	return paths.sort();
}

const components = yaml.load(await Bun.file(COMPONENTS_PATH).text()) as {
	components: {
		schemas: Record<string, unknown>;
		parameters: Record<string, unknown>;
		responses: Record<string, unknown>;
	};
};

describe('the generated components file', () => {
	/**
	 * The plugin reads shared schemas from disk, so `components.yaml` is a committed
	 * build artifact. This is the guard that keeps it honest: change a Valibot schema
	 * without regenerating and the test says so, rather than the API publishing a
	 * contract it no longer honours.
	 */
	test('is up to date with the Valibot schemas', async () => {
		const onDisk = await Bun.file(COMPONENTS_PATH).text();

		expect(onDisk, 'stale — run `bun run openapi:components`').toBe(renderComponents());
	});

	test('constraints survive the conversion from Valibot', () => {
		const domain = components.components.schemas.Domain as {
			properties: Record<
				string,
				{ type?: string; minimum?: number; maximum?: number; enum?: string[] }
			>;
		};

		// A hand-written spec loses these first; a generated one cannot.
		expect(domain.properties.healthScore).toMatchObject({ minimum: 0, maximum: 100 });
		expect(domain.properties.serviceCount.type).toBe('integer');
		expect(domain.properties.status.enum).toEqual(['healthy', 'degraded', 'down', 'unknown']);
	});
});

describe('the endpoint annotations', () => {
	test('all parse as YAML', async () => {
		// swagger-jsdoc skips a block it cannot parse, so a malformed annotation drops
		// the endpoint from the document silently. This is the only thing that notices.
		expect((await scan()).broken).toEqual([]);
	});

	test('every endpoint that exists is annotated', async () => {
		const documented = new Set((await annotations()).keys());
		const missing = (await routePaths()).filter(
			(path) => !UNDOCUMENTED.has(path) && !documented.has(path)
		);

		// A new +server.ts under /api/v1 is either part of the contract and needs an
		// @swagger block, or it does not belong under /api/v1.
		expect(missing, 'add an @swagger JSDoc block to these handlers').toEqual([]);
	});

	test('no annotation names a path that does not exist', async () => {
		const actual = new Set(await routePaths());

		// The annotation repeats the route in its own text, and nothing in the plugin
		// checks the two agree — so a typo would publish a path that 404s.
		expect([...(await annotations()).keys()].filter((path) => !actual.has(path))).toEqual([]);
	});

	test('every $ref resolves against the generated components', async () => {
		const defined = new Set([
			...Object.keys(components.components.schemas).map((n) => `#/components/schemas/${n}`),
			...Object.keys(components.components.parameters).map((n) => `#/components/parameters/${n}`),
			...Object.keys(components.components.responses).map((n) => `#/components/responses/${n}`)
		]);

		// Both halves of the document, and every `$ref` shape rather than only the ones
		// that already start `#/components/`. The components half refers to itself —
		// DomainPage embeds Domain — and `toJsonSchemaDefs` writes those as plain JSON
		// Schema `#/$defs/…` pointers, which resolve to nothing once the definitions are
		// merged under `components.schemas`. Matching only the well-formed prefix made
		// exactly the broken pointers invisible.
		const used = new Set(
			[
				...JSON.stringify([[...(await annotations()).values()], components]).matchAll(
					/"\$ref":"([^"]+)"/g
				)
			].map((match) => match[1])
		);

		expect(used.size).toBeGreaterThan(0);
		expect([...used].filter((ref) => !defined.has(ref))).toEqual([]);
	});

	test('every operation is authenticated, scoped, and has an error contract', async () => {
		for (const [path, { get }] of await annotations()) {
			const names = (get.parameters ?? []).map((parameter) =>
				parameter.$ref ? parameter.$ref.split('/').pop() : parameter.name
			);

			expect(names, path).toContain('Environment');
			expect(names, path).toContain('TimeRange');
			expect(get.security, path).toEqual([{ bearerAuth: [] }]);
			expect(Object.keys(get.responses ?? {}).sort(), path).toEqual(['200', '400', '401']);
			expect(get.summary, path).toBeTruthy();
			expect(get.tags?.length, path).toBeGreaterThan(0);
		}
	});

	test('every tag used by an operation is described at the document root', async () => {
		// The plugin emits tag names from the annotations but has nowhere to describe
		// them; the descriptions are added when the document is served. A tag added to
		// a handler and nowhere else shows up in the sidebar with no explanation.
		const described = new Set(['Domains', 'Metrics', 'Activity', 'Infrastructure']);
		const used = [...(await annotations()).values()].flatMap(({ get }) => get.tags ?? []);

		expect([...new Set(used)].filter((tag) => !described.has(tag))).toEqual([]);
	});

	test('operation ids are unique, since clients generate method names from them', async () => {
		const ids = [...(await annotations()).values()].map(({ get }) => get.operationId);

		expect(ids.every(Boolean)).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
