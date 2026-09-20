import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = resolve(root, 'packages/db/drizzle');
const journalPath = resolve(migrationDir, 'meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: JournalEntry[] };
const entries = journal.entries ?? [];

if (entries.length === 0) throw new Error('migration journal has no entries');

for (const [position, entry] of entries.entries()) {
  if (entry.idx !== position) throw new Error(`migration journal index gap at ${position}`);
  if (!Number.isSafeInteger(entry.when) || entry.when <= 0)
    throw new Error(`migration ${entry.tag} has an invalid timestamp`);
  if (position > 0 && position >= 9 && entry.when <= entries[position - 1].when)
    throw new Error(
      `new migration timestamps must increase after the legacy baseline: ${entry.tag}`,
    );

  if (!existsSync(resolve(migrationDir, `${entry.tag}.sql`)))
    throw new Error(`migration journal entry has no SQL file: ${entry.tag}`);
}

const tags = entries.map((entry) => entry.tag);
if (new Set(tags).size !== tags.length)
  throw new Error('migration journal contains duplicate tags');

const sqlTags = readdirSync(migrationDir)
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .map((file) => basename(file, '.sql'));
for (const tag of sqlTags) {
  if (!tags.includes(tag)) throw new Error(`SQL migration is missing from the journal: ${tag}`);
}

console.log(`migration lineage verified: ${entries.length} entries`);
