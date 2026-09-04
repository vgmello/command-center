/**
 * The vocabulary of data sources, on the browser-safe side of the line.
 *
 * These names cross the wire inside snapshots — a panel says which connection fed it —
 * so they live beside the other platform types and import nothing from `$lib/server`.
 */

export const SOURCE_KINDS = ['cloud', 'apm', 'deployment'] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * What a provider can be asked for.
 *
 * Namespaced by kind so the string alone says which contract it belongs to, and so a
 * router can assert it only dispatches capabilities of the kind it routes.
 */
export const CAPABILITIES = [
	'cloud.regions',
	'cloud.nodes',
	'cloud.clusters',
	'cloud.utilization',
	'cloud.storage',
	'cloud.databases',
	'cloud.queues',
	'cloud.alerts',
	'cloud.cost',
	'apm.serviceStats',
	'apm.healthChecks',
	'apm.endpoints',
	'apm.metricSeries',
	'apm.requestRate',
	'apm.slo',
	'apm.latencyHeatmap',
	'apm.insights',
	'apm.domainVitals',
	'apm.rates',
	'apm.incidents',
	'apm.activity',
	'apm.dependencies',
	'deployment.log',
	'deployment.summary',
	'deployment.trends',
	'deployment.statusTrend',
	'deployment.breakdown',
	'deployment.insights',
	'deployment.domains'
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** The kind that answers a capability, read out of its own name. */
export function kindOf(capability: Capability): SourceKind {
	return capability.split('.')[0] as SourceKind;
}

/** Which connection produced a panel's data, and where it lives in that console. */
export interface SourceRef {
	connectionId: string;
	providerId: string;
	kind: SourceKind;
	/** Display name of the connection, e.g. "Azure — Production". */
	name: string;
	/** Icon key. Never a component: this crosses the wire. */
	icon: string;
	/** Deep link into the provider's own console for what this panel shows. */
	link: { label: string; href: string } | null;
}

/**
 * Why a panel has no data.
 *
 * Four distinct causes, because the remedies differ: connect a source, bind the
 * resource, pick a provider that implements it, or nothing — it is simply absent.
 */
export type GapReason = 'no-connection' | 'no-binding' | 'no-capability' | 'not-implemented';

/**
 * One panel's worth of data, or an account of why there is none.
 *
 * `unavailable` and `failed` are separate states on purpose. "Nothing is connected" and
 * "Azure did not answer" are different sentences with different actions, and collapsing
 * them would tell an on-call engineer to configure a source that is already configured.
 */
export type Panel<T> =
	/**
	 * `source` is optional because the ports do not carry provenance yet — which
	 * connection answered arrives with bindings, in the increment that adds them. A panel
	 * that knows its answer but not yet who gave it is still `ok`; inventing a SourceRef
	 * to satisfy the type would put a name on a page that nothing verified.
	 */
	| { status: 'ok'; data: T; source?: SourceRef; stale?: true }
	| { status: 'unavailable'; capability: Capability; kind: SourceKind; reason: GapReason }
	| { status: 'failed'; capability: Capability; kind: SourceKind; source: SourceRef };
