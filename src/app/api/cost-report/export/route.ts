import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { computeCostReport } from "@/lib/cost-report/compute";
import { exportCostReport } from "@/lib/cost-report/excel";
import { todayIso } from "@/lib/format";

export async function GET(req: Request, c: unknown) {
  return withUser(async () => {
  const ctx = getAppContext();
  if (!ctx.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
  const report = computeCostReport(ctx.programme.id, ctx.period?.id ?? null);
  const origin = new URL(req.url).origin;
  const buffer = await exportCostReport(report, { url: `${origin}/modules/cost-report`, label: "Open the cost report" });
  const filename = `Cost_Report_${ctx.programme.code}_${(ctx.period?.label ?? "").replace(/[^\w]+/g, "_")}_${todayIso()}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  })(req, c);
}
