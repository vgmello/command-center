import * as v from 'valibot';
import * as log from '../../platform/fixtures';
import { queryDeploymentsInMemory } from '../../platform/in-memory-query';
import { defineProvider } from '../provider';
import type { DeploymentProvider } from '../contracts';
import type { LinkView, SourceBinding } from '../provider';

export const fixtureDeploymentProvider = defineProvider<DeploymentProvider>({
	id: 'fixture-deployment',
	kind: 'deployment',
	name: 'Fixture Deployments',
	icon: 'rocket',
	capabilities: [
		'deployment.log',
		'deployment.summary',
		'deployment.trends',
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
