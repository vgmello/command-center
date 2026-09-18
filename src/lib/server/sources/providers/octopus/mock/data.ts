import { hashSeed, seededRandom } from '../../../../platform/series';
import type { OctopusTaskState } from '../map';

/**
 * Seeded, Octopus-shaped stand-in data.
 *
 * Deliberately *not* derived from the app's own fixtures. This is what an Octopus server
 * holds — project groups, projects with slugs, environments named the way an instance
 * names them, releases with real version strings, and tasks whose states and timings are
 * plausible. Reshaping our fixtures into this format would test the mock against itself;
 * generating Octopus's own vocabulary is what makes the adapter's mapping worth running.
 *
 * Seeded rather than random, for the reason the rest of this codebase is: a page that
 * redraws differently on every refresh reports change that did not happen.
 */

export interface OctopusProjectGroup {
	Id: string;
	Name: string;
	Slug: string;
	Description: string;
}

export interface OctopusProject {
	Id: string;
	Name: string;
	Slug: string;
	Description: string;
	ProjectGroupId: string;
	IsDisabled: boolean;
}

export interface OctopusEnvironment {
	Id: string;
	Name: string;
	Slug: string;
	Description: string;
	SortOrder: number;
}

export interface OctopusRelease {
	Id: string;
	ProjectId: string;
	Version: string;
	Assembled: string;
}

export interface OctopusDeployment {
	Id: string;
	Name: string;
	ProjectId: string;
	EnvironmentId: string;
	ReleaseId: string;
	TaskId: string;
	SpaceId: string;
	Created: string;
	DeployedBy: string;
	DeployedById: string;
	Comments: string;
}

export interface OctopusTask {
	Id: string;
	Name: string;
	Description: string;
	State: OctopusTaskState;
	QueueTime: string;
	StartTime: string | null;
	CompletedTime: string | null;
	Duration: string;
	ErrorMessage: string;
	FinishedSuccessfully: boolean;
	IsCompleted: boolean;
	HasWarningsOrErrors: boolean;
	ProjectId: string;
	SpaceId: string;
}

export interface OctopusEstate {
	spaceId: string;
	projectGroups: OctopusProjectGroup[];
	projects: OctopusProject[];
	environments: OctopusEnvironment[];
	releases: OctopusRelease[];
	deployments: OctopusDeployment[];
	tasks: OctopusTask[];
}

const GROUPS: ReadonlyArray<readonly [string, string]> = [
	['Payments', 'Card capture, settlement and the ledger.'],
	['Identity', 'Sign-in, tokens and account recovery.'],
	['Fulfilment', 'Picking, dispatch and carrier hand-off.'],
	['Catalogue', 'Product data, pricing and search.']
];

const PROJECTS: ReadonlyArray<readonly [string, string]> = [
	['Payment API', 'Payments'],
	['Payment Gateway', 'Payments'],
	['Ledger Worker', 'Payments'],
	['Auth Service', 'Identity'],
	['Token Broker', 'Identity'],
	['Order Service', 'Fulfilment'],
	['Dispatch Worker', 'Fulfilment'],
	['Carrier Adapter', 'Fulfilment'],
	['Catalogue API', 'Catalogue'],
	['Search Indexer', 'Catalogue']
];

/** The spellings a real instance uses, so the normaliser is actually exercised. */
const ENVIRONMENTS: ReadonlyArray<readonly [string, string]> = [
	['Production', 'Live traffic.'],
	['Staging', 'Pre-release verification.'],
	['Dev', 'Developer integration.'],
	['Sandbox', 'Scratch environment that maps to nothing.']
];

