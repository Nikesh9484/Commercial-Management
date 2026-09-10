import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { getSessionSecret } from "./session-secret";
import type { Role, UserInfo } from "./registers/types";

export const SESSION_COOKIE = "cd_session";
const SESSION_DAYS = 7;
/** Password rules for everyone: length, letters and digits, not the email itself. */
export const PASSWORD_MIN = 10;

export function passwordProblem(pw: string, email = ""): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Use both letters and numbers.";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return "The password must not contain your login name.";
  if (/^(password|123456|admin|qwerty|welcome|marina)/i.test(pw)) return "That password is too easy to guess.";
  return null;
}

function secretKey(): Uint8Array {
  return getSessionSecret();
}

export async function createSessionToken(user: UserInfo): Promise<string> {
  return new SignJWT({ name: user.name, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<UserInfo | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      id: Number(payload.sub),
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      role: (payload.role as Role) ?? "viewer",
    };
  } catch {
    return null;
  }
}

/** The logged-in user for the current request (server components + route handlers). */
export async function getCurrentUser(): Promise<UserInfo | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const fromToken = await verifySessionToken(token);
  if (!fromToken) return null;
  // Re-check against the database so role changes / deactivation apply immediately.
  const db = getDb();
  const row = db.prepare("SELECT id, name, email, role, active, must_change_password FROM users WHERE id = ?").get(fromToken.id) as
    | { id: number; name: string; email: string; role: Role; active: number; must_change_password: number | null }
    | undefined;
  if (!row || !row.active) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: !!row.must_change_password };
}

export async function requireUser(): Promise<UserInfo> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Please log in.", 401);
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export function checkPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

// A real hash compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-real-password", 10);

export async function authenticate(email: string, password: string): Promise<UserInfo | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT id, name, email, role, active, password_hash, must_change_password FROM users WHERE lower(email) = lower(?)")
    .get(email.trim()) as { id: number; name: string; email: string; role: Role; active: number; password_hash: string; must_change_password: number | null } | undefined;
  if (!row || !row.active || !row.password_hash) {
    checkPassword(password, DUMMY_HASH);
    return null;
  }
  if (!checkPassword(password, row.password_hash)) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: !!row.must_change_password };
}

/** Sets a user's own password (after the rules above) and clears the "must change" flag. */
export function setOwnPassword(userId: number, newPassword: string) {
  const db = getDb();
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now'), updated_by = 'self' WHERE id = ?").run(hashPassword(newPassword), userId);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
