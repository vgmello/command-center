import { env } from '$env/dynamic/private';
import type { DeploymentSource, PlatformSource, ServiceSource, WorkspaceSource } from './source';
import {
	FixtureDeploymentSource,
	FixturePlatformSource,
	FixtureServiceSource,
	FixtureWorkspaceSource
} from './fixture-source';
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

const deploymentSources: Record<string, () => DeploymentSource> = {
	fixture: () => new FixtureDeploymentSource()
};

const serviceSources: Record<string, () => ServiceSource> = {
	fixture: () => new FixtureServiceSource()
};

const workspaceSources: Record<string, () => WorkspaceSource> = {
	fixture: () => new FixtureWorkspaceSource()
};

let platform: PlatformSource | undefined;
let deployment: DeploymentSource | undefined;
let service: ServiceSource | undefined;
let workspace: WorkspaceSource | undefined;

export function platformSource(): PlatformSource {
	platform ??= resolve('PLATFORM_SOURCE', platformSources);
	return platform;
}

export function deploymentSource(): DeploymentSource {
	deployment ??= resolve('DEPLOYMENT_SOURCE', deploymentSources);
	return deployment;
}

export function serviceSource(): ServiceSource {
	service ??= resolve('SERVICE_SOURCE', serviceSources);
	return service;
}

export function workspaceSource(): WorkspaceSource {
	workspace ??= resolve('WORKSPACE_SOURCE', workspaceSources);
	return workspace;
}

function resolve<T>(variable: string, registry: Record<string, () => T>): T {
	return selectSource(variable, env[variable], registry);
}

export type { DeploymentSource, PlatformSource, ServiceSource, WorkspaceSource } from './source';
