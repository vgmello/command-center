import { describe, expect, test } from 'bun:test';
import { paginationItems } from './pagination';

describe('paginationItems', () => {
	test('lists every page when they all fit', () => {
		expect(paginationItems(1, 4)).toEqual([1, 2, 3, 4]);
	});

	test('collapses to a single page when there is nothing to page through', () => {
		expect(paginationItems(1, 1)).toEqual([1]);
		expect(paginationItems(1, 0)).toEqual([1]);
	});

	test('keeps the first and last page reachable from the middle', () => {
		expect(paginationItems(6, 12)).toEqual([1, 'ellipsis', 5, 6, 7, 'ellipsis', 12]);
	});

	test('does not emit an ellipsis that hides exactly one page', () => {
		expect(paginationItems(3, 6)).toEqual([1, 2, 3, 4, 'ellipsis', 6]);
	});

	test('clamps the window at the end of the range', () => {
		expect(paginationItems(12, 12)).toEqual([1, 'ellipsis', 10, 11, 12]);
	});
});
