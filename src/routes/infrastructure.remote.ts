import { query } from '$app/server';
import { scopeSchema } from '$lib/server/api/schemas';
import { readInfrastructureView } from '$lib/server/platform/service';

/*
 * The infrastructure screen's transport.
 *
 * One query, not ten. Every panel on this page reflects the same estate at the same
 * moment, so they change together — splitting them would let the node donut and the
 * node tile disagree by one refresh tick, which is precisely the kind of contradiction
 * a dashboard must not show.
 */
export const getInfrastructureView = query(scopeSchema, async (scope) =>
	readInfrastructureView(scope)
);
