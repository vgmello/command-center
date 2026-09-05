import type { DeploymentSource } from '../../platform/source';
import type { DeploymentProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

/** `DeploymentSource` has no catalog side: every method is a deployment source's answer. */
export function createDeploymentRouter(deps: RouterDeps): DeploymentSource {
	const source: DeploymentSource = {
		id: 'routed-deployment',

		queryDeployments: (scope, query) =>
			fanOutSingle(deps, 'deployment.log', scope, JSON.stringify(query), (client, ctx) =>
				(client as DeploymentProvider).queryDeployments!(ctx, query)
			),

		listDeployments: (scope, limit) =>
			fanOut(deps, 'deployment.log', scope, `recent=${limit}`, (client, ctx) =>
				(client as DeploymentProvider).listDeployments!(ctx, limit)
			),

		readSummary: (scope) =>
			fanOutSingle(deps, 'deployment.summary', scope, '', (client, ctx) =>
				(client as DeploymentProvider).readSummary!(ctx)
			),

		readDomainBreakdown: (scope) =>
			fanOutSingle(deps, 'deployment.breakdown', scope, '', (client, ctx) =>
				(client as DeploymentProvider).readDomainBreakdown!(ctx)
			),

		readStatusTrend: (scope) =>
			fanOut(deps, 'deployment.statusTrend', scope, '', (client, ctx) =>
				(client as DeploymentProvider).readStatusTrend!(ctx)
			),

		readTrends: (scope, grain) =>
			fanOutSingle(deps, 'deployment.trends', scope, `grain=${grain}`, (client, ctx) =>
				(client as DeploymentProvider).readTrends!(ctx, grain)
			),

		listInsights: (scope) =>
			fanOut(deps, 'deployment.insights', scope, '', (client, ctx) =>
				(client as DeploymentProvider).listInsights!(ctx)
			),

		listDeployingDomains: (scope) =>
			fanOut(deps, 'deployment.domains', scope, '', (client, ctx) =>
				(client as DeploymentProvider).listDeployingDomains!(ctx)
			)
	};

	return source;
}
