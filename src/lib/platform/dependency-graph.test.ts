import { describe, expect, test } from 'bun:test';
import { GRAPH_METRICS, layoutDependencyGraph, pulseFor, strokeFor } from './dependency-graph';
import type { DependencyKind, DomainDependencyNode } from './types';

/**
 * The graph's arithmetic.
 *
 * Testable at all because the layout is computed rather than measured: the reference this
 * was built from walked `offsetParent` after rendering, which cannot be asserted on, has to
 * be redone on every resize and font load, and draws its wires a frame behind the boxes.
 */

function node(id: string, kind: DependencyKind, requestRate = 100): DomainDependencyNode {
	return {
		id,
		name: id,
		status: 'healthy',
		kind,
		icon: 'box',
		requestRate,
		latencyMs: 10,
		errorRatePct: 0,
		role: 'x'
	};
}

describe('laying out the graph', () => {
	test('upstream sits left of the hub and downstream right of it', () => {
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service')],
			downstream: [node('b', 'service')]
		});

		const left = layout.groups.find((one) => one.side === 'upstream')!.nodes[0];
		const right = layout.groups.find((one) => one.side === 'downstream')!.nodes[0];

		expect(left.x).toBeLessThan(layout.hub.x);
		expect(right.x).toBeGreaterThan(layout.hub.x + layout.hub.width);
	});

	test('families are grouped and empty ones are not drawn', () => {
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service'), node('b', 'datastore'), node('c', 'service')],
			downstream: []
		});

		expect(layout.groups.map((one) => one.kind)).toEqual(['service', 'datastore']);
		expect(layout.groups[0].nodes).toHaveLength(2);
	});

	test('the hub is centred against the taller column, not against one side', () => {
		// Otherwise a domain with five upstreams and one downstream draws its hub level
		// with the single box, and every wire on the left rakes across the picture.
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service'), node('b', 'service'), node('c', 'service')],
			downstream: [node('d', 'service')]
		});

		expect(layout.hub.y + layout.hub.height / 2).toBeCloseTo(layout.height / 2, 6);
	});

	test('nodes within a family do not overlap', () => {
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service'), node('b', 'service'), node('c', 'service')],
			downstream: []
		});

		const [first, second] = layout.groups[0].nodes;
		expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
	});

	test('families do not overlap each other', () => {
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service'), node('b', 'datastore')],
			downstream: []
		});

		const [services, stores] = layout.groups;
		const bottom = services.nodes.at(-1)!;

		expect(stores.header.y).toBeGreaterThanOrEqual(bottom.y + bottom.height);
	});

	test('every node gets exactly one wire', () => {
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service'), node('b', 'queue')],
			downstream: [node('c', 'external')]
		});

		expect(layout.edges.map((one) => one.id).sort()).toEqual(['a', 'b', 'c']);
	});

	test('an upstream wire runs into the hub and a downstream one out of it', () => {
		// The travelling dots follow the path, so the direction has to be in the geometry
		// rather than reversed afterwards.
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service')],
			downstream: [node('b', 'service')]
		});

		const startX = (d: string) => Number(d.slice(1, d.indexOf(',')));
		const inbound = layout.edges.find((one) => one.id === 'a')!;
		const outbound = layout.edges.find((one) => one.id === 'b')!;

		expect(startX(inbound.d)).toBeLessThan(layout.hub.x);
		expect(startX(outbound.d)).toBeGreaterThanOrEqual(layout.hub.x);
	});

	test('the canvas is tall enough for the tallest column', () => {
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service'), node('b', 'service'), node('c', 'service')],
			downstream: []
		});

		const lowest = Math.max(...layout.groups.flatMap((g) => g.nodes.map((n) => n.y + n.height)));
		expect(layout.height).toBeGreaterThanOrEqual(lowest);
	});

	test('a domain with no dependencies still leaves room for its hub', () => {
		const layout = layoutDependencyGraph({ upstream: [], downstream: [] });

		expect(layout.groups).toHaveLength(0);
		expect(layout.edges).toHaveLength(0);
		expect(layout.height).toBeGreaterThanOrEqual(GRAPH_METRICS.hubHeight);
	});
});

describe('how throughput reads', () => {
	test('a busier edge is drawn thicker, up to a ceiling', () => {
		expect(strokeFor(500)).toBeGreaterThan(strokeFor(50));
		// Unbounded, one busy edge becomes a slab across the picture.
		expect(strokeFor(100_000)).toBeLessThanOrEqual(3.4);
	});

	test('a busier edge pulses faster, within bounds a reader can follow', () => {
		expect(pulseFor(500)).toBeLessThan(pulseFor(50));
		expect(pulseFor(100_000)).toBeGreaterThanOrEqual(1.3);
		expect(pulseFor(1)).toBeLessThanOrEqual(5);
	});

	test('a silent edge does not divide by zero', () => {
		expect(Number.isFinite(pulseFor(0))).toBe(true);
	});
});

describe('which way the wires run', () => {
	test('each populated column says what it is', () => {
		// Both sides can hold the same family, so without a caption a reader sees "Internal
		// domains" twice and nothing saying which of them calls which.
		const layout = layoutDependencyGraph({
			upstream: [node('a', 'service')],
			downstream: [node('b', 'service')]
		});

		expect(layout.columns.map((one) => one.side)).toEqual(['upstream', 'downstream']);
		expect(new Set(layout.columns.map((one) => one.label)).size).toBe(2);
	});

	test('an empty side gets no caption, rather than a heading over nothing', () => {
		const layout = layoutDependencyGraph({ upstream: [node('a', 'service')], downstream: [] });

		expect(layout.columns.map((one) => one.side)).toEqual(['upstream']);
	});

	test('the caption sits above its first family and never overlaps it', () => {
		const layout = layoutDependencyGraph({ upstream: [node('a', 'service')], downstream: [] });
		const caption = layout.columns[0].box;

		expect(caption.y + caption.height).toBeLessThanOrEqual(layout.groups[0].header.y);
	});
});
