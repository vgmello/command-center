import * as v from 'valibot';
import * as estate from '../../platform/infrastructure-fixtures';
import { defineProvider } from '../provider';
import type { CloudProvider } from '../contracts';
import type { LinkView, SourceBinding } from '../provider';

/**
 * The seeded estate, behind the cloud contract.
 *
 * It wraps the existing fixture functions rather than restating them: those numbers are
 * already asserted by `infrastructure-view.test.ts`, and a second copy would be a second
 * thing to keep in step.
 */
export const fixtureCloudProvider = defineProvider<CloudProvider>({
	id: 'fixture-cloud',
	kind: 'cloud',
	name: 'Fixture Cloud',
	icon: 'cloud',
	capabilities: [
		'cloud.regions',
		'cloud.nodes',
		'cloud.clusters',
		'cloud.utilization',
		'cloud.storage',
		'cloud.databases',
		'cloud.queues',
		'cloud.alerts',
		'cloud.cost'
	],
	settings: v.object({}),
	connect: () => ({
		async listRegions() {
			return estate.listRegions();
		},
		async readNodeCounts() {
			return estate.readNodeCounts();
		},
		async listClusters(_ctx, limit) {
			return estate.listClusters(limit);
		},
		async readUtilization() {
			return estate.readUtilization(new Date());
		},
		async readStorage() {
			return estate.readStorage();
		},
		async listDatabases(_ctx, limit) {
			return estate.listDatabases(limit);
		},
		async listQueues(_ctx, limit) {
			return estate.listQueues(limit);
		},
		async listAlerts(_ctx, limit) {
			return estate.listAlerts(new Date(), limit);
		},
		async readCost() {
			return estate.readCost(new Date());
		},
		resourceLink(binding: SourceBinding | undefined, view: LinkView) {
			// A link needs a resource to point at. Without a binding there is nothing to
			// open, and offering a link to the console's front page would be a dead end.
			if (!binding) return null;
			return {
				label: 'Show in Fixture Cloud',
				href: `https://fixture.invalid/${binding.externalId}/${view}`
			};
		}
	})
});
