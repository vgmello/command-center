import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';

/**
 * Apply pending migrations.
 *
 * Run with `bun run db:migrate`. Drizzle records what it has applied in its own table, so
 * this is safe to run repeatedly and on every deploy.
 */
const url = process.env.DATABASE_URL;

if (!url) {
	console.error('DATABASE_URL is not set. See .env.example.');
	process.exit(1);
}

const client = new SQL(url);
await migrate(drizzle({ client }), { migrationsFolder: './drizzle' });
await client.close();

console.log('migrations applied');
