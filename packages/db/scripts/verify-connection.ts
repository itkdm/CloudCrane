import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

try {
  await client.connect();
  const result = await client.query<{ connected: number }>('select 1 as connected');
  if (result.rows[0]?.connected !== 1) {
    throw new Error('PostgreSQL verification query returned an unexpected result');
  }
} finally {
  await client.end().catch(() => undefined);
}
