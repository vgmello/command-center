import { fixtureApmProvider } from './apm';
import { fixtureCloudProvider } from './cloud';
import { fixtureDeploymentProvider } from './deployment';
import type { ProviderDefinition } from '../provider';

export { fixtureApmProvider, fixtureCloudProvider, fixtureDeploymentProvider };

export const FIXTURE_PROVIDERS: ProviderDefinition<unknown>[] = [
	fixtureCloudProvider as ProviderDefinition<unknown>,
	fixtureApmProvider as ProviderDefinition<unknown>,
	fixtureDeploymentProvider as ProviderDefinition<unknown>
];

/**
 * A ready-made configuration connecting one of each.
 *
 * Used by the router tests and by the resolver when `SOURCES_CONFIG` is unset, so the
 * routed path can be exercised without anyone writing a config file.
 */
export const FIXTURE_CONNECTIONS = {
	connections: [
		{ id: 'fixture-cloud', provider: 'fixture-cloud', label: 'Fixture Cloud', settings: {} },
		{ id: 'fixture-apm', provider: 'fixture-apm', label: 'Fixture APM', settings: {} },
		{
			id: 'fixture-deployment',
			provider: 'fixture-deployment',
			label: 'Fixture Deployments',
			settings: {}
		}
	]
};
