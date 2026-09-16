/**
 * Booting the built app, so the tests exercise what actually ships.
 *
 * These are not unit tests and deliberately do not import the app: they start
 * `build/index.js` the way production does and talk to it over HTTP. Every bug this suite
 * exists for — a page that 404s, a number printed raw, a panel that never arrives — was
 * invisible to the 800 tests in `src/` and survived a green gate.
 */

/** Every page route, with the parameterised ones instantiated. */
export const ROUTES = [
	'/',
	'/domains',
	'/domains/payment-domain',
	'/domains/payment-domain/dependencies',
	'/domains/payment-domain/services',
	'/domains/payment-domain/deployments',
	'/domains/payment-domain/slos',
	'/services',
	'/services/payment-api',
	'/services/payment-api/metrics',
	'/services/payment-api/logs',
	'/deployments',
	'/infrastructure',
	'/infrastructure/compute',
	'/alerts',
	'/logs',
	'/reports',
	'/settings',
	'/traces',
	'/status',
	'/api'
] as const;

/**
 * Which configuration the app is running under.
 *
 * All three are tested because three of this session's bugs existed only under real
 * adapters: fixtures answer every question, so the paths that handle "the source cannot
 * say" never ran. `fixtures` is also the only mode that works with nothing else booted.
 *
 * `sources` and `azure` differ in the half of the estate that is real. `sources` runs the
 * Octopus and Coralogix adapters against their mocks over a fixture cloud; `azure` runs
 * the Azure adapter against floci-az and the Monitor and Cost mocks, which is the only
 * mode where the infrastructure page is drawn from a cloud API rather than from seeds.
 */
export type StackMode = 'fixtures' | 'sources' | 'azure';

export interface RunningApp {
	baseUrl: string;
	stop(): void;
}

/** Whether the production bundle exists. Without it there is nothing to test. */
export async function buildExists(): Promise<boolean> {
	return Bun.file('build/index.js').exists();
}

/**
 * Whether floci-az and the two Azure mocks are listening, which the `azure` mode needs.
 *
 * Checked separately from the other mocks because it needs Docker as well: `bun run db:up`
 * and `bun run seed:azure` on top of `bun run dev:stack`.
 */
export async function azureStackRunning(): Promise<boolean> {
	try {
		const emulator = await fetch('http://localhost:4577/health', {
			signal: AbortSignal.timeout(1200)
		});
		if (!emulator.ok) return false;
	} catch {
		return false;
	}

	for (const port of [4593, 4594]) {
		try {
			await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(700) });
		} catch {
			return false;
		}
	}

	return true;
}

/** Whether the mock stack is listening, which the `sources` mode needs. */
export async function mocksRunning(): Promise<boolean> {
	for (const port of [4591, 4592]) {
		try {
			await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(700) });
		} catch {
			return false;
		}
	}

	return true;
}

function envFor(mode: StackMode, port: number): Record<string, string> {
	const base = {
		...process.env,
		PORT: String(port),
		// Must match the URL the browser uses, or remote function POSTs are rejected as
		// cross-site and every page renders its pending state forever.
		ORIGIN: `http://localhost:${port}`
	} as Record<string, string>;

	if (mode === 'fixtures') return base;

	// No SOURCES_ALLOW_FIXTURES for `azure`: nothing in that file is a fixture, and
	// setting it would hide a connections file that had quietly become one.
	if (mode === 'azure') return { ...base, SOURCES_CONFIG: 'sources.local.json' };

	return {
		...base,
		SOURCES_CONFIG: 'sources.example.json',
		SOURCES_ALLOW_FIXTURES: 'true'
	};
}

/**
 * Start the built server on its own port and wait until it answers.
 *
 * Its own port so a suite can run beside a dev server, and so the two modes can be tested
 * in one run without fighting over 3000.
 */
export async function startApp(mode: StackMode, port: number): Promise<RunningApp> {
	const child = Bun.spawn(['bun', './build/index.js'], {
		env: envFor(mode, port),
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const baseUrl = `http://localhost:${port}`;
	const deadline = Date.now() + 30_000;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
			if (response.ok) return { baseUrl, stop: () => child.kill() };
		} catch {
			// Not listening yet.
		}

		await Bun.sleep(200);
	}

	child.kill();
	throw new Error(`${mode} server did not start on ${port} within 30s`);
}

/**
 * A webview, launched the way the host it is running on needs.
 *
 * On macOS this is `WKWebView` and takes no arguments. On Linux it is Chrome over CDP, and
 * a container runs as root — where Chromium refuses to start at all and reports "Chrome
 * process closed the pipe", which reads like a Bun problem and is a sandbox one. Every
 * WebView test failed that way the first time this suite ran under Linux.
 *
 * `--disable-dev-shm-usage` goes with it: a container's /dev/shm is small by default and
 * Chrome crashes partway through a page rather than failing to launch, which is the more
 * confusing half of the same class of problem.
 */
export function openView(): InstanceType<typeof Bun.WebView> {
	if (process.platform !== 'linux') return new Bun.WebView();

	return new Bun.WebView({
		backend: { type: 'chrome', argv: ['--no-sandbox', '--disable-dev-shm-usage'] }
	});
}

/**
 * Wait for a page to finish painting, not merely to load.
 *
 * `navigate()` resolves on the load event, and this app renders its content after
 * hydration and a remote call — an async `<svelte:boundary>` sends the pending snippet
 * down and fills it in on the client.
 *
 * Waiting for one phrase is not enough, and the first version of this suite proved it: the
 * nav renders immediately, so a predicate matching the app's chrome returned while the
 * page was still skeletons. The sweep then read an almost-empty body, found nothing wrong
 * with it, and passed — a broken test that looks exactly like a working one.
 *
 * So this waits for the text to stop growing. It is generic, needs no per-route knowledge,
 * and catches content that arrives late rather than racing it.
 */
export async function settle(
	view: { evaluate(script: string): Promise<unknown> },
	predicate: (text: string) => boolean = () => true,
	timeoutMs = 25_000
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let text = '';
	let previous = -1;
	let stable = 0;

	while (Date.now() < deadline) {
		text = ((await view.evaluate('document.body.innerText')) as string) ?? '';

		// Three identical readings, because one pause between two panels arriving would
		// otherwise look like the end.
		stable = text.length === previous ? stable + 1 : 0;
		previous = text.length;

		if (stable >= 3 && predicate(text)) return text;
		await Bun.sleep(150);
	}

	throw new Error(`page never settled; last saw ${text.length} characters`);
}

/** The app's chrome, which every page renders once hydrated. */
export const HYDRATED = (text: string) => text.includes('Command Center');
