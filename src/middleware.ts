import { NextResponse } from "next/server";

// DEV BYPASS: tüm auth kontrolleri devre dışı
export default function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|assets|scorm-content).*)"],
};
