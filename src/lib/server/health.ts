/**
 * Plain logic, no SvelteKit coupling — this is the unit `bun test` targets.
 * The remote function in `src/routes/status.remote.ts` is a thin wrapper.
 */

export type ServiceStatus = 'ok' | 'degraded' | 'down';

export interface ServiceHealth {
	name: string;
	status: ServiceStatus;
	latencyMs: number;
}

export interface SystemHealth {
	status: ServiceStatus;
	runtime: string;
	services: ServiceHealth[];
}

/**
 * The worst status present wins: any `down` sinks the system, otherwise any
 * `degraded` degrades it.
 */
export function rollUpStatus(services: ServiceHealth[]): ServiceStatus {
	if (services.some((s) => s.status === 'down')) return 'down';
	if (services.some((s) => s.status === 'degraded')) return 'degraded';
	return 'ok';
}

/** Bun sets `process.versions.bun`; Node does not. */
export function describeRuntime(): string {
	const bun = process.versions.bun;
	return bun ? `bun ${bun}` : `node ${process.versions.node} (expected bun — see CLAUDE.md)`;
}

export function buildHealth(services: ServiceHealth[]): SystemHealth {
	return {
		status: rollUpStatus(services),
		runtime: describeRuntime(),
		services
	};
}
