import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/forgot",
  "/invite",
  "/reset",
  "/api/auth",
  "/403",
  "/logo.png",
  "/favicon.ico",
  "/verify",
  "/kvkk",
  "/icon",
  "/api/health",
  "/api/cron",
  "/setup",
  "/api/admin/wipe",
];

// Edge-safe: only check for the session cookie's presence. Full session
// validation (incl. Prisma role/dept lookup) happens in requireUser/requireRole
// inside the Node.js runtime per page/route. Calling auth() from middleware
// fails silently on the Edge because our auth config imports Prisma.
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const hasSession = SESSION_COOKIES.some((n) => req.cookies.get(n)?.value);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|assets|scorm-content|.*\\.).*)"],
};
