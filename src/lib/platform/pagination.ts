/** A rendered pagination slot: a page number, or a gap standing in for several. */
export type PaginationItem = number | 'ellipsis';

/**
 * Compact page list: always the first and last page, a window around the current
 * one, and an ellipsis wherever pages were skipped.
 *
 * Kept pure and separate from the component so the edge cases — first page, last
 * page, fewer pages than the window — are testable without rendering anything.
 */
export function paginationItems(
	currentPage: number,
	totalPages: number,
	windowSize = 3
): PaginationItem[] {
	if (totalPages <= 1) return [1];
	if (totalPages <= windowSize + 2) {
		return Array.from({ length: totalPages }, (_, index) => index + 1);
	}

	const half = Math.floor(windowSize / 2);
	let start = Math.max(1, currentPage - half);
	const end = Math.min(totalPages, start + windowSize - 1);
	start = Math.max(1, end - windowSize + 1);

	const items: PaginationItem[] = [];

	if (start > 1) {
		items.push(1);
		if (start > 2) items.push('ellipsis');
	}

	for (let page = start; page <= end; page++) items.push(page);

	if (end < totalPages) {
		if (end < totalPages - 1) items.push('ellipsis');
		items.push(totalPages);
	}

	return items;
}
