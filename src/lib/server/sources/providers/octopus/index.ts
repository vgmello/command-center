import * as v from 'valibot';
import {
	breakDownByDomain,
	deployingDomains,
	statusTrendOf,
	summariseDeployments,
	trendsOf
} from '$lib/platform/deployment-aggregates';
import { DEPLOYMENT_WINDOW_DAYS } from '$lib/platform/deployments';
import type { Deployment, EnvironmentId, TrendGrain } from '$lib/platform/types';
import { queryDeploymentsInMemory } from '../../../platform/in-memory-query';
import { defineProvider } from '../../provider';
import type { DeploymentProvider } from '../../contracts';
import type { LinkView, SourceBinding } from '../../provider';
import { OctopusClient } from './client';
import { deploymentReference, durationSeconds, environmentOf, statusOf, triggerOf } from './map';
import type { OctopusTaskState } from './map';

/**
 * The Octopus Deploy provider.
 *
 * Written against the real REST API. `baseUrl` is the only thing that differs between a
 * customer's server and the mock, and there is no branch in this file for either.
 *
 * `deployment.insights` is deliberately not declared: Octopus reports what ran, not an
 * opinion about what it means, and an insight invented here would be our editorial dressed
 * up as the upstream's. The router turns the undeclared capability into a stated gap.
 */

const environmentId = v.picklist(['production', 'staging', 'development'] as const);

export const octopusSettings = v.object({
	/** The Octopus server's root. Point it at a mock or at a real instance. */
	baseUrl: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
	apiKey: v.pipe(v.string(), v.minLength(1), v.maxLength(512)),
	spaceId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120)), 'Spaces-1'),
	/**
	 * Octopus environment id to ours, when the instance's names cannot be read.
	 *
	 * An escape hatch that has to exist: no normaliser survives contact with every
	 * customer's naming, and an operator must be able to state the answer outright.
	 */
	environments: v.optional(v.record(v.string(), environmentId), {}),
	/** How many deployments to pull for the aggregate window. */
	windowSize: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(2000)), 500)
});

export type OctopusSettings = v.InferOutput<typeof octopusSettings>;

interface OctopusDeploymentRow {
	Id: string;
	ProjectId: string;
	EnvironmentId: string;
	ReleaseId: string;
	TaskId: string;
	Created: string;
	DeployedBy?: string;
	DeployedById?: string;
}

interface OctopusTaskRow {
	Id: string;
	State: OctopusTaskState;
	StartTime?: string | null;
	CompletedTime?: string | null;
}

interface OctopusNamed {
	Id: string;
	Name: string;
	Slug?: string;
}

interface OctopusProjectRow extends OctopusNamed {
	ProjectGroupId: string;
}

interface OctopusReleaseRow {
	Id: string;
	Version: string;
}

/**
 * How long the shared window is reused across capabilities.
 *
 * Matched to the shortest TTL of anything reading it — the deployment log's thirty
 * seconds — so sharing never serves data staler than the capability that wanted it.
 */
const SHARED_WINDOW_MS = 30_000;

/** Octopus caps a page at thirty, whatever `take` asks for. */
const PAGE_SIZE = 30;

/** How far back the aggregate windows look, per trend grain. */
const TREND_DAYS: Record<TrendGrain, number> = { daily: 14, weekly: 84, monthly: 365 };

function slugOf(named: OctopusNamed | undefined, fallback: string): string {
	return named?.Slug ?? named?.Name ?? fallback;
}

