import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { requireDef, assertCanView, listRecords, lookupsFor, createRecord, scopeDefaults } from "@/lib/registers/engine";
import { canEditRegister, canCreateRegister } from "@/lib/registers/types";
import { viewingLockedPeriod, snapshotRows } from "@/lib/view-mode";
import { getDb } from "@/lib/db";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/registers/:key -> all rows + lookup options + the register definition. */
export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  const viewed = def.snapshot ? viewingLockedPeriod() : null;
  const stored = viewed ? snapshotRows(getDb(), viewed.id, def.key) : null;
  return NextResponse.json({
    def,
    rows: stored ?? listRecords(def),
    lookups: lookupsFor(def),
    canEdit: canEditRegister(def, user.role) && !viewed,
    canCreate: canCreateRegister(def, user.role) && !viewed,
    readOnlyReason: viewed ? `${viewed.reason} Switch the top bar to the latest open report to add or change rows.` : null,
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
