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
		// Destinations that are only known at runtime: navigation and pins supplied by
		// the server, a destination taken as a prop, a path built from a slug in the
		// URL. `resolve()` is typed against the literal route union, so it cannot be
		// applied to any of these — the rule has nothing to check. Every link the app
		// writes as a literal still goes through it, including the two in these route
		// files that could.
		files: [
			'src/lib/components/app/AppSidebar.svelte',
			'src/lib/components/app/Breadcrumb.svelte',
			'src/lib/components/SectionCard.svelte',
			'src/lib/components/StatTiles.svelte',
			'src/lib/components/infrastructure/InfraTabs.svelte',
			'src/lib/components/services/ServiceTabs.svelte',
			'src/routes/services/+page.svelte',
			// Wildcards, not the literal path: a route's `[slug]` is a character class to
			// the glob matcher, so `[slug]/[tab]` would silently match nothing.
			'src/routes/services/*/*/+page.svelte'
		],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// These render links *out* of the app — a repository, a chat channel, a runbook,
		// an observability console — whose URLs come from the service catalog. `resolve()`
		// resolves internal routes and has nothing to say about an external origin, so
		// the rule fires on every one of them and is wrong each time.
		files: [
			'src/lib/components/services/ServiceHeader.svelte',
			'src/lib/components/services/ServiceInfoCard.svelte'
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
