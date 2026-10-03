import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { findBondDuplicates, mergeBondDuplicates } from "@/lib/bonds/duplicates";

/** GET /api/bonds/duplicates – the same bond or policy entered more than once on the selected programme. */
export const GET = withUser(async () => {
  const ctx = getAppContext();
  return NextResponse.json({ groups: ctx.programme ? findBondDuplicates(ctx.programme.id) : [] });
});

/** POST /api/bonds/duplicates – fold the copies into the entry kept (admin and editors). */
export const POST = async (req: Request) =>
  withUser(async (user) => {
    const body = await readJson(req);
    const row = mergeBondDuplicates({ keep: Number(body.keep), remove: Array.isArray(body.remove) ? body.remove.map(Number) : [], carryExpiry: body.carryExpiry !== false }, user);
    const ctx = getAppContext();
    return NextResponse.json({ row, groups: ctx.programme ? findBondDuplicates(ctx.programme.id) : [] });
  })(req, undefined);
