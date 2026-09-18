import type { DependencyKind, DomainDependencyNode } from './types';

/**
 * Where the dependency graph's boxes and wires go.
 *
 * Arithmetic, not a layout engine and not a measurement of the DOM. The obvious approach —
 * render the boxes, walk `offsetParent` to find where they landed, then draw — is what the
 * reference sketch did, and it cannot be tested, has to be redone on every resize and font
 * load, and draws wires a frame late. Positions here are a function of how many nodes each
 * family has, so the paths are known before anything is rendered.
 *
 * Nothing in this file knows a colour or a class. It returns numbers and path data;
 * `tone.ts` still owns every tint.
 */

/** One box, in the graph's own coordinate space. */
export interface GraphBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A family of dependencies drawn together, with its own heading. */
export interface GraphGroup {
	kind: DependencyKind;
	label: string;
	side: 'upstream' | 'downstream';
	/** The heading's own box, so the caller need not re-derive it. */
	header: GraphBox;
	nodes: Array<GraphBox & { node: DomainDependencyNode }>;
}

export interface GraphEdge {
	id: string;
	/** An SVG cubic path from the source's edge to the target's. */
	d: string;
	/** Stroke width, following throughput. */
	weight: number;
	/**
	 * Seconds for one packet to travel the wire.
	 *
	 * Inverse of throughput, so a busy edge pulses faster. Clamped at both ends: below
	 * about a second the dots read as noise, and above five they look stopped.
	 */
	pulseSeconds: number;
}

/** A column's own caption, which is the only thing that says which way the wires run. */
export interface GraphColumn {
	side: 'upstream' | 'downstream';
	label: string;
	box: GraphBox;
}

export interface DependencyGraphLayout {
	width: number;
	height: number;
	hub: GraphBox;
	columns: GraphColumn[];
	groups: GraphGroup[];
	edges: GraphEdge[];
}

/** The metrics of the boxes, in pixels. Exported so a component can size itself to match. */
export const GRAPH_METRICS = {
	nodeWidth: 236,
	nodeHeight: 52,
	nodeGap: 8,
	headerHeight: 26,
	groupGap: 18,
	groupPadding: 10,
	hubWidth: 216,
	hubHeight: 76,
	/** Horizontal room between a column and the hub, where the wires live. */
	columnGap: 104,
	/** The caption above each column. */
	captionHeight: 22
} as const;

/**
 * What each column is.
 *
 * Both sides can hold the same family — a domain often calls internal domains and is
 * called by them — so without this a reader sees "Internal domains" twice and nothing
 * saying which way anything flows, which is the one thing the picture exists to show.
 */
const COLUMN_LABELS: Record<'upstream' | 'downstream', string> = {
	upstream: 'Calls this domain',
	downstream: 'This domain calls'
};

const LABELS: Record<DependencyKind, string> = {
	datastore: 'Datastores',
	queue: 'Messaging',
	service: 'Internal domains',
	external: 'External providers'
};

/** The order families are stacked in, coarsest infrastructure last. */
const ORDER: DependencyKind[] = ['service', 'datastore', 'queue', 'external'];

function groupHeight(count: number): number {
	const { nodeHeight, nodeGap, headerHeight, groupPadding } = GRAPH_METRICS;
	return headerHeight + count * nodeHeight + (count - 1) * nodeGap + groupPadding * 2;
}

/** Split one side's nodes into families, keeping the declared order and dropping empties. */
function familiesOf(
	nodes: DomainDependencyNode[],
	side: 'upstream' | 'downstream'
): Array<{ kind: DependencyKind; side: 'upstream' | 'downstream'; nodes: DomainDependencyNode[] }> {
	return ORDER.map((kind) => ({
		kind,
		side,
		nodes: nodes.filter((one) => one.kind === kind)
	})).filter((one) => one.nodes.length > 0);
}

function columnHeight(families: Array<{ nodes: DomainDependencyNode[] }>): number {
	if (families.length === 0) return 0;

	return (
		GRAPH_METRICS.captionHeight +
		families.reduce((sum, one) => sum + groupHeight(one.nodes.length), 0) +
		(families.length - 1) * GRAPH_METRICS.groupGap
	);
}

