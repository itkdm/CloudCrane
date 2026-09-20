import { randomBytes } from 'node:crypto';

export const PREVIEW_SLUG_LENGTH = 12;
export const PREVIEW_SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function isPreviewSlug(value: string): boolean {
  return new RegExp(`^[a-z0-9]{${PREVIEW_SLUG_LENGTH}}$`).test(value);
}

export function generatePreviewSlug(): string {
  const bytes = randomBytes(PREVIEW_SLUG_LENGTH);
  let slug = '';
  for (const byte of bytes) slug += PREVIEW_SLUG_ALPHABET[byte % PREVIEW_SLUG_ALPHABET.length];
  return slug;
}
