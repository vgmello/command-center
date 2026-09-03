# command-center

SvelteKit app on Bun.

## Stack

- [Svelte 5](https://svelte.dev) (runes) + [SvelteKit 2](https://svelte.dev/docs/kit)
- [Remote functions](https://svelte.dev/docs/kit/remote-functions) as the data layer
- [Bun](https://bun.com) as package manager, dev runtime, and production server
- [Valibot](https://valibot.dev) for validation

## Getting started

```sh
bun install
bun run dev
```

`bunfig.toml` sets `run.bun = true`, so scripts execute on the Bun runtime rather than following Vite's Node shebang.

## Scripts

| Command           | Does                         |
| ----------------- | ---------------------------- |
| `bun run dev`     | Dev server                   |
| `bun run build`   | Production build to `build/` |
| `bun run preview` | Preview the production build |
| `bun test`        | Run tests                    |
| `bun run check`   | `svelte-check` type checking |
| `bun run lint`    | Prettier + ESLint            |
| `bun run format`  | Format in place              |

## Production

```sh
bun run build
PORT=3000 ORIGIN=https://example.com bun ./build/index.js
```

`ORIGIN` must match the public origin — remote function POSTs are rejected as cross-site without it.

## Docs

- [CLAUDE.md](CLAUDE.md) — conventions, API selection order, and the decisions behind them
- [docs/devs/svelte/](docs/devs/svelte/) — remote functions batching and performance guide

## License

MIT — see [LICENSE](LICENSE).
