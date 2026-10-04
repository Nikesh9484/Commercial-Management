import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getRegisterDef } from "@/lib/registers";
import { assertCanEdit, listRecords, updateRecord, ValidationError } from "@/lib/registers/engine";

/**
 * POST /api/recovery/link-change { contractor, changeId }
 * Ties every customs tracker row of a contractor (in the project in the top bar) to the Change
 * Management entry that recovers the duty (RFC / EI → PVO → VO → DVO); changeId null removes the tie.
 */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { contractor?: string; changeId?: number | null };
    const def = getRegisterDef("customs_recovery")!;
    assertCanEdit(def, user);
    const name = String(body.contractor ?? "").trim();
    if (!name) throw new ValidationError("Which contractor?");
    const changeId = body.changeId ? Number(body.changeId) : null;
    if (changeId) {
      const change = listRecords(getRegisterDef("changes")!).find((c) => Number(c.id) === changeId);
      if (!change) throw new ValidationError("That change item is not in this project's Change Management Tracker.");
    }
    const rows = listRecords(def).filter((r) => String(r.contractor_id__label || r.vendor || "") === name);
    if (!rows.length) throw new ValidationError(`No customs tracker rows for ${name} in this project.`);
    let updated = 0;
    for (const r of rows) {
      if ((Number(r.change_id ?? 0) || null) === changeId) continue;
      updateRecord(def, Number(r.id), { change_id: changeId }, user);
      updated++;
    }
    return NextResponse.json({ updated, rows: rows.length, changeId });
  })(req, undefined);
}
