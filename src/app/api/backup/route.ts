import { NextResponse } from "next/server";
import fs from "node:fs";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { backupNow, backupStatus, isConfigured } from "@/lib/cloud-backup";
import { getDb } from "@/lib/db";
import os from "node:os";
import path from "node:path";
import { todayIso } from "@/lib/format";

/** GET /api/backup – download a copy of the database (admin). */
export const GET = withUser(async (user) => {
  if (user.role !== "admin") throw new AuthError("Only an Admin can download the database.");
  const tmp = path.join(os.tmpdir(), `commercial-download-${Date.now()}.db`);
  await getDb().backup(tmp);
  const bytes = fs.readFileSync(tmp);
  fs.rm(tmp, { force: true }, () => {});
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/x-sqlite3", "Content-Disposition": `attachment; filename="commercial-backup-${todayIso()}.db"` },
  });
});

/** POST /api/backup – upload to cloud storage now (admin). */
export const POST = withUser(async (user) => {
  if (user.role !== "admin") throw new AuthError("Only an Admin can run a backup.");
  if (!isConfigured()) return NextResponse.json({ error: "Cloud backup is not set up (BACKUP_S3_* settings missing)." }, { status: 400 });
  await backupNow("manual");
  const s = backupStatus();
  if (s.lastError) return NextResponse.json({ error: s.lastError }, { status: 500 });
  return NextResponse.json({ ok: true, status: s });
});
