import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getAppContext, setAppContext } from "@/lib/context";

export const GET = withUser(async () => NextResponse.json(getAppContext()));

export async function PUT(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const body = await readJson(req);
    const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const context = setAppContext({ programme_id: num(body.programme_id), asset_id: num(body.asset_id), period_id: num(body.period_id) }, user);
    return NextResponse.json(context);
  })(req, ctx);
}
