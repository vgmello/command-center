import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// An implementation of a port often does not need every parameter the port
			// defines. Keeping the parameter preserves the signature; the underscore
			// says the omission is deliberate.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {}
	},
	{
		// The sidebar renders navigation supplied by the server, and SectionCard takes
		// its destination as a prop. `resolve()` is typed against the literal route
		// union, so it cannot be applied to an href that is only known at runtime —
		// the rule has nothing to check here. Every other link in the app still does.
		files: [
			'src/lib/components/app/AppSidebar.svelte',
			'src/lib/components/overview/SectionCard.svelte'
		],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// Components under ui/ are vendored by the shadcn-svelte CLI and are
		// overwritten on update, so upstream's patterns are not ours to fix here.
		// Only the rules upstream actually trips are disabled — everything else
		// still applies, since we do edit these files.
		files: ['src/lib/components/ui/**'],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
