import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { setRange } from "@/lib/cashflow/compute";

export async function PUT(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a programme first." }, { status: 400 });
    const body = await readJson(req);
    setRange(getDb(), app.programme.id, String(body.start), Number(body.count), user);
    return NextResponse.json({ ok: true });
  })(req, ctx);
}
