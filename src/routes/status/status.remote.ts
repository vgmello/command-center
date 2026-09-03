import * as v from 'valibot';
import { query } from '$app/server';
import { buildHealth, type ServiceHealth } from '$lib/server/health';

/**
 * Stand-in for real probes. Replace with actual checks as services land.
 */
async function probe(name: string): Promise<ServiceHealth> {
	const started = performance.now();
	await Promise.resolve();

	return { name, status: 'ok', latencyMs: Math.round(performance.now() - started) };
}

export const getHealth = query(async () => {
	const services = await Promise.all(['database', 'cache', 'queue'].map(probe));
	return buildHealth(services);
});

/**
 * `query.batch` rather than `query`: called once per row in the services list,
 * these collapse into a single request instead of one per service.
 */
export const getServiceDetail = query.batch(v.string(), async (names) => {
	const details = await Promise.all(names.map(probe));
	const byName = new Map(details.map((d) => [d.name, d]));

	return (name: string) => byName.get(name);
});
