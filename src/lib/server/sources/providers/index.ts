import type { ProviderDefinition } from '../provider';
import { coralogixProvider } from './coralogix';
import { octopusProvider } from './octopus';

/**
 * The providers a real connections file may name.
 *
 * Deliberately separate from `FIXTURE_PROVIDERS`: the fixtures are registered only when
 * there is no configuration at all, so a production file naming `fixture-cloud` is
 * refused rather than quietly serving seeded numbers. These are the ones that talk to
 * something.
 */
export const REAL_PROVIDERS: readonly ProviderDefinition<unknown>[] = [
	octopusProvider as ProviderDefinition<unknown>,
	coralogixProvider as ProviderDefinition<unknown>
];

export { coralogixProvider, octopusProvider };
