import { describe, expect, test } from 'bun:test';
import { WORLD_COLUMNS, WORLD_ROWS, isLand, worldColumn, worldDots, worldRow } from './world';
import { projectLatLon } from './chart';

describe('the world grid', () => {
	test('longitude spans the full width and latitude the full height', () => {
		expect(worldColumn(-180)).toBe(0);
		expect(worldColumn(179.9)).toBe(WORLD_COLUMNS - 1);
		expect(worldRow(90)).toBe(0);
		expect(worldRow(-89.9)).toBe(WORLD_ROWS - 1);
	});

	test('Greenwich and the equator land mid-grid', () => {
		expect(worldColumn(0)).toBe(WORLD_COLUMNS / 2);
		expect(worldRow(0)).toBe(WORLD_ROWS / 2);
	});

	test('every dot is inside the grid', () => {
		for (const dot of worldDots()) {
			expect(dot.column).toBeGreaterThanOrEqual(0);
			expect(dot.column).toBeLessThan(WORLD_COLUMNS);
			expect(dot.row).toBeGreaterThanOrEqual(0);
			expect(dot.row).toBeLessThan(WORLD_ROWS);
		}
	});

	test('no cell is claimed twice, so a keyed render cannot collide', () => {
		const dots = worldDots();
		const keys = dots.map((dot) => `${dot.column}:${dot.row}`);

		expect(new Set(keys).size).toBe(dots.length);
	});

	test('it draws enough to read as a world, and not so much it is a rectangle', () => {
		const count = worldDots().length;

		expect(count).toBeGreaterThan(400);
		expect(count).toBeLessThan(WORLD_COLUMNS * WORLD_ROWS * 0.5);
	});

	/*
	 * The mask is approximate by design, so these check that the well-known places a
	 * region actually sits are on land, and that the major oceans are not. A coastline
	 * cell would be a coin toss; none of these is near one.
	 */
	test('the cities the regions are named after sit on land', () => {
		const places: Array<[string, number, number]> = [
			['Dublin (eu-west-1)', 53.3, -6.3],
			['Frankfurt (eu-central-1)', 50.1, 8.7],
			['N. Virginia (us-east-1)', 38.0, -78.5],
			['Oregon (us-west-2)', 45.5, -121.0],
			['Singapore (ap-southeast-1)', 1.3, 103.8],
			['São Paulo (sa-east-1)', -23.5, -46.6],
			['Sydney (ap-southeast-2)', -33.9, 151.2]
		];

		for (const [name, lat, lon] of places) {
			expect(isLand(worldColumn(lon), worldRow(lat)), name).toBe(true);
		}
	});

	test('the open oceans are empty', () => {
		const oceans: Array<[string, number, number]> = [
			['mid Pacific', 0, -140],
			['mid Atlantic', 0, -30],
			['south Indian', -40, 80],
			['north Pacific', 40, -170]
		];

		for (const [name, lat, lon] of oceans) {
			expect(isLand(worldColumn(lon), worldRow(lat)), name).toBe(false);
		}
	});
});

describe('projectLatLon', () => {
	test('the corners of the projection are the corners of the box', () => {
		expect(projectLatLon(90, -180, 720, 360)).toEqual({ x: 0, y: 0 });
		expect(projectLatLon(-90, 180, 720, 360)).toEqual({ x: 720, y: 360 });
	});

	test('a marker lands in the same cell the grid would put it in', () => {
		const width = WORLD_COLUMNS;
		const height = WORLD_ROWS;
		const { x, y } = projectLatLon(53.3, -6.3, width, height);

		expect(Math.floor(x)).toBe(worldColumn(-6.3));
		expect(Math.floor(y)).toBe(worldRow(53.3));
	});
});
