/**
 * Who owns what, stated once.
 *
 * Two stands-in describe this estate and they name nothing alike: the fixture world says
 * `eu-west-1` and `payment-db`, the floci-az seed says `westeurope` and `cc-payments`. Left to
 * two tables they would disagree about which domain a resource belongs to — so the DOMAIN each
 * role belongs to lives here once, and each world attaches its names to the role.
 *
 * Clusters have no role of their own: a cluster lives in a region and inherits its owner.
 */
export const OWNER_TAG_KEY = 'domain';

export type OwnershipRole =
	| 'region-1'
	| 'region-2'
	| 'region-3'
	| 'region-4'
	| 'region-5'
	| 'db-payments'
	| 'db-orders'
	| 'db-users'
	| 'db-inventory'
	| 'db-analytics';

export const ASSIGNMENTS: Record<OwnershipRole, string> = {
	'region-1': 'payment-domain',
	'region-2': 'order-domain',
	'region-3': 'user-domain',
	'region-4': 'inventory-domain',
	'region-5': 'notification-domain',
	'db-payments': 'payment-domain',
	'db-orders': 'order-domain',
	'db-users': 'user-domain',
	'db-inventory': 'inventory-domain',
	// ClickHouse exists only in the fixture world; the seed has no row for this role.
	'db-analytics': 'analytics-domain'
};

/** Fixture names per role: the region, its clusters, and (for db roles) the database. */
export const FIXTURE_NAMES: Record<OwnershipRole, string[]> = {
	'region-1': ['eu-west-1', 'prod-eu-west-1-a', 'prod-eu-west-1-b'],
	'region-2': ['eu-central-1', 'prod-eu-central-1-a'],
	'region-3': ['us-east-1', 'prod-us-east-1-a'],
	'region-4': ['us-west-2', 'prod-us-west-2-a'],
	'region-5': ['ap-southeast-1', 'prod-ap-southeast-1-a'],
	'db-payments': ['payment-db'],
	'db-orders': ['order-db'],
	'db-users': ['user-db'],
	'db-inventory': ['inventory-db'],
	'db-analytics': ['analytics-db']
};

/**
 * Seed names per role: the resource GROUP and its AKS; db roles name the server.
 *
 * Storage accounts are deliberately absent: the seed names them `ccst${location.slice(0, 12)}`,
 * which truncates `southeastasia` to `southeastasi` — a name nobody should have to spell here.
 * The seed tags VMs, AKS and storage by their GROUP's owner (`seedOwnerOf(group)`), so only the
 * group needs a row; databases are tagged by their own name because they override the group.
 */
export const SEED_NAMES: Record<OwnershipRole, string[]> = {
	'region-1': ['cc-westeurope', 'cc-westeurope-aks'],
	'region-2': ['cc-northeurope', 'cc-northeurope-aks'],
	'region-3': ['cc-eastus', 'cc-eastus-aks'],
	'region-4': ['cc-westus2', 'cc-westus2-aks'],
	'region-5': ['cc-southeastasia', 'cc-southeastasia-aks'],
	'db-payments': ['cc-payments'],
	'db-orders': ['cc-orders'],
	'db-users': ['cc-users'],
	'db-inventory': ['cc-inventory'],
	'db-analytics': []
};

/**
 * ARM's tag-matching rule: names are case-insensitive, values are not.
 * Both the provider filter and its test go through this, so they cannot disagree.
 */
export function ownsResource(
	tags: Record<string, string> | undefined,
	key: string,
	value: string
): boolean {
	if (!tags) return false;
	const wanted = key.toLowerCase();
	for (const [name, tagValue] of Object.entries(tags)) {
		if (name.toLowerCase() === wanted) return tagValue === value;
	}
	return false;
}

function ownerIn(names: Record<OwnershipRole, string[]>, name: string): string | null {
	for (const role of Object.keys(names) as OwnershipRole[]) {
		if (names[role].includes(name)) return ASSIGNMENTS[role];
	}
	return null;
}

export function fixtureOwnerOf(name: string): string | null {
	return ownerIn(FIXTURE_NAMES, name);
}

export function seedOwnerOf(groupOrResource: string): string | null {
	return ownerIn(SEED_NAMES, groupOrResource);
}

export function boundDomains(world: 'fixture' | 'seed'): string[] {
	const names = world === 'fixture' ? FIXTURE_NAMES : SEED_NAMES;
	const slugs = (Object.keys(names) as OwnershipRole[])
		.filter((role) => names[role].length > 0)
		.map((role) => ASSIGNMENTS[role]);
	return [...new Set(slugs)];
}

const TIB = 1024 ** 4;

/**
 * The fixture estate's three storage classes split across the bound domains.
 *
 * Classes are types, not resources, so a domain's storage is a share of each class. The
 * per-class sums equal `readStorage()`'s 5.1 / 4.8 / 2.5 TiB — one fixture derives from the
 * other, so the estate donut and a domain's cell cannot tell two stories.
 */
export const FIXTURE_STORAGE_BYTES: Record<string, Record<'block' | 'object' | 'file', number>> = {
	'payment-domain': { block: 2.0 * TIB, object: 1.2 * TIB, file: 0.5 * TIB },
	'order-domain': { block: 1.1 * TIB, object: 1.0 * TIB, file: 0.6 * TIB },
	'user-domain': { block: 0.9 * TIB, object: 1.4 * TIB, file: 0.4 * TIB },
	'inventory-domain': { block: 0.6 * TIB, object: 0.7 * TIB, file: 0.5 * TIB },
	'notification-domain': { block: 0.3 * TIB, object: 0.3 * TIB, file: 0.3 * TIB },
	'analytics-domain': { block: 0.2 * TIB, object: 0.2 * TIB, file: 0.2 * TIB }
};
