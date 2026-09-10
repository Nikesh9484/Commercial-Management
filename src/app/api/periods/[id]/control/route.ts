import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { requireDef, updateRecord } from "@/lib/registers/engine";
import { AuthError } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** Report-control fields that Editors may fill in (the rest of the period stays Admin-only). */
const CONTROL_FIELDS = ["aconex_ref", "prepared_by", "prepared_date", "reviewed_by", "reviewed_date", "approved_by", "approved_date", "notes", "key_issues"];

export async function PUT(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    if (user.role !== "admin" && user.role !== "editor") throw new AuthError("Only Editors and Admins can change report control details.");
    const { id } = await params;
    const body = await readJson(req);
    const input: Record<string, unknown> = {};
    for (const k of CONTROL_FIELDS) if (k in body) input[k] = body[k];
    const row = updateRecord(requireDef("reporting_periods"), Number(id), input, user, "form", { bypassRoles: true });
    return NextResponse.json({ row });
  })(req, ctx);
}
