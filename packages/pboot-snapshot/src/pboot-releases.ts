export const trustedPbootReleases = {
  '3.2.24': '29ff72ee5afc9c6553b949f04d3fc99443879f40',
  '3.2.26': '8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea',
} as const;

export function assertTrustedPbootRelease(version: string, sourceCoreCommit: string): void {
  if (trustedPbootReleases[version as keyof typeof trustedPbootReleases] !== sourceCoreCommit)
    throw new Error(`untrusted Pboot release: ${version} ${sourceCoreCommit}`);
}
