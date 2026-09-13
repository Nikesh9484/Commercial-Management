import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { computeCostReport } from "@/lib/cost-report/compute";
import { level1Matrix } from "@/lib/cost-report/level1";
import { getMovement } from "@/lib/dashboard/movement";

/** The cost report for the top-bar programme and period, plus Level 1 laid out as the Excel "Level 01" sheet. */
export const GET = withUser(async () => {
  const ctx = getAppContext();
  if (!ctx.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
  const report = computeCostReport(ctx.programme.id, ctx.period?.id ?? null);
  const movement = ctx.period ? getMovement(getDb(), ctx.programme.id, ctx.period.id) : null;
  const prev = movement?.previous ? computeCostReport(ctx.programme.id, movement.previous.id) : null;
  const raw = ctx.period ? (getDb().prepare("SELECT excel_check FROM reporting_periods WHERE id = ?").get(ctx.period.id) as { excel_check: string | null } | undefined)?.excel_check : null;
  let excelCheck: unknown = null;
  try {
    excelCheck = raw ? JSON.parse(raw) : null;
  } catch {
    excelCheck = null;
  }
  return NextResponse.json({ ...report, level1Matrix: level1Matrix(report, prev, movement?.keyMovements ?? null), excelCheck });
});
