import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { requireDef, assertCanView, lookupsFor, createRecord, scopeDefaults } from "@/lib/registers/engine";
import { canEditRegister, canCreateRegister, isEditorRole } from "@/lib/registers/types";
import { viewingLockedPeriod, recordsForView } from "@/lib/view-mode";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/registers/:key -> all rows + lookup options + the register definition. */
export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  const viewed = def.snapshot ? viewingLockedPeriod() : null;
  return NextResponse.json({
    def,
    rows: recordsForView(def),
    lookups: lookupsFor(def),
    canEdit: canEditRegister(def, user.role) && !viewed,
    canCreate: canCreateRegister(def, user.role) && !viewed,
    canDelete: canEditRegister(def, user.role) && isEditorRole(user.role) && !viewed,
    // the "switch to add or change rows" hint only for people who could add or change rows
    readOnlyReason: viewed ? (canCreateRegister(def, user.role) ? `${viewed.reason} Switch the top bar to the latest open report to add or change rows.` : viewed.reason) : null,
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
