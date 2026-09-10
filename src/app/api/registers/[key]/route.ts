import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { requireDef, assertCanView, listRecords, lookupsFor, createRecord, scopeDefaults } from "@/lib/registers/engine";
import { canEditRegister } from "@/lib/registers/types";
import { viewingLockedPeriod } from "@/lib/view-mode";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/registers/:key -> all rows + lookup options + the register definition. */
export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  const viewed = def.snapshot ? viewingLockedPeriod() : null;
  return NextResponse.json({
    def,
    rows: listRecords(def),
    lookups: lookupsFor(def),
    canEdit: canEditRegister(def, user.role) && !viewed,
    readOnlyReason: viewed ? `${viewed.label} is locked – you are viewing the issued report. Switch the top bar to an open period to add or change rows.` : null,
    scopeDefaults: scopeDefaults(def),
  });
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