export const octopusProvider = defineProvider<DeploymentProvider>({
	id: 'octopus',
	kind: 'deployment',
	name: 'Octopus Deploy',
	icon: 'rocket',
	capabilities: [
		'deployment.log',
		'deployment.summary',
		'deployment.trends',
		'deployment.statusTrend',
		'deployment.breakdown',
		'deployment.domains'
	],
	settings: octopusSettings,
	connect: (raw) => {
		// Parsed, not cast — see the note in the Coralogix provider. A cast leaves the
		// schema's defaults unapplied for any caller that is not `loadConnections`.
		const settings: OctopusSettings = v.parse(octopusSettings, raw);
		const client = new OctopusClient({
			baseUrl: settings.baseUrl,
			apiKey: settings.apiKey,
			spaceId: settings.spaceId
		});

		/**
		 * The catalogue: projects, project groups and environments.
		 *
		 * Small, slow-moving, and needed by every row — a deployment carries ids where a
		 * reader needs names. Held for the connection's lifetime behind a promise, so the
		 * three requests happen once rather than once per capability.
		 */
		let catalogue: Promise<{
			projects: Map<string, OctopusProjectRow>;
			groups: Map<string, OctopusNamed>;
			environmentNames: Map<string, string>;
		}> | null = null;

		function readCatalogue() {
			catalogue ??= (async () => {
				const [projects, groups, environments] = await Promise.all([
					client.collect<OctopusProjectRow>(client.spaced('projects'), { limit: 500 }),
					client.collect<OctopusNamed>(client.spaced('projectgroups'), { limit: 200 }),
					client.collect<OctopusNamed>(client.spaced('environments'), { limit: 200 })
				]);

				return {
					projects: new Map(projects.map((one) => [one.Id, one])),
					groups: new Map(groups.map((one) => [one.Id, one])),
					environmentNames: new Map(environments.map((one) => [one.Id, one.Name]))
				};
			})();

			return catalogue;
		}

		/** Map one page of raw rows, joining the task and release each needs. */
		async function mapRows(
			rows: OctopusDeploymentRow[],
			catalogue: Awaited<ReturnType<typeof readCatalogue>>
		): Promise<Deployment[]> {
			const { projects, groups, environmentNames } = catalogue;

			// Two batched calls for the whole page, not one pair per row. This is the
			// difference between thirty requests and two.
			const [tasks, releases] = await Promise.all([
				client.byIds<OctopusTaskRow>(
					'/api/tasks',
					rows.map((one) => one.TaskId)
				),
				client.byIds<OctopusReleaseRow>(
					client.spaced('releases'),
					rows.map((one) => one.ReleaseId)
				)
			]);

			const deployments: Deployment[] = [];

			for (const row of rows) {
				const environment = environmentOf(
					row.EnvironmentId,
					environmentNames,
					settings.environments
				);
				if (!environment) continue;

				const task = tasks.get(row.TaskId);
				const project = projects.get(row.ProjectId);
				const group = project ? groups.get(project.ProjectGroupId) : undefined;

				deployments.push({
					id: row.Id,
					reference: deploymentReference(row.Id),
					service: slugOf(project, row.ProjectId),
					version: releases.get(row.ReleaseId)?.Version ?? '—',
					// An Octopus project group is our domain. A native mapping, not a
					// placeholder: grouping projects is what project groups are for.
					domainId: project?.ProjectGroupId ?? 'ungrouped',
					domainName: group?.Name ?? 'Ungrouped',
					icon: 'rocket',
					environment: environment satisfies EnvironmentId,
					status: statusOf(task?.State),
					trigger: triggerOf(row.DeployedById),
					deployedBy: row.DeployedBy || 'Unknown',
					deployedAt: task?.StartTime ?? row.Created,
					durationSeconds: durationSeconds(
						task?.StartTime ?? undefined,
						task?.CompletedTime ?? undefined
					)
				});
			}

			return deployments;
		}

		/**
		 * Mapped deployments, paging until there are `want` of them.
		 *
		 * The loop exists because mapping *drops* rows: a deployment in an environment
		 * this connection cannot place is omitted rather than guessed. Fetching exactly
		 * `want` raw rows and filtering afterwards would quietly return fewer than asked
		 * for — nine rows for a page of ten — and a short page reads as "that is all there
		 * is" rather than as "some were skipped".
		 *
		 * `scan` bounds the work so an instance whose environments mostly do not map
		 * cannot turn one panel into an unbounded walk of its whole history.
		 */
		/**
		 * The full window, fetched once for however many capabilities want it.
		 *
		 * Six of them do — the log, the summary, the domain breakdown, the status trend,
		 * the trends and the deploying domains — and each is a separate capability with its
		 * own cache entry, so each was independently paging the same four hundred
		 * deployments. Drawing one page cost 216 requests; sharing the window makes it 36.
		 *
		 * The cache above cannot solve this: it keys on capability, and these are six
		 * different capabilities that happen to be computed from one fetch. Only the
		 * provider knows they share an origin, so only the provider can say so.
		 *
		 * A short TTL rather than a permanent memo. The client lives as long as the
		 * connection, and a deployment log that never refreshed would be worse than one
		 * that costs a few requests.
		 */
		let shared: { at: number; window: Promise<Deployment[]> } | null = null;

		function loadSharedWindow(): Promise<Deployment[]> {
			const now = Date.now();

			if (!shared || now - shared.at > SHARED_WINDOW_MS) {
				shared = { at: now, window: loadWindow(settings.windowSize) };
			}

			return shared.window;
		}

		/** Whether the shared window is already loaded or on its way. */
		function sharedIsWarm(): boolean {
			return shared !== null && Date.now() - shared.at <= SHARED_WINDOW_MS;
		}

		async function loadWindow(want: number, scan = settings.windowSize): Promise<Deployment[]> {
			const catalogue = await readCatalogue();
			const mapped: Deployment[] = [];
			let skip = 0;

			while (mapped.length < want && skip < scan) {
				const take = Math.min(PAGE_SIZE, scan - skip);
				const body = await client.get<{ Items: OctopusDeploymentRow[]; TotalResults: number }>(
					client.spaced('deployments'),
					{ skip, take }
				);

				if (body.Items.length === 0) break;

				mapped.push(...(await mapRows(body.Items, catalogue)));
				skip += body.Items.length;

				if (skip >= body.TotalResults) break;
			}

			return mapped.slice(0, want);
		}

		/** Rows inside a window, and the equal window before it, for the change figures. */
		async function loadComparable(days: number, now: Date) {
			const all = await loadSharedWindow();
			const start = new Date(now.getTime() - days * 86_400_000);
			const previousStart = new Date(start.getTime() - days * 86_400_000);

			const at = (one: Deployment) => new Date(one.deployedAt).getTime();

			return {
				current: all.filter((one) => at(one) >= start.getTime()),
				previous: all.filter(
					(one) => at(one) >= previousStart.getTime() && at(one) < start.getTime()
				),
				all
			};
		}

		return {
			async queryDeployments(_ctx, query) {
				// Octopus can filter by project, environment and task state, but not by our
				// search, window or domain semantics. Fetching the window and querying it
				// here keeps one definition of what a filter means across every adapter —
				// the in-memory strategy the fixture source already uses.
				const all = await loadSharedWindow();
				return queryDeploymentsInMemory(all, query, new Date());
			},

			async listDeployments(_ctx, limit) {
				// The shared window when something else already paid for it — the overview's
				// recent feed then costs nothing. Otherwise a narrow walk: fetching four
				// hundred deployments to show eight would be a worse trade than the one
				// sharing exists to make.
				if (sharedIsWarm()) return (await loadSharedWindow()).slice(0, limit);

				return loadWindow(limit);
			},

			async readSummary() {
				const now = new Date();
				const { current, previous } = await loadComparable(
					DEPLOYMENT_WINDOW_DAYS['30d'] ?? 30,
					now
				);
				return summariseDeployments(current, previous);
			},

			async readDomainBreakdown() {
				const { current } = await loadComparable(DEPLOYMENT_WINDOW_DAYS['30d'] ?? 30, new Date());
				return breakDownByDomain(current);
			},

			async readStatusTrend() {
				const now = new Date();
				const from = new Date(now.getTime() - TREND_DAYS.daily * 86_400_000);
				const { current } = await loadComparable(TREND_DAYS.daily, now);
				return statusTrendOf(current, 'daily', from, now);
			},

			async readTrends(_ctx, grain) {
				const now = new Date();
				const days = TREND_DAYS[grain];
				const from = new Date(now.getTime() - days * 86_400_000);
				const { current } = await loadComparable(days, now);
				return trendsOf(current, grain, from, now);
			},

			async listDeployingDomains() {
				const { current } = await loadComparable(DEPLOYMENT_WINDOW_DAYS['30d'] ?? 30, new Date());
				return deployingDomains(current);
			},

			/**
			 * A link into Octopus's own UI.
			 *
			 * The task page rather than the deployment page for a log view, because that is
			 * where an operator chasing a failure actually wants to land.
			 */
			resourceLink(binding: SourceBinding | undefined, view: LinkView) {
				if (!binding) return null;

				const base = `${client.baseUrl}/app#/${client.spaceId}`;
				const href =
					view === 'logs'
						? `${base}/tasks/${binding.externalId}`
						: `${base}/deployments/${binding.externalId}`;

				return { label: 'Show in Octopus', href };
			}
		};
	}
});
