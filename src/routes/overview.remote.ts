import { query } from '$app/server';
import { scopeSchema } from '$lib/server/api/schemas';
import { readOverview } from '$lib/server/platform/service';

/*
 * The overview screen's transport.
 *
 * The shell it renders inside lives in `shell.remote.ts`, and the domain table it
 * embeds in `domains.remote.ts` — both are used by more than this screen, and a
 * module named after one page is the wrong home for either.
 */

/**
 * Everything above and beside the overview's domain table, for one scope.
 *
 * A public HTTP endpoint like every remote function, so the scope is validated
 * against the same schema the JSON API uses. It calls the service in process; it
 * must never fetch `/api/v1/*`.
 */
export const getOverview = query(scopeSchema, async (scope) => readOverview(scope));
