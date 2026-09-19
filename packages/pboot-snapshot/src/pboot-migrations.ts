import { compareVersions } from './index.js';

export type PbootMigration = {
  fromVersion: string;
  version: string;
  engine: 'sqlite' | 'mysql';
  source: 'official';
  asset: string;
  sha256: string;
};

/**
 * Only migrations whose SQL is pinned from the official PbootCMS repository are
 * listed here. Missing entries are intentional: the restore engine must block
 * instead of guessing a private schema change.
 */
export const officialPbootMigrations: readonly PbootMigration[] = [
  {
    fromVersion: '3.2.24',
    version: '3.2.26',
    engine: 'sqlite',
    source: 'official',
    asset: 'sqlite-3.2.26-update.sql',
    sha256: '23dcede5cd8745a3820705b41d1f42ea18b923e0613c3e59ce02156530fe0696',
  },
];

export function planPbootMigrations(input: {
  engine: 'sqlite' | 'mysql';
  sourceVersion: string;
  targetVersion: string;
}): PbootMigration[] {
  if (compareVersions(input.sourceVersion, input.targetVersion) > 0)
    throw new Error('downgrade is not supported');
  if (compareVersions(input.sourceVersion, input.targetVersion) === 0) return [];
  const migrations = officialPbootMigrations
    .filter(
      (migration) =>
        migration.engine === input.engine &&
        compareVersions(input.sourceVersion, migration.fromVersion) >= 0 &&
        compareVersions(migration.version, input.sourceVersion) > 0 &&
        compareVersions(migration.version, input.targetVersion) <= 0,
    )
    .sort((left, right) => compareVersions(left.version, right.version));
  if (
    migrations.length === 0 ||
    compareVersions(migrations.at(-1)!.version, input.targetVersion) !== 0
  )
    throw new Error(
      `missing official ${input.engine} migration chain: ${input.sourceVersion} -> ${input.targetVersion}`,
    );
  return migrations;
}
