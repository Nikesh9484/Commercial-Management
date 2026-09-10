import { NextResponse } from "next/server";
import { authenticate, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { readJson } from "@/lib/api";
import { clientIp, loginBlockedFor, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim().slice(0, 200);
    const password = String(body.password ?? "").slice(0, 200);
    if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    const ip = clientIp(req);
    const wait = loginBlockedFor(ip, email);
    if (wait > 0) {
      return NextResponse.json({ error: `Too many attempts. Please wait ${Math.ceil(wait / 60)} minute(s) and try again.` }, { status: 429, headers: { "Retry-After": String(wait) } });
    }
    const user = await authenticate(email, password);
    if (!user) {
      recordLoginFailure(ip, email);
      logAudit(getDb(), { registerKey: "auth", recordId: null, action: "login_failed", user: null, summary: `Failed login for ${email} from ${ip}` });
      return NextResponse.json({ error: "Email or password is incorrect, or the account is inactive." }, { status: 401 });
    }
    recordLoginSuccess(ip, email);
    const token = await createSessionToken(user);
    const res = NextResponse.json({ user, mustChangePassword: !!user.mustChangePassword });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    logAudit(getDb(), { registerKey: "auth", recordId: user.id, action: "login", user, summary: `${user.name} logged in from ${ip}` });
    return res;
  } catch (e) {
    console.error("[login]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `The server could not check the login: ${msg}` }, { status: 500 });
  }
}
