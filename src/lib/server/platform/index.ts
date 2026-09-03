import { env } from '$env/dynamic/private';
import type { PlatformSource, WorkspaceSource } from './source';
import { FixturePlatformSource, FixtureWorkspaceSource } from './fixture-source';
import { selectSource } from './select-source';

/**
 * Resolves which implementation the app runs against.
 *
 * One place decides, and it decides from configuration rather than from an import —
 * so adding a real backend is a new file plus a case here, and no consumer learns
 * about it. `$env/dynamic/private` rather than `process.env`, and private rather
 * than public: a source URL and its credentials must never reach the client bundle.
 *
 * Instances are created once and reused. A real adapter will hold a connection pool
 * or an HTTP client, and building one per request is how you exhaust both.
 */

const platformSources: Record<string, () => PlatformSource> = {
	fixture: () => new FixturePlatformSource()
};

const workspaceSources: Record<string, () => WorkspaceSource> = {
	fixture: () => new FixtureWorkspaceSource()
};

let platform: PlatformSource | undefined;
let workspace: WorkspaceSource | undefined;

export function platformSource(): PlatformSource {
	platform ??= resolve('PLATFORM_SOURCE', platformSources);
	return platform;
}

export function workspaceSource(): WorkspaceSource {
	workspace ??= resolve('WORKSPACE_SOURCE', workspaceSources);
	return workspace;
}

function resolve<T>(variable: string, registry: Record<string, () => T>): T {
	return selectSource(variable, env[variable], registry);
}

export type { PlatformSource, WorkspaceSource } from './source';
