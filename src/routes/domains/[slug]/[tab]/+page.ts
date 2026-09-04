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
	if (params.tab === 'overview' || !isDomainTab(params.tab)) {
		error(404, 'No such domain section');
	}

	return { tab: params.tab };
};
