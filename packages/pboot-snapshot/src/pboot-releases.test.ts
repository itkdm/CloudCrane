import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { trustedPbootReleases } from './pboot-releases.js';

describe('trusted Pboot release registry', () => {
  it('matches the registry installed into Workspace images and used by production deployment', async () => {
    const content = await readFile(
      new URL('../../../docker/workspace-pboot/pboot-releases.json', import.meta.url),
      'utf8',
    );
    const imageRegistry = JSON.parse(content) as Record<string, { sourceCommit: string }>;
    const imageReleases = Object.fromEntries(
      Object.entries(imageRegistry).map(([version, release]) => [version, release.sourceCommit]),
    );

    expect(imageReleases).toEqual(trustedPbootReleases);
  });
});
