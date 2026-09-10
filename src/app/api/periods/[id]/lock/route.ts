import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { lockPeriod } from "@/lib/snapshots";

type Ctx = { params: Promise<{ id: string }> };

/** POST { force?: true } – force skips the "a newer report exists" guard after the user confirmed. */
export async function POST(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const body = await readJson(req);
    const result = lockPeriod(Number(id), user, { force: body.force === true });
    return NextResponse.json({ ok: true, ...result });
  })(req, ctx);
}
