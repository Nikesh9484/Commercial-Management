import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { updatePeriodDetails, deletePeriod } from "@/lib/periods";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { report_no?, period_end?, period_start?, label? } – change a report's details; DELETE – remove the report, its snapshot and checklist. */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const body = await readJson(req);
    const row = updatePeriodDetails(Number(id), body, user);
    return NextResponse.json({ period: { id: row.id, label: row.label, report_no: row.report_no, period_end: row.period_end } });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  return NextResponse.json({ ok: true, ...deletePeriod(Number(id), user) });
});
