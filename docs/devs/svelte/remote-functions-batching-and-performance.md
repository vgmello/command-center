# SvelteKit Remote Functions: Batching & Performance Patterns

> **Status:** Remote functions are an experimental SvelteKit API (available since 2.27). Signatures may change between minor releases. Pin the SvelteKit version and read the changelog before upgrading.
>
> **Provenance:** This document is adapted from a community write-up on optimizing a production SvelteKit app. The narrative benchmarks (load times, bundle sizes, error rates, platform latency table) are that author's measurements on their app, reproduced here as illustration — they are **not** measured on this repo and should not be treated as targets. Code samples have been corrected against the official docs where the original diverged (see [Corrections](#corrections-from-the-source-article)).

## Why remote functions can get slow

Remote functions solve type-safe client/server communication: you write server logic and call it like an async function. That ergonomic win hides a real cost — **every distinct remote function call is an HTTP endpoint invocation**. Ergonomics that make a call look free encourage patterns that are not.

Three failure modes account for nearly all of it:

1. **Fan-out** — several independent queries for one screen, each its own request.
2. **N+1** — a query called once per item inside an `{#each}`.
3. **Waterfalls** — a query whose argument is the result of another query.

The rest of this document is the fix for each.

---

## 1. Fan-out: `query.batch`

### The problem

```ts
// src/routes/dashboard/dashboard.remote.ts — SLOW
import * as v from 'valibot';
import { query } from '$app/server';
import * as db from '$lib/server/database';

export const getUser = query(v.string(), async (userId) => {
	return db.user.findUnique({ where: { id: userId } });
});

export const getUserPosts = query(v.string(), async (userId) => {
	return db.post.findMany({ where: { authorId: userId } });
});

export const getUserSettings = query(v.string(), async (userId) => {
	return db.settings.findUnique({ where: { userId } });
});
```

```svelte
<!-- Dashboard.svelte -->
<script lang="ts">
	import { getUser, getUserPosts, getUserSettings } from './dashboard.remote';

	let { userId }: { userId: string } = $props();
</script>

<svelte:boundary>
	<h1>{(await getUser(userId)).name}</h1>
	<PostList posts={await getUserPosts(userId)} />
	<SettingsPanel settings={await getUserSettings(userId)} />

	{#snippet pending()}<Skeleton />{/snippet}
</svelte:boundary>
```

Three functions, three endpoints, three round-trips. On a 200ms-latency mobile link that is 600ms of pure network before any rendering settles.

> **Note:** these three run *concurrently*, not sequentially — they don't depend on each other. The cost is connection/request overhead and head-of-line contention, not serialization. Genuine serialization is the waterfall case in §3.

### The fix

`query.batch` groups calls to **the same function** that occur within the same macrotask into one HTTP request. The server callback receives an **array** of arguments and must return a **resolver** `(input, index) => output`:

```ts
// src/routes/dashboard/dashboard.remote.ts — FAST
import * as v from 'valibot';
import { query } from '$app/server';
import * as db from '$lib/server/database';

export const getDashboard = query.batch(v.string(), async (userIds) => {
	const [users, posts, settings] = await Promise.all([
		db.user.findMany({ where: { id: { in: userIds } } }),
		db.post.findMany({ where: { authorId: { in: userIds } } }),
		db.settings.findMany({ where: { userId: { in: userIds } } })
	]);

	const userById = new Map(users.map((u) => [u.id, u]));
	const settingsByUser = new Map(settings.map((s) => [s.userId, s]));

	return (userId) => ({
		user: userById.get(userId),
		posts: posts.filter((p) => p.authorId === userId),
		settings: settingsByUser.get(userId)
	});
});
```

```svelte
<script lang="ts">
	import { getDashboard } from './dashboard.remote';

	let { userId }: { userId: string } = $props();
</script>

<svelte:boundary>
	{@const data = await getDashboard(userId)}

	<h1>{data.user.name}</h1>
	<PostList posts={data.posts} />
	<SettingsPanel settings={data.settings} />

	{#snippet pending()}<Skeleton />{/snippet}
</svelte:boundary>
```

