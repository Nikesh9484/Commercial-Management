import { NextResponse } from "next/server";
import { authenticate, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { readJson } from "@/lib/api";

export async function POST(req: Request) {
  const body = await readJson(req);
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const user = await authenticate(email, password);
  if (!user) return NextResponse.json({ error: "Email or password is incorrect, or the account is inactive." }, { status: 401 });
  const token = await createSessionToken(user);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  logAudit(getDb(), { registerKey: "auth", recordId: user.id, action: "login", user, summary: `${user.name} logged in` });
  return res;
}
