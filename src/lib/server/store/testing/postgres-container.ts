import { $ } from 'bun';

/**
 * A throwaway Postgres for a test file.
 *
 * Testcontainers-style, but hand-rolled: the whole job is `docker run`, wait until it
 * answers, and remove it afterwards. The `testcontainers` package brings dockerode and a
 * great deal of surface for that, where `Bun.$` is tier 2 of the API selection order and
 * does it in one file.
 *
 * The store's tests run against a real Postgres on purpose. A fake would exercise our own
 * code and nothing about whether the schema, the upserts or `Bun.sql`'s type mapping
 * actually behave — which is precisely the part worth checking.
 */

const IMAGE = 'postgres:17-alpine';

/**
 * Where the docker binary might be.
 *
 * Resolved rather than assumed: Homebrew's `docker` formula installs into
 * `opt/docker/bin` and does not always symlink into `bin`, so a machine can have a
 * working Docker that is not on `PATH`.
 */
const CANDIDATES = [
	'docker',
	'/opt/homebrew/bin/docker',
	'/opt/homebrew/opt/docker/bin/docker',
	'/usr/local/bin/docker',
	'/usr/bin/docker'
];

async function findDocker(): Promise<string | null> {
	for (const candidate of CANDIDATES) {
		try {
			await $`${candidate} version --format {{.Server.Version}}`.quiet();
			return candidate;
		} catch {
			// Not this one — either absent, or present with no daemon behind it.
		}
	}

	return null;
}

export interface PostgresContainer {
	url: string;
	stop(): Promise<void>;
}

/**
 * Whether a container can be started at all.
 *
 * Checked separately so a test file can say plainly that it is skipping, rather than
 * failing with a Docker error that reads like a bug in the store.
 */
export async function dockerAvailable(): Promise<boolean> {
	return (await findDocker()) !== null;
}

/**
 * Start Postgres and wait until it answers.
 *
 * `--rm` so a killed test run leaves nothing behind, and a random host port so parallel
 * test files never collide — the same reasoning as the mock servers binding port 0.
 */
export async function startPostgres(
	options: { image?: string; timeoutMs?: number } = {}
): Promise<PostgresContainer> {
	const docker = await findDocker();
	if (!docker) throw new Error('Docker is not available.');

	const image = options.image ?? IMAGE;
	const password = 'test';
	const database = 'command_center_test';

	const id = (
		await $`${docker} run -d --rm -P -e POSTGRES_PASSWORD=${password} -e POSTGRES_DB=${database} ${image}`.text()
	).trim();

	try {
		const port = (await $`${docker} port ${id} 5432/tcp`.text()).trim().split(':').at(-1);
		if (!port) throw new Error('Container exposed no port.');

		const url = `postgres://postgres:${password}@127.0.0.1:${port}/${database}`;
		await waitForReady(docker, id, options.timeoutMs ?? 60_000);

		return {
			url,
			stop: async () => {
				// Failing to stop must not fail a test that otherwise passed; `--rm` and the
				// daemon's own cleanup are the backstop.
				await $`${docker} rm -f ${id}`.quiet().nothrow();
			}
		};
	} catch (cause) {
		await $`${docker} rm -f ${id}`.quiet().nothrow();
		throw cause;
	}
}

/**
 * Wait for the server to accept connections.
 *
 * `pg_isready` inside the container rather than a connection attempt from outside:
 * Postgres starts, runs its init scripts, then **restarts**, so a client can connect to
 * the first instance and be dropped moments later. Asking the container itself avoids
 * that window.
 */
async function waitForReady(docker: string, id: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const ready = await $`${docker} exec ${id} pg_isready -U postgres`.quiet().nothrow();
		if (ready.exitCode === 0) {
			// One more beat: pg_isready reports the socket, and the init restart can still
			// be a moment behind it.
			await Bun.sleep(250);
			return;
		}

		await Bun.sleep(250);
	}

	throw new Error(`Postgres did not become ready within ${timeoutMs}ms.`);
}