Two distinct wins are stacked here, and it's worth separating them:

- **Collapsing three functions into one** removes two round-trips. That is composition, not batching — it would work with plain `query` too.
- **`query.batch`** is what makes the *same* function called with *different* arguments collapse into one request. That's §2.

Use `query.batch` for the shape in §2. Use plain composition when one screen needs several unrelated things about **one** subject.

### Resolver contract

- Build a `Map` for lookups. A `.find()` inside the resolver is O(n) per input, making the resolver O(n²) — which defeats the point on large batches.
- Return `undefined` from the resolver for a missing input; that resolves that one call to `undefined` without failing the batch.
- The resolver is sync. Do all async work before returning it.

---

## 2. The N+1 trap

The single most common remote-functions performance bug: a query inside a loop.

```svelte
<!-- DON'T -->
<script lang="ts">
	import { getPostAuthor } from './posts.remote';

	let { posts }: { posts: Post[] } = $props();
</script>

{#each posts as post}
	<article>
		<h3>{post.title}</h3>
		<!-- one HTTP request per post -->
		<p>By {(await getPostAuthor(post.authorId)).name}</p>
	</article>
{/each}
```

Twenty posts, twenty requests. This is exactly what `query.batch` exists for — and note the **call site does not change at all**:

```ts
// src/lib/posts.remote.ts
import * as v from 'valibot';
import { query } from '$app/server';
import * as db from '$lib/server/database';

export const getPostAuthor = query.batch(v.string(), async (authorIds) => {
	const authors = await db.user.findMany({
		where: { id: { in: authorIds } },
		select: { id: true, name: true }
	});

	const byId = new Map(authors.map((a) => [a.id, a]));
	return (authorId) => byId.get(authorId);
});
```

```svelte
<!-- DO — identical markup, one request -->
{#each posts as post}
	<article>
		<h3>{post.title}</h3>
		<p>By {(await getPostAuthor(post.authorId))?.name ?? 'Unknown'}</p>
	</article>
{/each}
```

That is the real ergonomic payoff: **you fix N+1 by changing `query` to `query.batch` in one file.** No `Promise.all` plumbing in the component, no index-correlated arrays, no manual pre-fetch pass.

Deduplication stacks on top of batching. Twenty posts by three authors produce **three** entries in the batch, not twenty, because identical arguments share a cache key.

---

## 3. Waterfalls: dependent queries

A query whose argument comes from another query is genuinely serial — the second request cannot start until the first returns:

```svelte
<!-- DON'T — two sequential round-trips -->
<script lang="ts">
	import { getWorkspaceId, getWorkspaceData } from './workspace.remote';

	const workspaceId = $derived(await getWorkspaceId());
	const workspaceData = $derived(await getWorkspaceData(workspaceId));
</script>
```

Fix it by moving the dependency to the server, where the hop costs nothing:

```ts
// src/routes/workspace/workspace.remote.ts
import { query } from '$app/server';

export const getWorkspaceWithData = query(async () => {
	const workspaceId = await getActiveWorkspaceId();
	const data = await loadWorkspaceData(workspaceId);

	return { workspaceId, data };
});
```

```svelte
<script lang="ts">
	import { getWorkspaceWithData } from './workspace.remote';

	const workspace = $derived(await getWorkspaceWithData());
</script>

<WorkspaceView data={workspace.data} />
```

**Rule of thumb:** if call B's argument is derived from call A's result, A and B belong in the same remote function.

Where the dependency is on something request-scoped rather than another query (the session user, say), factor it into its own internal query and let per-request dedupe handle it:

```ts
import { getRequestEvent, query } from '$app/server';

// not exported — internal, runs at most once per request
const getUser = query(async () => {
	const { cookies } = getRequestEvent();
	return findUser(cookies.get('session_id'));
});

export const getProfile = query(async () => {
	const user = await getUser();
	return user && { name: user.name, avatar: user.avatar };
});

export const getInbox = query(async () => {
	const user = await getUser();
	return user ? listMessages(user.id) : [];
});
```

