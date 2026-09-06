import type { DeploymentSource } from '../../platform/source';
import type { DeploymentProvider } from '../contracts';
import { fanOut, fanOutSeries, fanOutSingle, type RouterDeps } from './shared';
import { TREND_DAYS, statusTrendShape, trendsShape } from './deployment-series-shape';

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

		// Accumulated rather than cached, so the three grains read the same stored rows. As
		// documents they keyed on the grain, and switching from daily to weekly paid for a
		// fresh four-hundred-row window to see the same runs counted differently.
		readStatusTrend: (scope) =>
			fanOutSeries(
				deps,
				'deployment.statusTrend',
				scope,
				'',
				statusTrendShape(),
				(client, ctx) => (client as DeploymentProvider).readStatusTrend!(ctx),
				TREND_DAYS.daily * 86_400
			),

		readTrends: (scope, grain) =>
			fanOutSeries(
				deps,
				'deployment.trends',
				scope,
				// No grain in the args: that is the point. One set of daily samples serves
				// all three, and keying on the grain is what stopped them sharing.
				'',
				trendsShape(grain),
				(client, ctx) => (client as DeploymentProvider).readTrends!(ctx, grain),
				TREND_DAYS[grain] * 86_400
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
