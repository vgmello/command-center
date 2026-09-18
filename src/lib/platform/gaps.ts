import type { GapReason, Panel, SourceKind } from './sources';

/** The label each kind prints as — moved here from PanelGap so the page and the API share it. */
const KIND_LABEL: Record<SourceKind, string> = {
	cloud: 'cloud',
	apm: 'APM',
	deployment: 'deployment'
};

/**
 * The one sentence a gap produces, for the page and for the 501 body alike.
 *
 * Pure so `bun test` can assert it — the component that prints it cannot be rendered by the
 * test runner. "No connected source" is FALSE for an unbound domain (its cloud is connected
 * and answering), for an ambiguous binding, and for a narrowing nobody has built yet, which is
 * why those three reasons have their own sentences and the rest keep the wording every panel
 * has printed until now.
 */
export function gapSentence(reason: GapReason, kind: SourceKind, noun: string): string {
	switch (reason) {
		case 'no-binding':
			// Key-agnostic on purpose: `ownerTagKey` is a provider setting, and a sentence naming it
			// would be wrong the moment someone changes it.
			return `Not bound to a ${KIND_LABEL[kind]} — no resources are tagged for this domain.`;
		case 'ambiguous-connection':
			return `Several ${KIND_LABEL[kind]} connections are configured; this domain's binding must name one.`;
		case 'not-implemented':
			// The one producer (`routers/infrastructure.ts` `scoped()`) refuses an owner-scoped
			// read before consulting the catalog or any connection, so this fires whether or not a
			// source is connected — the sentence claims only what is true in every configuration:
			// the narrowing is unbuilt. Owner scoping is domain-only today (`ownerBinding` resolves
			// through `catalog.findDomain`), which is what "one domain" rests on.
			return `Narrowing ${noun} to one domain is not implemented for ${KIND_LABEL[kind]} sources yet.`;
		default:
			return `No connected ${KIND_LABEL[kind]} source provides ${noun}.`;
	}
}

/**
 * Whether a screen's panels are all unbound — and only then.
 *
 * Binding is per domain, so `'no-binding'` is all-or-nothing across a domain screen's reads;
 * a capability gap is not. Six identical "not bound" cards would say one thing six times, so
 * the page says it once when every panel agrees, and falls through to per-panel gaps for any
 * other mix — a bound domain missing one capability shows five panels and one stated gap.
 */
export function collapseUnbound(panels: ReadonlyArray<Panel<unknown>>): boolean {
	return (
		panels.length > 0 &&
		panels.every((panel) => panel.status === 'unavailable' && panel.reason === 'no-binding')
	);
}