`getUser()` executes once per request even though both exported queries await it — SvelteKit maintains a request-scoped cache keyed on the serialized argument.

---

## 4. Mutations: single-flight, not two round-trips

The naive mutation flow is: submit → wait → refetch what changed → wait. Two round-trips. Single-flight mutations collapse that to one by refreshing queries **on the server**, inside the handler, and shipping the fresh data back with the mutation response.

```ts
import * as v from 'valibot';
import { redirect } from '@sveltejs/kit';
import { form, query, requested } from '$app/server';

export const getPosts = query(v.object({ filter: v.string() }), async ({ filter }) => {
	/* ... */
});

export const createPost = form(v.object({ title: v.string(), content: v.string() }), async (data) => {
	const slug = await insertPost(data);

	// server knows this instance — refresh it in the same flight
	void getPosts({ filter: 'all' }).refresh();

	// accept client-requested refreshes for instances the server can't know,
	// bounded by an explicit limit
	await requested(getPosts, 5).refreshAll();

	redirect(303, `/blog/${slug}`);
});
```

From the client, name the instances to refresh — optionally with an optimistic override so the UI updates before the response lands:

```ts
await createPost.submit().updates(
	getPosts({ filter: 'author:me' }).withOverride((posts) => [draft, ...posts])
);
```

Two hard rules:

- **`requested(fn, limit)` must have a finite limit.** The refresh list is client-supplied; each entry costs a validation and usually a re-fetch. An unbounded list is a denial-of-service vector. `Infinity` requires a written justification.
- **Refresh, don't invalidate everything.** A bare `form` submission invalidates *all* queries and load functions by default, emulating a full page reload. That is almost always more work than the mutation actually required.

Where the server already holds the new value, skip the refetch entirely with `.set()`:

```ts
const updated = await externalApi.update(post);
getPost(post.id).set(updated); // no second query
```

---

## 5. Choosing the right flavour

| Data | Use | Why |
| --- | --- | --- |
| Changes at most once per deploy | `prerender` | Resolved at build time; served from CDN, cached in the browser `Cache` API across reloads. |
| Dynamic reads | `query` | Request-scoped dedupe on the server, instance sharing on the client. |
| Same function, many arguments, one tick | `query.batch` | One request, one round-trip to the datastore. |
| Real-time | `query.live` | One shared connection per instance; self-updating, so no `refresh()`. |
| Writes from a `<form>` | `form` | Works without JS; progressively enhanced. |
| Writes from anywhere else | `command` | Only when `form` genuinely doesn't fit. |

`prerender` is the most under-used of these. Partial prerendering — a `prerender` function on an otherwise dynamic page — moves that data onto the CDN and makes navigation to it effectively free. Reach for it before optimizing a `query` that didn't need to be dynamic.

By default `prerender` functions are excluded from the server bundle, so they cannot be called with un-prerendered arguments. Set `dynamic: true` to allow that.

---

## 6. Where remote functions do *not* belong

Remote functions are the default data layer in this repo, but not the whole of it.

**Keep `load` for:** route-level auth guards and redirects that must resolve before render, and data on the critical render path that you want streamed with the SSR response rather than fetched after hydration.

**Keep `+server.ts` for:** genuine external HTTP surfaces — webhooks, OAuth callbacks, RSS, sitemaps, anything a third party calls.

A workable split for a paginated list: `load` supplies the first page with the document, remote functions handle everything after.

```ts
// +page.server.ts — critical path, arrives with the HTML
export async function load() {
	return { initialPosts: await db.post.findMany({ take: 10 }) };
}
```

```svelte
<script lang="ts">
	import { getMorePosts } from './posts.remote';

	let { data } = $props();
	let extra = $state<Post[]>([]);

	async function loadMore() {
		extra = [...extra, ...(await getMorePosts(data.initialPosts.length + extra.length))];
	}
</script>

{#each [...data.initialPosts, ...extra] as post}
	<PostCard {post} />
{/each}

<button onclick={loadMore}>Load more</button>
```

