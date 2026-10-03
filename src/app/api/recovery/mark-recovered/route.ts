import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getRegisterDef } from "@/lib/registers";
import { assertCanEdit, listRecords, updateRecord, ValidationError } from "@/lib/registers/engine";
import { formatDate, todayIso } from "@/lib/format";

const REGISTERS = ["customs_recovery", "accommodation_recovery"] as const;

/**
 * POST /api/recovery/mark-recovered { register, contractor, recovered }
 * Marks every tracker row of a contractor (in the project in the top bar) as fully recovered – or
 * opens them again – so the summary, the list, the report and the email all follow at once.
 */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { register?: string; contractor?: string; recovered?: boolean };
    const key = REGISTERS.find((k) => k === body.register);
    if (!key) throw new ValidationError("Unknown recovery tracker.");
    const def = getRegisterDef(key)!;
    assertCanEdit(def, user);
    const name = String(body.contractor ?? "").trim();
    if (!name) throw new ValidationError("Which contractor?");
    const recovered = body.recovered !== false;
    const rows = listRecords(def).filter((r) => String(r.contractor_id__label ?? r.vendor ?? r.tracker_name ?? "") === name);
    if (!rows.length) throw new ValidationError(`No ${def.title} rows for ${name} in this project.`);
    const stamp = `${recovered ? "Marked as fully recovered" : "Reopened"} on ${formatDate(todayIso())} by ${user.name}.`;
    let updated = 0;
    for (const r of rows) {
      const status = recovered ? "Recovered" : "Open";
      if (r.status === status) continue;
      updateRecord(def, Number(r.id), { status, comments: [String(r.comments ?? "").trim(), stamp].filter(Boolean).join("\n") }, user);
      updated++;
    }
    return NextResponse.json({ updated, rows: rows.length, status: recovered ? "Recovered" : "Open" });
  })(req, undefined);
}
