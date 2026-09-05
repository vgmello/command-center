import { query } from '$app/server';
import { scopeSchema, scopedServiceSchema } from '$lib/server/api/schemas';
import { readServiceMetrics, readServiceView, readServices } from '$lib/server/platform/service';

/*
 * The service catalog's transport.
 *
 * Public HTTP endpoints, so every argument is validated — the slug included, because
 * it arrives from a URL someone can edit and is handed to a lookup that will not always
 * be an in-memory array.
 */

/** Every service, for the index and the sidebar pins. */
export const getServices = query(scopeSchema, async (scope) => readServices(scope));

/**
 * One service's overview tab.
 *
 * Resolves to `null` for a slug that matches nothing, which the page turns into a 404.
 * A throw would make an edited URL look like an outage.
 */
export const getServiceView = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readServiceView(scope, slug)
);

/**
 * One service's metrics tab.
 *
 * Its own query rather than a field on the overview: the two tabs are never on screen
 * together, and six series is a lot to fetch for a reader who is looking at the
 * dependency graph.
 */
export const getServiceMetrics = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readServiceMetrics(scope, slug)
);
