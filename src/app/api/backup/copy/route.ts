import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getCopy, isConfigured } from "@/lib/cloud-backup";

/** GET /api/backup/copy?key=daily/2026-10-01.db – downloads one copy from the backup store (admin). */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin") throw new AuthError("Only an Admin can download a backup copy.");
    if (!isConfigured()) return NextResponse.json({ error: "Cloud backup is not set up." }, { status: 400 });
    const key = String(new URL(req.url).searchParams.get("key") ?? "").trim();
    if (!/^[\w./-]{1,200}\.db$/.test(key) || key.includes("..")) return NextResponse.json({ error: "Which copy?" }, { status: 400 });
    const bytes = await getCopy(key);
    if (!bytes) return NextResponse.json({ error: "That copy is not in the store." }, { status: 404 });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/x-sqlite3", "Content-Disposition": `attachment; filename="${key.replace(/[^\w.-]+/g, "-")}"` } });
  })(req, ctx);
}
