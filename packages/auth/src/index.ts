import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { PlatformDb } from '@cloudcrane/db';
import * as schema from '@cloudcrane/db';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { createResendEmailSender } from './email-sender.js';

type Db = PlatformDb['db'];

function configuredWebOrigin(): string {
  return (
    process.env.WEB_ORIGIN ??
    process.env.NEXT_PUBLIC_WEB_ORIGIN ??
    process.env.BETTER_AUTH_URL ??
    'http://localhost:3000'
  );
}

function requiredSecret(value: string | undefined): string {
  if (!value || value.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be configured with at least 32 characters');
  }
  return value;
}

export function createAuth(db: Db): ReturnType<typeof betterAuth> {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const requireEmailVerification = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false';
  const sendEmail = createResendEmailSender({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.AUTH_EMAIL_FROM,
  });
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: requiredSecret(process.env.BETTER_AUTH_SECRET),
    baseURL: process.env.BETTER_AUTH_URL ?? configuredWebOrigin(),
    trustedOrigins: [configuredWebOrigin()],
    advanced: {
      database: {
        joins: false,
      },
    },
    rateLimit: {
      enabled: process.env.NODE_ENV === 'production',
      window: 60,
      max: 100,
    },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      requireEmailVerification,
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        role: 'user',
        banned: false,
        banReason: null,
        banExpires: null,
        ...additionalFields,
        id,
      }),
      sendResetPassword: async ({ user, url }) => {
        try {
          await sendEmail({
            to: user.email,
            subject: '重置 CloudCrane 密码',
            text: `请使用以下链接重置密码：${url}`,
            html: `<p>请使用以下链接重置密码：</p><p><a href="${url}">${url}</a></p>`,
          });
        } catch (error: unknown) {
          logEmailFailure(error);
          throw error;
        }
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        try {
          await sendEmail({
            to: user.email,
            subject: '验证 CloudCrane 邮箱',
            text: `请使用以下链接验证邮箱：${url}`,
            html: `<p>请使用以下链接验证邮箱：</p><p><a href="${url}">${url}</a></p>`,
          });
        } catch (error: unknown) {
          logEmailFailure(error);
          throw error;
        }
      },
      sendOnSignUp: requireEmailVerification,
      sendOnSignIn: requireEmailVerification,
      autoSignInAfterVerification: true,
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'email-password'],
        allowDifferentEmails: false,
      },
    },
    socialProviders:
      googleClientId && googleClientSecret
        ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
        : undefined,
    plugins: [admin()],
  }) as unknown as ReturnType<typeof betterAuth>;
}

export function validateAuthRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const requireEmailVerification = env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false';
  if (env.NODE_ENV === 'production' && requireEmailVerification) {
    if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM)
      throw new Error(
        'RESEND_API_KEY and AUTH_EMAIL_FROM are required when email verification is enabled in production',
      );
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown email provider error';
}

function logEmailFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      service: 'auth',
      errorCode: 'AUTH_EMAIL_SEND_FAILED',
      error: safeErrorMessage(error),
      message: 'failed to send authentication email',
    }),
  );
}

export type CloudCraneAuth = ReturnType<typeof createAuth>;

export async function getSession(auth: CloudCraneAuth, headers: HeadersInit) {
  return auth.api.getSession({ headers });
}

export function assertSameOrigin(headers: HeadersInit, expectedOrigin = configuredWebOrigin()) {
  const origin = new Headers(headers).get('origin');
  if (origin && origin !== expectedOrigin)
    throw new AuthorizationError('ORIGIN_NOT_ALLOWED', 'origin is not allowed', 403);
}

export function headersFromNode(input: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined)
      headers.set(
        name,
        Array.isArray(value) ? value.join(name.toLowerCase() === 'cookie' ? '; ' : ', ') : value,
      );
  }
  return headers;
}

export async function requireSession(auth: CloudCraneAuth, headers: HeadersInit) {
  const session = await getSession(auth, headers);
  if (!session)
    throw new AuthorizationError('AUTHENTICATION_REQUIRED', 'authentication required', 401);
  const user = session.user as typeof session.user & { banned?: boolean };
  if (user.banned) throw new AuthorizationError('ACCOUNT_BANNED', 'account is unavailable', 403);
  return session;
}

export function getUserRole(session: { user: object }): string | undefined {
  const role = (session.user as { role?: unknown }).role;
  return typeof role === 'string' ? role : undefined;
}

export async function requireWebsiteAccess(
  db: Db,
  auth: CloudCraneAuth,
  headers: HeadersInit,
  websiteId: string,
) {
  const session = await requireSession(auth, headers);
  const role = (session.user as typeof session.user & { role?: string | null }).role;
  const website = await assertWebsiteAccessForUser(db, session.user.id, role, websiteId);
  return { session, website, isAdmin: role === 'admin' };
}

export async function assertWebsiteAccessForUser(
  db: Db,
  userId: string,
  role: string | null | undefined,
  websiteId: string,
) {
  const website = await db.query.website.findFirst({ where: eq(schema.website.id, websiteId) });
  if (!website) throw new AuthorizationError('WEBSITE_NOT_FOUND', 'website was not found', 404);
  if (role !== 'admin' && website.ownerId !== userId) {
    throw new AuthorizationError('WEBSITE_FORBIDDEN', 'website access is forbidden', 403);
  }
  return website;
}

export class AuthorizationError extends Error {
  constructor(
    readonly code:
      | 'AUTHENTICATION_REQUIRED'
      | 'ACCOUNT_BANNED'
      | 'WEBSITE_NOT_FOUND'
      | 'WEBSITE_FORBIDDEN'
      | 'ORIGIN_NOT_ALLOWED',
    message: string,
    readonly status: 401 | 403 | 404,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}
