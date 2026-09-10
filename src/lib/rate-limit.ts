/**
 * Small in-memory rate limiter for the login form: slows down password guessing.
 *  - 5 failed attempts for one email (from anywhere) or one IP address locks that key for 15 minutes
 *  - 30 attempts per IP in 15 minutes are refused outright
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_PER_IP = 30;

interface Bucket {
  fails: number[];
  lockedUntil: number;
}
const buckets = new Map<string, Bucket>();

function bucket(key: string): Bucket {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { fails: [], lockedUntil: 0 };
    buckets.set(key, b);
  }
  b.fails = b.fails.filter((t) => now - t < WINDOW_MS);
  if (buckets.size > 5000) {
    // keep memory bounded: drop stale entries
    for (const [k, v] of buckets) if (v.fails.length === 0 && v.lockedUntil < now) buckets.delete(k);
  }
  return b;
}

/** Seconds the caller must still wait, or 0 when a login attempt may proceed. */
export function loginBlockedFor(ip: string, email: string): number {
  const now = Date.now();
  const byIp = bucket(`ip:${ip}`);
  const byEmail = bucket(`email:${email.toLowerCase()}`);
  const until = Math.max(byIp.lockedUntil, byEmail.lockedUntil);
  if (until > now) return Math.ceil((until - now) / 1000);
  if (byIp.fails.length >= MAX_PER_IP) return Math.ceil(WINDOW_MS / 1000);
  return 0;
}

export function recordLoginFailure(ip: string, email: string) {
  const now = Date.now();
  for (const key of [`ip:${ip}`, `email:${email.toLowerCase()}`]) {
    const b = bucket(key);
    b.fails.push(now);
    if (b.fails.length >= MAX_FAILS) b.lockedUntil = now + WINDOW_MS;
  }
}

export function recordLoginSuccess(ip: string, email: string) {
  buckets.delete(`email:${email.toLowerCase()}`);
  const b = buckets.get(`ip:${ip}`);
  if (b) b.fails = [];
}

/** Best-effort client address behind Render's proxy. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
