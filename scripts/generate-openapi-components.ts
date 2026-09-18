#!/usr/bin/env bun
import * as yaml from 'js-yaml';
import { openApiComponents } from '../src/lib/server/api/v1/openapi';

/**
 * Writes the reusable half of the OpenAPI document to a YAML file, for
 * `sveltekit-openapi-generator` to merge with the `@swagger` JSDoc blocks.
 *
 * The plugin reads shared components from a file on disk, so the Valibot schemas
 * have to be serialised ahead of it rather than handed over in memory. The output
 * is committed and checked by a test: `openapi.test.ts` regenerates it and fails if
 * the file on disk disagrees, so a schema change that was not regenerated is a red
 * test rather than a wrong published contract.
 *
 * Run with `bun run openapi:components`.
 */

const OUTPUT = 'src/lib/server/api/v1/components.yaml';

const banner = `# GENERATED FILE — do not edit.
# Produced from the Valibot schemas in dto.ts by \`bun run openapi:components\`.
# Merged into the published spec by the openapi plugin in vite.config.ts.
`;

export function renderComponents(): string {
	return (
		banner +
		yaml.dump(openApiComponents(), {
			// Stable key order, so a regeneration produces a diff only where something
			// actually changed rather than reshuffling the whole file.
			sortKeys: true,
			lineWidth: 100,
			noRefs: true
		})
	);
}

if (import.meta.main) {
	await Bun.write(OUTPUT, renderComponents());
	console.log(`[openapi] wrote ${OUTPUT}`);
}
