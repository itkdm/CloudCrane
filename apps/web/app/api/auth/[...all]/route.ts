import { toNextJsHandler } from 'better-auth/next-js';
import { validateAuthRuntimeConfig } from '@cloudcrane/auth';
import { auth } from '../../../../lib/server/auth.js';

export const runtime = 'nodejs';

const betterAuthHandler = toNextJsHandler(auth);

export async function GET(request: Request) {
  validateAuthRuntimeConfig();
  return betterAuthHandler.GET(request);
}

export async function POST(request: Request) {
  validateAuthRuntimeConfig();
  return betterAuthHandler.POST(request);
}
