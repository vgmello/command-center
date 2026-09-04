import { error } from '@sveltejs/kit';
import { isInfraTab } from '$lib/platform/infrastructure';
import type { PageLoad } from './$types';

/**
 * Reject a section that is not one of ours, before render.
 *
 * The same guard the service tabs use, and for the same reason: a component-side check
 * would draw the shell and the tab strip first, then admit the page does not exist.
 * `overview` is rejected here too, so it keeps exactly one URL.
 */
export const load: PageLoad = ({ params }) => {
	if (params.tab === 'overview' || !isInfraTab(params.tab)) {
		error(404, 'No such infrastructure section');
	}

	return { tab: params.tab };
};
