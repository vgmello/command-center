import type { Config } from 'drizzle-kit';

/**
 * Migrations for the source store.
 *
 * The runtime client is `drizzle-orm/bun-sql` rather than a Postgres driver: Bun's SQL client is native, so persistence
 * costs no dependency beyond Drizzle itself — where a `pg` driver would have been tier 4
 * of the API selection order and needed justifying on its own.
 */
export default {
	dialect: 'postgresql',
	schema: './src/lib/server/store/schema.ts',
	out: './drizzle',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/command_center'
	}
} satisfies Config;
