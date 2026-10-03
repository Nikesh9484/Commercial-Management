import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { requireDef, assertCanView } from "@/lib/registers/engine";
import { previewReset, resetRecord } from "@/lib/registers/reset";

type Ctx = { params: Promise<{ key: string; id: string }> };

/** GET – what a reset to the previous report would do to this entry. */
export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key, id } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  return NextResponse.json(previewReset(def, Number(id), user));
});

/** POST – reset the entry to how it stood in the previous issued report (an entry added since is removed). */
export const POST = async (req: Request, ctx: Ctx) =>
  withUser<Ctx>(async (user, { params }) => {
    const { key, id } = await params;
    const def = requireDef(key);
    const body = await readJson(req);
    if (body.preview) return NextResponse.json(previewReset(def, Number(id), user));
    return NextResponse.json(resetRecord(def, Number(id), user));
  })(req, ctx);
