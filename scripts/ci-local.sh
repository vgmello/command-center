#!/usr/bin/env bash
#
# Run what CI runs, on this machine.
#
# CI is the only place a Linux `Bun.WebView` had ever been exercised, which meant its one
# unverified assumption — that the runtime finds a Chrome over CDP on Linux the way it uses
# the system webview on macOS — could only fail on a pull request. This runs the same job
# in the same shape of container, so it fails here first.
#
#   bun run ci:local          # build + mock stack + e2e, the Linux-only part
#   bun run ci:local --full   # also check, lint and the unit suite (needs ~8GB for the VM)
#   bun run ci:local --keep   # leave the container's checkout in place to poke at
#
# The default deliberately skips `check`, `lint` and `bun test src`. Those are
# platform-independent — running them under Linux proves nothing the host run does not —
# and `svelte-check` across 1861 files is what exhausted a 4GB Colima VM and returned exit
# 137, which reads like a test failure and is an out-of-memory kill. What only Linux can
# answer is whether Bun.WebView finds and drives Chrome over CDP, so that is what runs.
#
# It works from a clean `git archive` of HEAD rather than the working tree, for two
# reasons: node_modules built on macOS cannot be reused by a Linux container, and a run
# that quietly included uncommitted files would not be running what CI will.
set -euo pipefail

BUN_VERSION="${BUN_VERSION:-1.3.14}"
# Under $HOME, not $TMPDIR.
#
# A Linux VM shares only some host paths, and on Colima /tmp is not one of them: a
# checkout there mounts as an empty directory and the container fails with "could not
# find a package.json file to install from", which reads like a repo problem rather than
# a mount problem. $HOME is shared by every common macOS Docker setup.
WORKDIR="${CI_LOCAL_DIR:-$HOME/.cache/command-center-ci-local}"
KEEP=0
FULL=0

for arg in "$@"; do
	case "$arg" in
		--keep) KEEP=1 ;;
		--full) FULL=1 ;;
		*) echo "unknown option: $arg" >&2; exit 2 ;;
	esac
done

if ! command -v docker >/dev/null 2>&1; then
	# Homebrew's docker is not always on PATH, and this is the machine's own setup rather
	# than something the repo should assume.
	echo "docker not found on PATH." >&2
	echo "If it is installed by Homebrew, try:" >&2
	echo "  export PATH=\"/opt/homebrew/opt/docker/bin:\$PATH\"" >&2
	exit 1
fi

if ! docker info >/dev/null 2>&1; then
	echo "docker is installed but not running. Start it (e.g. \`colima start\`) and retry." >&2
	exit 1
fi

echo "==> exporting HEAD to $WORKDIR"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
git archive HEAD | tar -x -C "$WORKDIR"

# Built on the host, then carried in.
#
# The bundle is platform-independent JavaScript — Bun runs the same `build/index.js` on
# either OS — so building here tests nothing less and costs the container nothing. It
# matters because a Vite build and a Chromium both want memory, and a 4GB VM has enough
# for one: the build was killed by the OOM reaper on one run and survived on the next,
# which is a harness that fails at random. CI has the memory to do both and does.
echo "==> building on the host"
bun run build >/dev/null
cp -R build "$WORKDIR/build"

echo "==> running the CI job in oven/bun:$BUN_VERSION"

# `--init` so the backgrounded mock process is reaped rather than left as a zombie holding
# the container open.
docker run --rm --init \
	-e "CI_LOCAL_FULL=$FULL" \
	-v "$WORKDIR:/app" \
	-w /app \
	"oven/bun:$BUN_VERSION" \
	bash -lc '
		set -euo pipefail

		echo "--- chromium ---"
		# Bun.WebView drives the system webview on macOS and Chrome over CDP everywhere
		# else, so a Linux run needs a browser present. No browser download, no Playwright.
		#
		# Noninteractive because there is no tty here, and without it debconf prints eight
		# lines of frontend fallbacks before every install.
		export DEBIAN_FRONTEND=noninteractive
		apt-get update -qq >/dev/null
		apt-get install -y -qq chromium >/dev/null 2>&1
		chromium --version

		echo "--- install ---"
		bun install --frozen-lockfile

		if [ "${CI_LOCAL_FULL:-0}" = "1" ]; then
			echo "--- check ---"
			bun run check
			bun run lint
			bun test src
		fi

		# No build here: it came in from the host. See the note in ci-local.sh.

		echo "--- mock stack ---"
		# The real Octopus, Coralogix and Azure-cost adapters need something to answer.
		bun run scripts/mocks.ts >/tmp/mocks.log 2>&1 &

		# Bun rather than curl: the oven/bun image ships neither curl nor wget, and a
		# readiness probe that silently is not there reports "mocks never started" for a
		# stack that started perfectly well.
		for _ in $(seq 1 30); do
			bun -e "await fetch(\"http://localhost:4591/\")" >/dev/null 2>&1 && break
			sleep 1
		done
		bun -e "await fetch(\"http://localhost:4591/\")" >/dev/null 2>&1 || {
			echo "mocks never started"
			cat /tmp/mocks.log
			exit 1
		}

		echo "--- e2e ---"
		bun test e2e
	'

status=$?

if [ "$KEEP" -eq 0 ]; then
	rm -rf "$WORKDIR"
else
	echo "==> checkout kept at $WORKDIR"
fi

exit "$status"
