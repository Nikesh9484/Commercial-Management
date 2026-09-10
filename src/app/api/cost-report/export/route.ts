import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { computeCostReport } from "@/lib/cost-report/compute";
import { exportCostReport } from "@/lib/cost-report/excel";
import { level1Matrix } from "@/lib/cost-report/level1";
import { getMovement } from "@/lib/dashboard/movement";
import { getDb } from "@/lib/db";
import { todayIso } from "@/lib/format";

export async function GET(req: Request, c: unknown) {
  return withUser(async () => {
  const ctx = getAppContext();
  if (!ctx.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
  const report = computeCostReport(ctx.programme.id, ctx.period?.id ?? null);
  const movement = ctx.period ? getMovement(getDb(), ctx.programme.id, ctx.period.id) : null;
  const prev = movement?.previous ? computeCostReport(ctx.programme.id, movement.previous.id) : null;
  const origin = new URL(req.url).origin;
  const buffer = await exportCostReport(report, level1Matrix(report, prev, movement?.keyMovements ?? null), { url: `${origin}/modules/cost-report`, label: "Open the cost report" });
  const filename = `Cost_Report_${ctx.programme.code}_${(ctx.period?.label ?? "").replace(/[^\w]+/g, "_")}_${todayIso()}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  })(req, c);
}
