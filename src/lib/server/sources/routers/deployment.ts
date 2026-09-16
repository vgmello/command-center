import type { DeploymentSource } from '../../platform/source';
import type { DeploymentProvider } from '../contracts';
import { estateTrendsOf } from '$lib/platform/domain-deployments';
import { fanOut, fanOutSeries, fanOutSingle, type RouterDeps } from './shared';
import {
	TREND_DAYS,
	serviceTrendsShape,
	statusTrendShape,
	trendsShape
} from './deployment-series-shape';

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

		/**
		 * The estate's trends — summed from the per-service rows, wherever they exist.
		 *
		 * They used to be their own accumulation: a separate window fetch, stored under
		 * `deployment.trends` against the one entity `''`, describing exactly the runs the
		 * per-service rows already describe. Two accumulations of one set of facts is two
		 * things that can disagree, and under the fixtures they did — the estate trend was
		 * a seeded curve around today's count while the per-service rows were the log.
		 *
		 * So the estate figure is now the sum over every entity, which is what
		 * `estateTrendsOf` does to what `readServiceTrends` rebuilt. `estate ==
		 * sum(services)` is true by construction rather than by coincidence, and the two
		 * reads share one set of stored samples instead of paying for a window each.
		 *
		 * The fallback below is not dead code. A provider is entitled to collapse — to
		 * report what the estate did without saying which service did it — and one that
		 * declares `deployment.trends` alone still draws the deployments page from its own
		 * estate answer, stored against `''` as before.
		 */
		readTrends: async (scope, grain) => {
			if (deps.registry.supporting('deployment.serviceTrends').length > 0) {
				return estateTrendsOf(await source.readServiceTrends(scope, grain));
			}

			return fanOutSeries(
				deps,
				'deployment.trends',
				scope,
				// No grain in the args: that is the point. One set of daily samples serves
				// all three, and keying on the grain is what stopped them sharing.
				'',
				trendsShape(grain),
				(client, ctx) => (client as DeploymentProvider).readTrends!(ctx, grain),
				TREND_DAYS[grain] * 86_400
			);
		},

		readServiceTrends: (scope, grain) =>
			fanOutSeries(
				deps,
				'deployment.serviceTrends',
				scope,
				// No grain in the args, for the same reason `readTrends` omits it: one set of
				// daily samples serves all three grains, and keying on the grain is what stops
				// them sharing.
				'',
				serviceTrendsShape(grain),
				(client, ctx) => (client as DeploymentProvider).readServiceTrends!(ctx, grain),
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