/**
 * A cubic from one box's edge to another's, bulging horizontally.
 *
 * The control points sit a little over half the horizontal distance apart, which is what
 * keeps a wire from a tall column's top row from cutting through the rows beneath it.
 */
function wire(from: { x: number; y: number }, to: { x: number; y: number }): string {
	const bulge = Math.max(40, (to.x - from.x) * 0.55);
	return `M${from.x},${from.y} C${from.x + bulge},${from.y} ${to.x - bulge},${to.y} ${to.x},${to.y}`;
}

/**
 * Lay out the whole graph.
 *
 * Upstream on the left flowing in, downstream on the right flowing out, the domain in the
 * middle. Both columns are centred against the taller of the two so the hub sits level with
 * the middle of the picture rather than the middle of one side.
 */
export function layoutDependencyGraph(dependencies: {
	upstream: DomainDependencyNode[];
	downstream: DomainDependencyNode[];
}): DependencyGraphLayout {
	const metrics = GRAPH_METRICS;
	const left = familiesOf(dependencies.upstream, 'upstream');
	const right = familiesOf(dependencies.downstream, 'downstream');

	const leftHeight = columnHeight(left);
	const rightHeight = columnHeight(right);
	const height = Math.max(leftHeight, rightHeight, metrics.hubHeight);
	const width = metrics.nodeWidth * 2 + metrics.hubWidth + metrics.columnGap * 2;

	const hub: GraphBox = {
		id: 'hub',
		x: metrics.nodeWidth + metrics.columnGap,
		y: (height - metrics.hubHeight) / 2,
		width: metrics.hubWidth,
		height: metrics.hubHeight
	};

	const columns: GraphColumn[] = [];
	const groups: GraphGroup[] = [];
	const edges: GraphEdge[] = [];

	for (const [side, families, total] of [
		['upstream', left, leftHeight],
		['downstream', right, rightHeight]
	] as const) {
		const columnX =
			side === 'upstream' ? 0 : metrics.nodeWidth + metrics.columnGap * 2 + metrics.hubWidth;
		let y = (height - total) / 2;

		if (families.length > 0) {
			columns.push({
				side,
				label: COLUMN_LABELS[side],
				box: {
					id: `column:${side}`,
					x: columnX,
					y,
					width: metrics.nodeWidth,
					height: metrics.captionHeight
				}
			});
			y += metrics.captionHeight;
		}

		for (const family of families) {
			const header: GraphBox = {
				id: `${side}:${family.kind}`,
				x: columnX,
				y,
				width: metrics.nodeWidth,
				height: metrics.headerHeight
			};

			const placed = family.nodes.map((node, index) => ({
				id: node.id,
				x: columnX,
				y:
					y +
					metrics.headerHeight +
					metrics.groupPadding +
					index * (metrics.nodeHeight + metrics.nodeGap),
				width: metrics.nodeWidth,
				height: metrics.nodeHeight,
				node
			}));

			groups.push({ kind: family.kind, label: LABELS[family.kind], side, header, nodes: placed });

			for (const box of placed) {
				const anchor = {
					x: box.x + (side === 'upstream' ? box.width : 0),
					y: box.y + box.height / 2
				};
				const hubAnchor = {
					x: hub.x + (side === 'upstream' ? 0 : hub.width),
					y: hub.y + hub.height / 2
				};

				edges.push({
					id: box.node.id,
					// Upstream flows into the hub; downstream flows out of it. The direction
					// is what the travelling dots follow, so it has to be in the path itself
					// rather than applied as a reversal later.
					d: side === 'upstream' ? wire(anchor, hubAnchor) : wire(hubAnchor, anchor),
					weight: strokeFor(box.node.requestRate),
					pulseSeconds: pulseFor(box.node.requestRate)
				});
			}

			y += groupHeight(family.nodes.length) + metrics.groupGap;
		}
	}

	return { width, height, hub, columns, groups, edges };
}

/** Thicker for busier, but bounded — an unbounded scale makes one edge a slab. */
export function strokeFor(requestRate: number): number {
	return Math.min(3.4, 1 + requestRate / 260);
}

/** Faster for busier. Clamped so the dots never read as noise or as stopped. */
export function pulseFor(requestRate: number): number {
	if (requestRate <= 0) return 5;
	return Math.min(5, Math.max(1.3, 620 / requestRate));
}
