import { error } from '@sveltejs/kit';
import { isDomainTab } from '$lib/platform/domains';
import type { PageLoad } from './$types';

/**
 * Reject a section that is not one of ours, before render.
 *
 * The same guard the service and infrastructure tabs use. `overview` is rejected here
 * too, so a domain has exactly one canonical URL.
 */
export const load: PageLoad = ({ params }) => {
	// `dependencies` has its own route now, so it is rejected here for the same reason
	// `overview` is: a section with two URLs is a section a link can disagree about.
	if (params.tab === 'overview' || params.tab === 'dependencies' || !isDomainTab(params.tab)) {
		error(404, 'No such domain section');
	}

	return { tab: params.tab };
};
