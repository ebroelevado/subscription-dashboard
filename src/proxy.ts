import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const intlMiddleware = createIntlMiddleware(routing);

const publicPages = ["/", "/login", "/signup"];

export default async function middleware(req: NextRequest) {
  const isPublicPage = publicPages.some((page) => {
    if (req.nextUrl.pathname === page) return true;

    if (page === "/") {
      return routing.locales.some(
        (locale) =>
          req.nextUrl.pathname === `/${locale}` ||
          req.nextUrl.pathname === `/${locale}/`
      );
    }

    return routing.locales.some(
      (locale) =>
        req.nextUrl.pathname === `/${locale}${page}` ||
        req.nextUrl.pathname.startsWith(`/${locale}${page}/`)
    );
  });

  // For protected pages, check the session cookie
  // Using getSessionCookie for fast cookie existence check
  if (!isPublicPage) {
    const sessionCookie = getSessionCookie(req);

    if (!sessionCookie) {
      const url = req.nextUrl.clone();
      
      // Extract locale from the current path if present
      const pathnameParts = req.nextUrl.pathname.split('/');
      const potentialLocale = pathnameParts[1];
      const locale = ["en", "es", "zh"].includes(potentialLocale) ? potentialLocale : "en";
      
      url.pathname = `/${locale}/login`;
      return NextResponse.redirect(url);
    }
  }

  // Pass ALL requests (public or successfully authenticated) to next-intl
  // to handle routing, prefixing, and locale negotiation.
  return intlMiddleware(req);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
