import { describe, expect, test } from 'bun:test';
import { startCostMock } from './cost';

/**
 * The one Azure surface floci-az does not emulate.
 *
 * Without it `cloud.cost` is untestable locally, so the mock is not a convenience — it is
 * the difference between eight capabilities being exercisable and nine.
 *
 * It answers the real contract: a POST to the scope's query endpoint returning
 * `{ properties: { columns, rows } }`, with `UsageDate` as a `yyyyMMdd` integer, because a
 * mock that invents its own shape tests the mock rather than the adapter.
 */

const SCOPE = '/subscriptions/00000000-0000-0000-0000-000000000000';

function query(url: string, body: unknown, apiKey = 'k') {
	return fetch(`${url}${SCOPE}/providers/Microsoft.CostManagement/query?api-version=2021-10-01`, {
		method: 'POST',
		headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

const USAGE = {
	type: 'Usage',
	timeframe: 'MonthToDate',
	dataset: {
		granularity: 'Daily',
		aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
		grouping: [{ type: 'Dimension', name: 'ServiceName' }]
	}
};

describe('the Cost Management mock', () => {
	test('answers a month-to-date usage query with daily rows per service', async () => {
		const mock = startCostMock({ apiKey: 'k', now: new Date('2026-09-06T00:00:00Z') });

		try {
			const response = await query(mock.url, USAGE);
			expect(response.status).toBe(200);

			const body = (await response.json()) as {
				properties: { columns: Array<{ name: string }>; rows: unknown[][] };
			};

			expect(body.properties.columns.map((one) => one.name)).toEqual([
				'Cost',
				'UsageDate',
				'ServiceName',
				'Currency'
			]);
			expect(body.properties.rows.length).toBeGreaterThan(0);
		} finally {
			mock.stop();
		}
	});

	test('UsageDate is a yyyyMMdd integer, which is what the real API returns', async () => {
		// Not an ISO string. An adapter that parsed it as one would produce an invalid date
		// and a chart with no columns, and would pass against a mock that used ISO.
		const mock = startCostMock({ apiKey: 'k', now: new Date('2026-09-06T00:00:00Z') });

		try {
			const body = (await (await query(mock.url, USAGE)).json()) as {
				properties: { rows: [number, number, string, string][] };
			};

			for (const [, usageDate] of body.properties.rows) {
				expect(Number.isInteger(usageDate)).toBe(true);
				expect(String(usageDate)).toMatch(/^2026(09)(0[1-6])$/);
			}
		} finally {
			mock.stop();
		}
	});

	test('month-to-date stops at today rather than filling the whole month', async () => {
		// A full month of columns on the sixth would be a fiction, and the fixture estate
		// already refuses to draw one.
		const mock = startCostMock({ apiKey: 'k', now: new Date('2026-09-06T00:00:00Z') });

		try {
			const body = (await (await query(mock.url, USAGE)).json()) as {
				properties: { rows: [number, number, string, string][] };
			};
			const days = new Set(body.properties.rows.map(([, usageDate]) => usageDate));

			expect(days.size).toBe(6);
		} finally {
			mock.stop();
		}
	});

	test('the same day and service always reports the same cost', async () => {
		// Seeded, like every other fixture here: spend that moved on every refresh would
		// report change that did not happen.
		const mock = startCostMock({ apiKey: 'k', now: new Date('2026-09-06T00:00:00Z') });

		try {
			const first = (await (await query(mock.url, USAGE)).json()) as {
				properties: { rows: unknown[][] };
			};
			const second = (await (await query(mock.url, USAGE)).json()) as {
				properties: { rows: unknown[][] };
			};

			expect(first.properties.rows).toEqual(second.properties.rows);
		} finally {
			mock.stop();
		}
	});

	test('refuses a request with no bearer token', async () => {
		const mock = startCostMock({ apiKey: 'k', now: new Date() });

		try {
			const response = await fetch(`${mock.url}${SCOPE}/providers/Microsoft.CostManagement/query`, {
				method: 'POST',
				body: '{}'
			});

			expect(response.status).toBe(401);
		} finally {
			mock.stop();
		}
	});
});
