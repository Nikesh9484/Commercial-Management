import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * The key that signs login sessions. Comes from the SESSION_SECRET environment variable; when that is
 * not set (e.g. a hand-made deployment) a random 64-byte secret is generated once and kept next to the
 * database, so there is never a known default that an outsider could use to forge a login.
 */
let cached: Uint8Array | null = null;

export function getSessionSecret(): Uint8Array {
  if (cached) return cached;
  const env = process.env.SESSION_SECRET?.trim();
  if (env && env.length >= 16) {
    cached = new TextEncoder().encode(env);
    return cached;
  }
  const dir = process.env.DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), "data"));
  const file = path.join(dir, ".session-secret");
  try {
    if (fs.existsSync(file)) {
      const s = fs.readFileSync(file, "utf8").trim();
      if (s.length >= 32) {
        cached = new TextEncoder().encode(s);
        return cached;
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    const s = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(file, s, { mode: 0o600 });
    cached = new TextEncoder().encode(s);
    if (process.env.NODE_ENV === "production") console.warn("[security] SESSION_SECRET is not set; a random secret was generated and stored in the data directory.");
    return cached;
  } catch (e) {
    // Read-only file system: fall back to a per-process random secret (sessions end when the server restarts).
    console.warn("[security] Could not persist a session secret; using a per-process one.", e instanceof Error ? e.message : e);
    cached = crypto.randomBytes(48);
    return cached;
  }
}
