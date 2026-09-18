import { describe, expect, test } from 'bun:test';
import { isDomainTab } from '$lib/platform/domains';
import { _BUILT_TABS } from './+page';

describe('the domain tab fallback', () => {
	test('a section with its own route is rejected here, so it has one URL', () => {
		// `overview` and `dependencies` were already rejected; `services` and `deployments`
		// joined them the moment they had real routes. A section with two URLs is one a link
		// can disagree about.
		for (const built of ['overview', 'dependencies', 'services', 'deployments']) {
			expect(_BUILT_TABS.includes(built)).toBe(true);
		}
	});

	test('a section that is genuinely unbuilt still falls through to the placeholder', () => {
		expect(isDomainTab('alerts')).toBe(true);
		expect(_BUILT_TABS.includes('alerts')).toBe(false);
	});
});
