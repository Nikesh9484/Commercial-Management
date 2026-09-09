import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { requireDef, assertCanView, listRecords, lookupsFor, createRecord, scopeDefaults } from "@/lib/registers/engine";
import { canEditRegister } from "@/lib/registers/types";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/registers/:key -> all rows + lookup options + the register definition. */
export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  return NextResponse.json({ def, rows: listRecords(def), lookups: lookupsFor(def), canEdit: canEditRegister(def, user.role), scopeDefaults: scopeDefaults(def) });
});

/** POST /api/registers/:key -> create a record. */
export async function POST(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { key } = await params;
    const def = requireDef(key);
    const row = createRecord(def, await readJson(req), user);
    return NextResponse.json({ row }, { status: 201 });
  })(req, ctx);
}
