import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge-level auth gate:
 *   - For /dashboard/*, /account/*, /admin/*: if no refresh cookie → redirect to /login.
 *   - Full role check happens server-side (admin layout) via /auth/me.
 *
 * The refresh cookie is scoped to /api/v1/auth on the API host; in a single-origin
 * deploy the browser also sends it here, and its presence is a cheap gate.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasRefresh = Boolean(req.cookies.get('refreshToken'));
  if (!hasRefresh) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname + search);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/account/:path*', '/admin/:path*'],
};
