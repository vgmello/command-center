import { error } from '@sveltejs/kit';
import { isDomainTab } from '$lib/platform/domains';
import type { PageLoad } from './$types';

/**
 * Sections that have a route of their own, and are therefore not this one's business.
 *
 * A list rather than a chain of comparisons, because it grows with every tab that lands
 * and a forgotten `||` gives a section two URLs — which is a section a link can disagree
 * about. Exported so a test can assert against it rather than restate it — underscore-
 * prefixed because a `+page.ts` may only export the names SvelteKit recognises
 * (`load`, `prerender`, …) plus anything starting with `_`; a bare `BUILT_TABS` builds
 * fine under `bun test` but fails the production build with "Invalid export".
 */
export const _BUILT_TABS = [
	'overview',
	'dependencies',
	'services',
	'deployments',
	'slos',
	'infrastructure'
];

/**
 * Reject a section that is not one of ours, before render.
 *
 * The same guard the service and infrastructure tabs use. `overview` is rejected here
 * too, so a domain has exactly one canonical URL.
 */
export const load: PageLoad = ({ params }) => {
	if (_BUILT_TABS.includes(params.tab) || !isDomainTab(params.tab)) {
		error(404, 'No such domain section');
	}

	return { tab: params.tab };
};
