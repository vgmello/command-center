/**
 * The Octopus and Coralogix mocks, as long-running servers.
 *
 * The mocks already existed, but only as functions a test starts on an ephemeral port.
 * That covers the tests and nothing else: running the app against the real adapters meant
 * hand-writing a script, which is how it never got done and why every local run has been
 * on in-process fixtures.
 *
 * Fixed ports, because a connections file has to name them. Seeded estates, because the
 * mocks are deterministic by design and a dashboard whose numbers move on restart reports
 * change that did not happen.
 *
 *   bun run mocks
 *
 * Ports and sizes are overridable so a second stack can run beside this one.
 */
import { startOctopusMock } from '../src/lib/server/sources/providers/octopus/mock/server';
import { buildEstate as octopusEstate } from '../src/lib/server/sources/providers/octopus/mock/data';
import { startCoralogixMock } from '../src/lib/server/sources/providers/coralogix/mock/server';
import { buildEstate as coralogixEstate } from '../src/lib/server/sources/providers/coralogix/mock/data';

const now = new Date();

const octopusPort = Number(Bun.env.OCTOPUS_MOCK_PORT ?? 4591);
const coralogixPort = Number(Bun.env.CORALOGIX_MOCK_PORT ?? 4592);
const apiKey = Bun.env.MOCK_API_KEY ?? 'local-dev-key';

/**
 * Deep enough that the aggregates have something to aggregate.
 *
 * 400 deployments is the window the provider pages, and 2,000 points at 60s is a little
 * over 24 hours — the longest range the store will serve from accumulated samples.
 */
const deployments = Number(Bun.env.OCTOPUS_MOCK_DEPLOYMENTS ?? 400);
const points = Number(Bun.env.CORALOGIX_MOCK_POINTS ?? 2000);

const octopus = startOctopusMock({
	estate: octopusEstate({ now, count: deployments }),
	apiKey,
	port: octopusPort
});

const coralogix = startCoralogixMock({
	estate: coralogixEstate({ now, points, stepSeconds: 60 }),
	apiKey,
	port: coralogixPort
});

console.log(`Octopus mock    ${octopus.url}   (${deployments} deployments)`);
console.log(`Coralogix mock  ${coralogix.url}   (${points} points at 60s)`);
console.log(`API key         ${apiKey}`);
console.log('\nPoint SOURCES_CONFIG at a connections file naming these. Ctrl-C to stop.');

// Bun keeps the process alive for the listening servers; this only makes the exit tidy.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		octopus.stop();
		coralogix.stop();
		process.exit(0);
	});
}
