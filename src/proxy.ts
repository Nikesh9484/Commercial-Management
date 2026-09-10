import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Runs before every page/API request: sends people who are not logged in to /login.
 * (Full user checks happen again server-side; this is the front door.)
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];
/** What a "Reports only" account may open (mirrors REPORTER_PATHS in registers/types). */
const REPORTER_PATHS = ["/reports", "/api/export", "/api/report", "/api/auth", "/api/health", "/user-guide.pdf"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const token = request.cookies.get("cd_session")?.value;
  let ok = false;
  let role = "";
  if (token) {
    try {
      const secret = process.env.SESSION_SECRET || "commercial-dashboard-dev-secret-change-me";
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      ok = true;
      role = String(payload.role ?? "");
    } catch {
      ok = false;
    }
  }
  if (ok) {
    if (role === "reporter" && !REPORTER_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Your account can only download reports." }, { status: 403 });
      const url = request.nextUrl.clone();
      url.pathname = "/reports";
      url.search = "";
      return NextResponse.redirect(url);
    }
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  }

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
