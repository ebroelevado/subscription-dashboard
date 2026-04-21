import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);
export default function middleware(request: any) {
  console.log("Middleware processing:", request.url);
  return intlMiddleware(request);
}


export const config = {
  // Match only internationalized pathnames
  matcher: ["/", "/(en|es|zh)/:path*"],
};
