import * as v from 'valibot';
import { serviceTrendsOf, trendsOf } from '$lib/platform/deployment-aggregates';
import type { TrendGrain } from '$lib/platform/types';
import * as log from '../../platform/fixtures';
import { queryDeploymentsInMemory } from '../../platform/in-memory-query';
import { defineProvider } from '../provider';
import type { DeploymentProvider } from '../contracts';
import type { LinkView, SourceBinding } from '../provider';

/**
 * How far back the aggregate windows look, per trend grain.
 *
 * Mirrors the Octopus provider's own constant of the same name — see
 * `src/lib/server/sources/providers/octopus/index.ts`. Duplicated deliberately: a
 * provider sits beneath the routers, so it must not reach up into
 * `deployment-series-shape.ts`'s copy of this value.
 */
const TREND_DAYS: Record<TrendGrain, number> = { daily: 14, weekly: 84, monthly: 365 };

/** The start of the window a grain looks back over. */
function windowStart(now: Date, grain: TrendGrain): Date {
	return new Date(now.getTime() - TREND_DAYS[grain] * 86_400_000);
}

export const fixtureDeploymentProvider = defineProvider<DeploymentProvider>({
	id: 'fixture-deployment',
	synthetic: true,
	kind: 'deployment',
	name: 'Fixture Deployments',
	icon: 'rocket',
	capabilities: [
		'deployment.log',
		'deployment.summary',
		'deployment.trends',
		'deployment.serviceTrends',
		'deployment.statusTrend',
		'deployment.breakdown',
		'deployment.insights',
		'deployment.domains'
	],
	settings: v.object({}),
	connect: () => ({
		async queryDeployments(_ctx, query) {
			return queryDeploymentsInMemory(log.listDeployments(new Date()), query, new Date());
		},
		async listDeployments(_ctx, limit) {
			return log.listDeployments(new Date()).slice(0, limit);
		},
		async readSummary() {
			return log.readDeploymentSummary(new Date());
		},
		async readDomainBreakdown() {
			return log.readDeploymentBreakdown(new Date());
		},
		async readStatusTrend() {
			return log.buildStatusTrend(new Date());
		},
		// Both trends come off the same rows, on purpose. `readTrends` used to synthesise a
		// seeded curve around today's count while `readServiceTrends` bucketed the log, so
		// the estate said it had shipped 186 times and its services said 32 — two stories
		// about one quantity, which is the thing a fixture must never do.
		async readTrends(_ctx, grain) {
			const now = new Date();
			return trendsOf(log.listDeployments(now), grain, windowStart(now, grain), now);
		},
		async readServiceTrends(_ctx, grain) {
			const now = new Date();
			return serviceTrendsOf(log.listDeployments(now), grain, windowStart(now, grain), now);
		},
		async listInsights() {
			return log.listDeploymentInsights(new Date());
		},
		async listDeployingDomains() {
			return log.listDeployingDomains(new Date());
		},
		resourceLink(binding: SourceBinding | undefined, view: LinkView) {
			if (!binding) return null;
			return {
				label: 'Show in Fixture Deployments',
				href: `https://fixture.invalid/deploy/${binding.externalId}/${view}`
			};
		}
	})
});
