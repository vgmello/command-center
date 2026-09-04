import { query } from '$app/server';
import {
	domainPageSizeOptions,
	domainSortOptions,
	domainStatusFilterOptions
} from '$lib/platform/query';
import { describeHealthThresholds } from '$lib/platform/health';
import { ENVIRONMENTS, NAV_ITEMS, TIME_RANGES } from '$lib/server/platform/fixtures';
import { scopeSchema } from '$lib/server/api/schemas';
import { workspaceSource } from '$lib/server/platform';
import { DEFAULT_PAGE_SIZE } from '$lib/server/platform/snapshot';
import { DOMAINS_PAGE_SIZE } from '$lib/server/platform/domains-view';
import { readSystemStatus } from '$lib/server/platform/service';

/*
 * The chrome every page renders inside.
 *
 * Its own module rather than a corner of the overview's, because the layout needs it
 * on every route and nothing about it belongs to one screen.
 */

/**
 * Navigation, favourites, the signed-in user, the scope pickers, and the vocabulary
 * the domain table's controls are built from.
 *
 * The option lists travel with the shell so the client never declares its own — a
 * hardcoded option list in a component is a second source of truth that drifts until
 * the endpoint rejects something the UI offered. The threshold sentence is generated
 * from the constants that decide the bands, so it cannot describe a rule the code no
 * longer applies.
 *
 * Split from the page data because none of it changes when the scope does — switching
 * environment must not re-render the sidebar.
 */
export const getShell = query(async () => {
	const workspace = workspaceSource();
	const [user, favorites] = await Promise.all([
		workspace.readCurrentUser(),
		workspace.listFavorites()
	]);

	return {
		nav: NAV_ITEMS,
		favorites,
		user,
		environments: ENVIRONMENTS,
		timeRanges: TIME_RANGES,
		domainStatusFilters: domainStatusFilterOptions(),
		domainSortOptions: domainSortOptions(),
		domainPageSizes: domainPageSizeOptions(),
		healthThresholds: describeHealthThresholds(),
		/** The overview's compact summary of the table. */
		defaultPageSize: DEFAULT_PAGE_SIZE,
		/** The domains page's full table, which has room for more rows. */
		domainsPageSize: DOMAINS_PAGE_SIZE
	};
});

/**
 * The aggregate badge in the sidebar footer.
 *
 * Its own query rather than a field on the shell: it reflects live health, so it has
 * to refresh on the same cadence as the page it sits beside, while the rest of the
 * shell does not.
 */
export const getSystemStatus = query(scopeSchema, async (scope) => readSystemStatus(scope));
