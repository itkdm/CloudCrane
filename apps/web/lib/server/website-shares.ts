import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

export const SHARE_EXPIRATIONS = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const;

export type ShareExpiration = keyof typeof SHARE_EXPIRATIONS;
export const DEFAULT_SHARE_EXPIRATION: ShareExpiration = '1d';

// The web package and @cloudcrane/db resolve Drizzle from separate workspace paths.
// Keep this raw-query adapter local, matching the existing website store boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type WebsiteShareRow = {
  id: string;
  websiteId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

export type WebsiteShare = Omit<WebsiteShareRow, 'websiteId'> & { permission: 'read' };

export function isShareExpiration(value: unknown): value is ShareExpiration {
  return typeof value === 'string' && value in SHARE_EXPIRATIONS;
}

export function createOpaqueShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function shareUrlForWebsite(previewUrl: string, token: string): string {
  const url = new URL('/', `${previewUrl.replace(/\/$/, '')}/`);
  url.searchParams.set('share', token);
  return url.toString();
}

export async function createWebsiteShare(
  db: Db,
  input: { websiteId: string; expiresIn?: ShareExpiration; now?: Date },
): Promise<{ share: WebsiteShare; token: string }> {
  const expiresIn = input.expiresIn ?? DEFAULT_SHARE_EXPIRATION;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SHARE_EXPIRATIONS[expiresIn]);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = createOpaqueShareToken();
    const rows = await db.execute(sql`
      INSERT INTO website_share
        (id, website_id, token_hash, expires_at)
      VALUES
        (${randomUUID()}, ${input.websiteId}, ${hashShareToken(token)}, ${expiresAt})
      RETURNING id, website_id AS "websiteId", expires_at AS "expiresAt",
        revoked_at AS "revokedAt", created_at AS "createdAt"
    `);
    const row = rows.rows[0] as WebsiteShareRow | undefined;
    if (row) return { share: { ...row, permission: 'read' }, token };
  }

  throw new Error('website share could not be created');
}

export async function listWebsiteShares(db: Db, websiteId: string): Promise<WebsiteShare[]> {
  const result = await db.execute(sql`
    SELECT id, website_id AS "websiteId", expires_at AS "expiresAt",
      revoked_at AS "revokedAt", created_at AS "createdAt"
    FROM website_share
    WHERE website_id = ${websiteId}
    ORDER BY created_at DESC
  `);
  return (result.rows as WebsiteShareRow[]).map((row) => ({ ...row, permission: 'read' }));
}

export async function revokeWebsiteShare(
  db: Db,
  input: { websiteId: string; shareId: string },
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE website_share
    SET revoked_at = now()
    WHERE id = ${input.shareId}
      AND website_id = ${input.websiteId}
      AND revoked_at IS NULL
  `);
  return result.rowCount === 1;
}
