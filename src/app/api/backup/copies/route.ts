import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { backupStatus, isConfigured, listCopies } from "@/lib/cloud-backup";

/** GET /api/backup/copies – the copies held in the backup store (admin): current, daily, and any kept aside. */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin") throw new AuthError("Only an Admin can see the backup copies.");
    if (!isConfigured()) return NextResponse.json({ copies: [], status: backupStatus() });
    return NextResponse.json({ copies: await listCopies(), status: backupStatus() });
  })(req, ctx);
}
