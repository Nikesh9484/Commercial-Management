import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getSessionSecret } from "@/lib/session-secret";

/**
 * Runs before every page/API request: sends people who are not logged in to /login.
 * (Full user checks happen again server-side; this is the front door.)
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health", "/robots.txt"];
/** What a "Reports only" account may open (mirrors REPORTER_PATHS in registers/types). */
const REPORTER_PATHS = ["/reports", "/api/export", "/api/report", "/api/auth", "/api/health", "/user-guide.pdf", "/account"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Cross-site request forgery guard: a state-changing request must come from this site.
  if (MUTATING.has(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = "";
      }
      if (!host || originHost !== host) return NextResponse.json({ error: "Request refused (cross-site origin)." }, { status: 403 });
    }
  }
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const token = request.cookies.get("cd_session")?.value;
  let ok = false;
  let role = "";
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSessionSecret());
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
