import { NextResponse } from "next/server";

/** GET /api/health – plain status page for troubleshooting (no secrets, no login needed). */
export async function GET() {
  const out: Record<string, unknown> = { ok: true, time: new Date().toISOString(), node: process.version, cwd: process.cwd() };
  try {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const users = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    const admins = (db.prepare("SELECT email FROM users WHERE role = 'admin' AND active = 1").all() as { email: string }[]).map((u) => u.email.replace(/^(.).*(@.*)$/, "$1***$2"));
    out.database = { ok: true, users, adminEmailsMasked: admins };
  } catch (e) {
    out.ok = false;
    out.database = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  try {
    const { backupStatus } = await import("@/lib/cloud-backup");
    out.backup = backupStatus();
  } catch (e) {
    out.backup = { error: e instanceof Error ? e.message : String(e) };
  }
  out.settings = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ? "set" : "missing",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? "set" : "missing",
    ADMIN_RESET: process.env.ADMIN_RESET ? "set" : "not set",
    BACKUP_GITHUB_TOKEN: process.env.BACKUP_GITHUB_TOKEN ? "set" : "missing",
    BACKUP_GITHUB_REPO: process.env.BACKUP_GITHUB_REPO ?? "missing",
  };
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
