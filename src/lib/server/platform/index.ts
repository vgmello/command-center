import { env } from '$env/dynamic/private';
import { catalogSource } from '../catalog';
import { PostgresSourceStore } from '../store/postgres-store';
import { ConnectionLimits } from '../sources/rate-limit';
import { buildSources, readSourceConfig } from '../sources/boot';
import { FixturePlatformSource, FixtureWorkspaceSource } from './fixture-source';
import { selectSource } from './select-source';
import type {
	DeploymentSource,
	InfrastructureSource,
	PlatformSource,
	ServiceSource,
	WorkspaceSource
} from './source';

/**
 * Resolves which implementations the app runs against.
 *
 * Every read now goes through a router, whatever is configured. With `SOURCES_CONFIG`
 * unset the routers dispatch to fixture providers and the app behaves exactly as it did
 * — but the routed path is the only path, so it cannot rot while nobody is looking.
 *
 * The catalog half — which domains and services exist — is still served by the fixture
 * implementations, because that is app-owned data and no data source knows it. It is
 * what a real database will replace, separately from any of this.
 *
 * Read once at module load with a top-level `await`, so the port accessors below stay
 * plain and synchronous — every caller and every test expects that. The alternative is a
 * lazy `Proxy` that resolves on first use; a synchronous boot is simpler to reason about
 * and the config is only ever read once, so there is nothing to gain by deferring it.
 */
/**
 * Where answers outlive the process, when a database is configured.
 *
 * Unset means memory only — correct, and simply asking the upstream far more often. A
 * deployment with no database still works, which is why this is a null rather than a
 * refusal to start.
 */
const store = env.DATABASE_URL ? new PostgresSourceStore(env.DATABASE_URL) : null;

/**
 * What bounds how often the sources may be asked.
 *
 * Caching lowers how often we ask; it does not cap it. Eight instances starting cold
 * after a deploy miss on everything at once, so the limiter is what makes exceeding a
 * documented rate limit impossible rather than merely unlikely. The default is
 * deliberately modest — the APIs behind these ports have low limits, and a connection
 * that can afford more should say so.
 */
const limits = new ConnectionLimits({
	perSecond: Number(env.SOURCE_RATE_PER_SECOND ?? 5),
	burst: Number(env.SOURCE_RATE_BURST ?? 10)
});

const routers = buildSources({
	config: await readSourceConfig(env.SOURCES_CONFIG),
	env,
	catalog: { platform: new FixturePlatformSource(), services: catalogSource() },
	store,
	limits
});

export function platformSource(): PlatformSource {
	return routers.platform;
}

export function deploymentSource(): DeploymentSource {
	return routers.deployment;
}

export function serviceSource(): ServiceSource {
	return routers.service;
}

export function infrastructureSource(): InfrastructureSource {
	return routers.infrastructure;
}

const workspaceSources: Record<string, () => WorkspaceSource> = {
	fixture: () => new FixtureWorkspaceSource()
};

let workspace: WorkspaceSource | undefined;

export function workspaceSource(): WorkspaceSource {
	workspace ??= resolve('WORKSPACE_SOURCE', workspaceSources);
	return workspace;
}

function resolve<T>(variable: string, registry: Record<string, () => T>): T {
	return selectSource(variable, env[variable], registry);
}

export type {
	DeploymentSource,
	InfrastructureSource,
	PlatformSource,
	ServiceSource,
	WorkspaceSource
} from './source';
