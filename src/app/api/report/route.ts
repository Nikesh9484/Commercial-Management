import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getReportData } from "@/lib/report/data";
import { renderMonthlyReportPdf } from "@/lib/report/pdf";
import { renderMonthlyReportExcel } from "@/lib/report/excel";
import { todayIso } from "@/lib/format";

/** GET /api/report?period=ID&format=pdf|xlsx – generates the monthly report. */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
    const url = new URL(req.url);
    const periodId = Number(url.searchParams.get("period") || app.period?.id || 0);
    if (!periodId) return NextResponse.json({ error: "Choose a reporting period." }, { status: 400 });
    const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";
    const data = getReportData(app.programme.id, periodId);
    const base = `Monthly_Commercial_Report_${app.programme.code}_No${data.period.report_no}_${todayIso()}${data.locked ? "" : "_DRAFT"}`;
    if (format === "xlsx") {
      const buffer = await renderMonthlyReportExcel(data, { url: `${url.origin}/modules/monthly-report`, label: "Open the dashboard" });
      return new Response(new Uint8Array(buffer), {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` },
      });
    }
    const buffer = await renderMonthlyReportPdf(data);
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  })(req, ctx);
}
