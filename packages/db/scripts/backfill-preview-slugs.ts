import { sql } from 'drizzle-orm';
import { createPlatformDb, website } from '../src/index.js';
import { generatePreviewSlug } from '@cloudcrane/shared';

const { db, pool } = createPlatformDb();

try {
  let processed = 0;
  while (true) {
    const rows = await db
      .select({ id: website.id })
      .from(website)
      .where(sql`${website.previewSlug} is null`)
      .limit(100);
    if (!rows.length) break;
    for (const row of rows) {
      let assigned = false;
      for (let attempt = 0; attempt < 10 && !assigned; attempt += 1) {
        const previewSlug = generatePreviewSlug();
        try {
          await db.transaction(async (tx) => {
            await tx
              .update(website)
              .set({ previewSlug })
              .where(sql`${website.id} = ${row.id} and ${website.previewSlug} is null`);
          });
          assigned = true;
        } catch (error) {
          if ((error as { code?: string }).code !== '23505' || attempt === 9) throw error;
        }
      }
      if (!assigned) throw new Error('preview slug backfill exhausted retries');
      processed += 1;
    }
  }
  await db.execute(sql.raw('alter table "website" alter column "preview_slug" set not null'));
  console.log(`backfilled ${processed} preview slugs`);
} finally {
  await pool.end();
}