/** Weighted so most runs succeed, as they do on a healthy instance. */
const STATES: readonly OctopusTaskState[] = [
	'Success',
	'Success',
	'Success',
	'Success',
	'Success',
	'Success',
	'Success',
	'Failed',
	'TimedOut',
	'Canceled',
	'Executing',
	'Queued'
];

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** `2h 3m 4s`, the way Octopus prints a duration. */
function octopusDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${rest}s`]
		.filter(Boolean)
		.join(' ');
}

/**
 * Build an estate.
 *
 * `now` is a parameter rather than a call to `new Date()`, so a test can assert on a
 * window without racing the clock — the same rule the app's own fixtures follow.
 */
export function buildEstate(options: {
	now: Date;
	count?: number;
	spaceId?: string;
}): OctopusEstate {
	const { now, count = 240, spaceId = 'Spaces-1' } = options;
	const random = seededRandom(hashSeed('octopus-mock'));

	const projectGroups = GROUPS.map(([name, description], index) => ({
		Id: `ProjectGroups-${index + 1}`,
		Name: name,
		Slug: slugify(name),
		Description: description
	}));

	const projects = PROJECTS.map(([name, group], index) => ({
		Id: `Projects-${index + 1}`,
		Name: name,
		Slug: slugify(name),
		Description: `${name} deployment project.`,
		ProjectGroupId: projectGroups.find((one) => one.Name === group)!.Id,
		IsDisabled: false
	}));

	const environments = ENVIRONMENTS.map(([name, description], index) => ({
		Id: `Environments-${index + 1}`,
		Name: name,
		Slug: slugify(name),
		Description: description,
		SortOrder: index
	}));

	const releases: OctopusRelease[] = [];
	const deployments: OctopusDeployment[] = [];
	const tasks: OctopusTask[] = [];

	for (let index = 0; index < count; index++) {
		const project = projects[Math.floor(random() * projects.length)];
		const environment = environments[Math.floor(random() * environments.length)];
		const state = STATES[Math.floor(random() * STATES.length)];
		const running = state === 'Executing' || state === 'Queued';

		// Spread the window backwards from `now`, most recent first.
		const created = new Date(now.getTime() - index * 37 * 60_000 - Math.floor(random() * 900_000));
		const queued = created;
		const started = running && state === 'Queued' ? null : new Date(created.getTime() + 12_000);
		const seconds = 45 + Math.floor(random() * 900);
		const completed = running || !started ? null : new Date(started.getTime() + seconds * 1000);

		const releaseId = `Releases-${index + 1}`;
		const major = 1 + Math.floor(random() * 4);
		const minor = Math.floor(random() * 20);
		const patch = Math.floor(random() * 30);

		releases.push({
			Id: releaseId,
			ProjectId: project.Id,
			Version: `${major}.${minor}.${patch}`,
			Assembled: created.toISOString()
		});

		const byUser = random() < 0.25;
		const taskId = `ServerTasks-${index + 1}`;

		deployments.push({
			Id: `Deployments-${index + 1}`,
			Name: `Deploy to ${environment.Name}`,
			ProjectId: project.Id,
			EnvironmentId: environment.Id,
			ReleaseId: releaseId,
			TaskId: taskId,
			SpaceId: spaceId,
			Created: created.toISOString(),
			DeployedBy: byUser ? 'Alex Morgan' : 'build-pipeline',
			DeployedById: byUser ? 'Users-42' : 'ServiceAccounts-7',
			Comments: ''
		});

		tasks.push({
			Id: taskId,
			Name: 'Deploy',
			Description: `Deploy ${project.Name} release ${major}.${minor}.${patch} to ${environment.Name}`,
			State: state,
			QueueTime: queued.toISOString(),
			StartTime: started ? started.toISOString() : null,
			CompletedTime: completed ? completed.toISOString() : null,
			Duration: completed ? octopusDuration(seconds) : '',
			ErrorMessage: state === 'Failed' ? 'Step "Deploy package" failed on 1 target.' : '',
			FinishedSuccessfully: state === 'Success',
			IsCompleted: !running,
			HasWarningsOrErrors: state === 'Failed' || state === 'TimedOut',
			ProjectId: project.Id,
			SpaceId: spaceId
		});
	}

	return { spaceId, projectGroups, projects, environments, releases, deployments, tasks };
}
