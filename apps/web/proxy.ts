import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

function publicUrl(request: NextRequest, pathname: string): URL {
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return new URL(pathname, `${protocol}://${host}`);
}

export default function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const locale = request.cookies.get('NEXT_LOCALE')?.value;
    const targetLocale =
      locale && routing.locales.includes(locale as (typeof routing.locales)[number])
        ? locale
        : routing.defaultLocale;
    return NextResponse.redirect(publicUrl(request, `/${targetLocale}`));
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