---

## 7. When *not* to batch

Batching couples calls together. Do not batch across:

- **Cache lifetimes** — hour-TTL profile data batched with 30-second-TTL pricing forces both to the shorter TTL.
- **Failure modes** — one failing input shouldn't take down data the page can render without. Separate functions fail separately.
- **Permission boundaries** — never batch admin-scoped reads with user-scoped reads. A single handler serving both is one authorization bug away from leaking across the boundary.
- **Latency classes** — a fast local lookup batched with a slow third-party call inherits the slow one's latency.

---

## 8. Retries

The community article wraps queries in a generic retry helper:

```ts
// AVOID for queries
let userData = $derived(await retryRemoteFunction(() => getUserData(userId)));
```

**Don't do this.** Wrapping the call breaks the identity that dedupe, caching, `refresh()`, and single-flight updates all depend on — `getUserData(userId)` is no longer the thing the page is holding, so the server can't target it and the client can't share it. You also lose `<svelte:boundary>` error handling in exchange for silent latency multiplication.

Instead:

- **Transient backend failures:** retry **inside** the remote function, on the server, where the retry is cheap and the query identity is preserved.
- **Network failures:** let it throw. `<svelte:boundary>` renders the failed state; expose `query.refresh()` behind a "retry" button, and let the user decide.
- **`command` calls:** these are the one place a client-side retry is reasonable, since they're imperative and not part of the query cache. Make the operation idempotent first.

---

## 9. Measuring

Add a `Server-Timing` header so remote-function latency shows up in browser devtools and RUM without extra instrumentation:

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const start = performance.now();
	const response = await resolve(event);

	if (event.url.pathname.startsWith('/_app/remote/')) {
		const dur = (performance.now() - start).toFixed(1);
		response.headers.append('Server-Timing', `remote;dur=${dur}`);
	}

	return response;
};
```

> The remote-endpoint path prefix is an internal SvelteKit detail and has changed across versions. Verify it against the network tab for the version in use rather than trusting the string above.

What's actually worth watching:

| Metric | Signal |
| --- | --- |
| Requests per page view | The headline number. Batching should move it; if it doesn't, batching isn't engaging. |
| Batch size distribution | Batch sizes stuck at 1 mean calls are landing in different macrotasks. |
| Query cache hit rate | Rises as arguments are normalized — remember object keys are sorted for cache keys, so `{a,b}` and `{b,a}` already share one. |
| P95 handler duration | Separates slow datastore work from network overhead. |
| Refresh count per mutation | Rising count means single-flight is over-refreshing. |

Measure before optimizing. Fan-out over a fast local network can be entirely invisible in development and dominant on mobile.

---

## Corrections from the source article

Recorded so nobody reintroduces these by copying the original:

| Original | Correction |
| --- | --- |
| `query.batch(async (ids) => …)` — no schema | Every remote function taking an argument **must** validate it with a Standard Schema (Valibot/Zod). These are public HTTP endpoints. |
| `export let posts = []` | Svelte 4. This repo is runes-only: `let { posts } = $props()`. |
| Batch example presented as batching | It merges three functions into one — composition. `query.batch` batches *one* function across *many arguments*. Both are valid; they're different tools. |
| Manual `posts.map(...)` + `Promise.all` to fix N+1 | Unnecessary. `query.batch` collapses the calls with the call site unchanged. |
| `.find()` inside the batch resolver | O(n²) on large batches. Build a `Map` first. |
| `retryRemoteFunction` wrapping a query | Breaks query identity — dedupe, `refresh()`, and single-flight targeting all stop working. See §8. |
| `event.url.pathname.includes('__data')` | `__data.json` is the **load function** data path, not the remote-function endpoint. |
| Bundle sizes, load times, error rates, platform table | The author's numbers on their app. Unverified here; treat as illustration, not as targets. |

## Reference

- Official docs: SvelteKit → Remote functions
- Requires `kit.experimental.remoteFunctions` and `compilerOptions.experimental.async` in `svelte.config.js`
