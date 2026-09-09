import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getRecentActivity } from "@/lib/audit";
import { getDb } from "@/lib/db";

export async function GET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const url = new URL(req.url);
    const register = url.searchParams.get("register") || undefined;
    return NextResponse.json({ activity: getRecentActivity(getDb(), 300, register) });
  })(req, ctx);
}
