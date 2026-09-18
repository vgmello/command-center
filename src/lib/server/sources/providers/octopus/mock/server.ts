import { buildEstate, type OctopusEstate } from './data';

/**
 * A mock Octopus server, speaking the real wire contract.
 *
 * A `Bun.serve` handler rather than a stubbed `fetch`, so the adapter's own HTTP path —
 * its auth header, its query-string building, its paging loop, its error mapping — all
 * execute for real. A double inside the client would leave exactly those parts
 * unexercised, and they are the parts that break against a live instance.
 *
 * It enforces the contract rather than merely answering it: a missing or wrong API key
 * is a 401, an unknown id is Octopus's own 404 body, and `take` is clamped the way the
 * server clamps it.
 */

/** Octopus caps a page; asking for more silently gets you this many. */
export const MAX_TAKE = 30;

const API_KEY_HEADER = 'x-octopus-apikey';

interface Paged<T> {
	Items: T[];
	ItemsPerPage: number;
	TotalResults: number;
	NumberOfPages: number;
	LastPageNumber: number;
	ItemType: string;
	Links: Record<string, string>;
}

function page<T>(all: T[], url: URL, itemType: string): Paged<T> {
	const skip = Number(url.searchParams.get('skip') ?? 0) || 0;
	const requested = Number(url.searchParams.get('take') ?? MAX_TAKE) || MAX_TAKE;
	const take = Math.min(Math.max(requested, 0), MAX_TAKE);
	const items = all.slice(skip, skip + take);
	const pages = take > 0 ? Math.ceil(all.length / take) : 0;

	return {
		Items: items,
		ItemsPerPage: take,
		TotalResults: all.length,
		NumberOfPages: pages,
		LastPageNumber: Math.max(pages - 1, 0),
		ItemType: itemType,
		Links: {}
	};
}

/** Octopus takes repeated or comma-joined values for its array parameters. */
function multi(url: URL, name: string): string[] {
	return url.searchParams
		.getAll(name)
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter(Boolean);
}

const notFound = () =>
	Response.json({ ErrorMessage: 'The resource you requested was not found.' }, { status: 404 });

/**
 * Build a request handler over one estate.
 *
 * Exported separately from the listening server so a test can exercise the routes
 * without binding a port, and so the same handler can be mounted elsewhere.
 */
export function octopusMockHandler(options: { estate?: OctopusEstate; apiKey?: string } = {}) {
	const estate = options.estate ?? buildEstate({ now: new Date() });
	const apiKey = options.apiKey ?? 'API-MOCKMOCKMOCKMOCKMOCKMOCK';
	const { spaceId } = estate;

	return function handle(request: Request): Response {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, '');

		// The root document is how a client discovers the server, and Octopus serves it
		// without a key — everything else needs one.
		if (path === '/api') {
			return Response.json({
				Application: 'Octopus Deploy',
				Version: '2026.3.15041',
				ApiVersion: '3.0.0',
				Links: { Self: '/api', Spaces: '/api/spaces{/id}' }
			});
		}

		if (request.headers.get(API_KEY_HEADER) !== apiKey) {
			return Response.json(
				{ ErrorMessage: 'You must be logged in to perform this action.' },
				{ status: 401 }
			);
		}

		const spaced = (name: string) => `/api/${spaceId}/${name}`;

		if (path === spaced('deployments')) {
			const projects = multi(url, 'projects');
			const environments = multi(url, 'environments');
			const taskState = url.searchParams.get('taskState');
			const states = new Map(estate.tasks.map((task) => [task.Id, task.State]));

			const matching = estate.deployments.filter((deployment) => {
				if (projects.length && !projects.includes(deployment.ProjectId)) return false;
				if (environments.length && !environments.includes(deployment.EnvironmentId)) return false;
				if (taskState && states.get(deployment.TaskId) !== taskState) return false;
				return true;
			});

			return Response.json(page(matching, url, 'Deployment'));
		}

		if (path.startsWith(spaced('deployments/'))) {
			const id = path.slice(spaced('deployments/').length);
			const found = estate.deployments.find((one) => one.Id === id);
			return found ? Response.json(found) : notFound();
		}

		if (path === '/api/tasks') {
			const ids = multi(url, 'ids');
			const matching = ids.length
				? estate.tasks.filter((task) => ids.includes(task.Id))
				: estate.tasks;
			return Response.json(page(matching, url, 'Task'));
		}

		if (path === spaced('releases')) {
			const ids = multi(url, 'ids');
			const matching = ids.length
				? estate.releases.filter((release) => ids.includes(release.Id))
				: estate.releases;
			return Response.json(page(matching, url, 'Release'));
		}

		if (path === spaced('projects')) {
			return Response.json(page(estate.projects, url, 'Project'));
		}

		if (path === spaced('projectgroups')) {
			return Response.json(page(estate.projectGroups, url, 'ProjectGroup'));
		}

		if (path === spaced('environments')) {
			return Response.json(page(estate.environments, url, 'Environment'));
		}

		return notFound();
	};
}

/**
 * Start a listening mock.
 *
 * `port: 0` asks the OS for a free port, so parallel test files never collide on one.
 */
export function startOctopusMock(
	options: { estate?: OctopusEstate; apiKey?: string; port?: number } = {}
) {
	const handle = octopusMockHandler(options);
	const server = Bun.serve({ port: options.port ?? 0, fetch: handle });

	return {
		url: `http://localhost:${server.port}`,
		port: server.port,
		stop: () => server.stop(true)
	};
}
