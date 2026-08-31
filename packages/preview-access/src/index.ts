import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const previewClaimsSchema = z.object({
  websiteId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
});
export type PreviewClaims = z.infer<typeof previewClaimsSchema>;

export function signPreviewToken(claims: PreviewClaims, secret: string): string {
  const payload = base64Url(JSON.stringify(previewClaimsSchema.parse(claims)));
  return `${payload}.${base64Url(signature(payload, secret))}`;
}

export function verifyPreviewToken(
  token: string,
  secret: string,
  now = Date.now(),
): PreviewClaims | null {
  const [payload, encodedSignature] = token.split('.');
  if (!payload || !encodedSignature) return null;
  const expected = signature(payload, secret);
  const actual = fromBase64Url(encodedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = previewClaimsSchema.parse(JSON.parse(fromBase64Url(payload).toString('utf8')));
    return claims.expiresAt * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

function base64Url(value: string): string;
function base64Url(value: Buffer): string;
function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
