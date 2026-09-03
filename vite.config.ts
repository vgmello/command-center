import tailwindcss from '@tailwindcss/vite';
import adapter from 'svelte-adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
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
