import * as v from 'valibot';
import { serviceTrendsOf } from '$lib/platform/deployment-aggregates';
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
		async readTrends(_ctx, grain) {
			return log.buildDeploymentTrends(new Date(), grain);
		},
		async readServiceTrends(_ctx, grain) {
			const now = new Date();
			const from = new Date(now.getTime() - TREND_DAYS[grain] * 86_400_000);
			return serviceTrendsOf(log.listDeployments(now), grain, from, now);
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
