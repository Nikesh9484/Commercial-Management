import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Runs before every page/API request: sends people who are not logged in to /login.
 * (Full user checks happen again server-side; this is the front door.)
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const token = request.cookies.get("cd_session")?.value;
  let ok = false;
  if (token) {
    try {
      const secret = process.env.SESSION_SECRET || "commercial-dashboard-dev-secret-change-me";
      await jwtVerify(token, new TextEncoder().encode(secret));
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please log in." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico|webp|css|js|map)$).*)"],
};
