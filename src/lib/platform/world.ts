/**
 * A dot-matrix world, for locating regions.
 *
 * The map is a locator, not a chart: it carries four or five markers and nothing is
 * measured off it. That is what makes a coarse dot grid the right rendering — it reads
 * as "world" at a glance, costs no dependency, and cannot mislead anyone into taking a
 * distance off it.
 *
 * The land is stored as column spans per five-degree latitude band rather than as a
 * bitmap blob or a set of SVG paths. A reviewer can read a row and see which longitudes
 * it claims are land; nobody can read a 2,592-character mask, and a hand-authored
 * continent path is unreviewable in exactly the same way.
 *
 * It is deliberately approximate. At this resolution a cell is roughly 550 km across,
 * so coastlines are indicative and small islands are absent by design.
 */

/** Cells across (5° of longitude each) and down (5° of latitude each). */
export const WORLD_COLUMNS = 72;
export const WORLD_ROWS = 36;

/** Column index for a longitude, and row index for a latitude. */
export function worldColumn(lon: number): number {
	return Math.floor(((lon + 180) / 360) * WORLD_COLUMNS);
}

export function worldRow(lat: number): number {
	return Math.floor(((90 - lat) / 180) * WORLD_ROWS);
}

/**
 * Land as inclusive column spans, keyed by row.
 *
 * Antarctica and the Arctic ice are omitted: no region is hosted there, and a band of
 * dots along the bottom edge reads as a border rather than as land.
 */
const LAND: Record<number, Array<[number, number]>> = {
	2: [
		[12, 23],
		[25, 32],
		[46, 58]
	],
	3: [
		[4, 24],
		[25, 32],
		[38, 71]
	],
	4: [
		[3, 24],
		[26, 33],
		[37, 71]
	],
	5: [
		[3, 25],
		[26, 28],
		[31, 33],
		[37, 71]
	],
	6: [
		[3, 25],
		[34, 36],
		[37, 71]
	],
	7: [
		[10, 25],
		[34, 71]
	],
	8: [
		[11, 24],
		[35, 65]
	],
	9: [
		[11, 22],
		[34, 65]
	],
	10: [
		[11, 21],
		[34, 64]
	],
	11: [
		[12, 20],
		[34, 61],
		[62, 64]
	],
	12: [
		[12, 20],
		[33, 60]
	],
	13: [
		[14, 18],
		[32, 58]
	],
	14: [
		[15, 18],
		[32, 58],
		[60, 61]
	],
	15: [
		[17, 19],
		[32, 45],
		[50, 52],
		[55, 58],
		[60, 61]
	],
	16: [
		[19, 22],
		[33, 45],
		[55, 59],
		[60, 61]
	],
	17: [
		[20, 27],
		[34, 45],
		[55, 62]
	],
	18: [
		[20, 29],
		[37, 44],
		[55, 63]
	],
	19: [
		[20, 29],
		[38, 44],
		[56, 64]
	],
	20: [
		[21, 29],
		[38, 44],
		[60, 65]
	],
	21: [
		[21, 28],
		[38, 44],
		[44, 46],
		[59, 65]
	],
	22: [
		[22, 28],
		[38, 43],
		[44, 46],
		[58, 66]
	],
	23: [
		[21, 26],
		[39, 42],
		[58, 66]
	],
	24: [
		[21, 25],
		[39, 42],
		[59, 66]
	],
	25: [
		[21, 24],
		[63, 66],
		[69, 71]
	],
	26: [
		[21, 23],
		[69, 71]
	],
	27: [[21, 22]],
	28: [[21, 22]]
};

export interface WorldDot {
	column: number;
	row: number;
}

/**
 * Expand the spans into one dot per land cell.
 *
 * Deduplicated, because spans are allowed to abut or overlap — describing Africa and
 * Madagascar as separate ranges is clearer than splitting Africa around it — and a cell
 * is land or it is not, never land twice.
 */
export function worldDots(): WorldDot[] {
	const seen = new Set<string>();
	const dots: WorldDot[] = [];

	for (const [row, spans] of Object.entries(LAND)) {
		for (const [from, to] of spans) {
			for (let index = from; index <= to; index++) {
				const column = Math.min(index, WORLD_COLUMNS - 1);
				const key = `${column}:${row}`;
				if (seen.has(key)) continue;

				seen.add(key);
				dots.push({ column, row: Number(row) });
			}
		}
	}

	return dots;
}

/** Whether a cell is land — the same question `worldDots` answers, asked one cell at a time. */
export function isLand(column: number, row: number): boolean {
	return (LAND[row] ?? []).some(([from, to]) => column >= from && column <= to);
}
