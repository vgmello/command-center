/**
 * The document's tag list: names, descriptions and order.
 *
 * A module rather than a literal inside the route, because the annotation tests assert
 * that every tag an operation uses is described here — and a copy of the list in the
 * test would be a second source of truth that drifts the first time one is added.
 *
 * The plugin emits tag *names* from the annotations but has nowhere to put a
 * description or an order, so this is merged in when the document is served.
 */
export const API_TAGS = [
	{ name: 'Domains', description: 'Business domains and their rolled-up health.' },
	{ name: 'Services', description: 'The service catalog, and what each service is doing.' },
	{ name: 'Metrics', description: 'Headline rates across the platform.' },
	{ name: 'Activity', description: 'Incidents, deployments and their aggregates.' },
	{ name: 'Infrastructure', description: 'Clusters, nodes, databases and queues.' }
] as const;

export const API_TAG_NAMES: ReadonlySet<string> = new Set(API_TAGS.map((tag) => tag.name));
