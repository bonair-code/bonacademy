import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/captcha", "/403", "/logo.png", "/favicon.ico"];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const session = await auth();
  if (!session?.user) {
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
