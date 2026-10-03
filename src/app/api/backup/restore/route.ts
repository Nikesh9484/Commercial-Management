import { NextResponse } from "next/server";
import { withHeavyLock } from "@/lib/workbook/heavy";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { backupStatus, isConfigured, restoreCopy } from "@/lib/cloud-backup";

/** POST /api/backup/restore { key } – puts a copy from the backup store in place of the database here (admin); the database as it stands is kept aside first. */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin") throw new AuthError("Only an Admin can restore a backup copy.");
    if (!isConfigured()) return NextResponse.json({ error: "Cloud backup is not set up." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { key?: string };
    const key = String(body.key ?? "").trim();
    if (!/^[\w./-]{1,200}\.db$/.test(key) || key.includes("..")) return NextResponse.json({ error: "Which copy?" }, { status: 400 });
    try {
      const r = await withHeavyLock(() => restoreCopy(key));
      return NextResponse.json({ ok: true, ...r, status: backupStatus() });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  })(req, ctx);
}
