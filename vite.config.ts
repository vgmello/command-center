import openapi from 'sveltekit-openapi-generator';
import tailwindcss from '@tailwindcss/vite';
import adapter from 'svelte-adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		/*
		 * Collects the `@swagger` JSDoc blocks next to each /api/v1 handler into an
		 * OpenAPI document, merged with the schemas generated from Valibot in
		 * `components.yaml`. Must come before `sveltekit()`.
		 *
		 * `include` is narrowed to /api/v1 deliberately: a new `+server.ts` elsewhere —
		 * a webhook, an OAuth callback — must not become published API by existing.
		 *
		 * The server URL is relative so the "try it" button targets whatever host the
		 * reference is being read from, with no per-environment setting.
		 */
		openapi({
			include: ['src/routes/api/v1/**/+server.ts'],
			yamlFiles: ['src/lib/server/api/v1/components.yaml'],
			servers: [{ url: '/', description: 'This deployment' }],
			info: {
				title: 'Command Center API',
				version: '1.0.0',
				description:
					'Read access to platform health: domains, services, headline metrics, ' +
					'incidents, deployments and infrastructure.\n\n' +
					'Every endpoint is scoped by `environment` and `timeRange`, and every ' +
					'response is a fact rather than a rendering — statuses and units are ' +
					'returned, never colours or pre-formatted strings.\n\n' +
					'Authenticate with `Authorization: Bearer <token>`. Tokens are issued out of band.'
			}
		}),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,

				// Required by remote functions: allows `await` in deriveds, template
				// expressions, and the top level of components.
				experimental: { async: true }
			},
			adapter: adapter(),
			experimental: {
				// Remote functions are this project's data layer. See CLAUDE.md.
				remoteFunctions: true
			}
		})
	]
});
