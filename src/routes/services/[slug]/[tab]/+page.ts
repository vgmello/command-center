import { error } from '@sveltejs/kit';
import { isServiceTab } from '$lib/platform/services';
import type { PageLoad } from './$types';

/**
 * Reject a tab that is not one of ours.
 *
 * A `load` rather than a check inside the component, because this is the one case
 * CLAUDE.md keeps `load` for: a route-level guard that has to run before render. A
 * component-side check would render the shell and the tab strip first, and only then
 * admit the page does not exist.
 *
 * `overview` is excluded too — it lives at the bare service path, and serving it here
 * as well would give one tab two URLs.
 */
export const load: PageLoad = ({ params }) => {
	if (params.tab === 'overview' || !isServiceTab(params.tab)) {
		error(404, 'No such service section');
	}

	return { tab: params.tab };
};
