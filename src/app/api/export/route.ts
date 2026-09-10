import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getReportData } from "@/lib/report/data";
import { renderSectionsPdf } from "@/lib/report/pdf";
import { renderSectionsExcel } from "@/lib/report/excel";
import { todayIso } from "@/lib/format";

const NAMES: Record<string, string> = {
  exec: "Executive_Summary",
  movement: "Movement_since_previous_report",
  minutes: "Minutes_of_Meeting",
  level1: "Cost_Report_Level_1",
  level2: "Cost_Report_Level_2",
  cashflow: "Cash_Flow",
  claims_report: "Claims_Status_Report",
  fa_report: "Final_Account_Status_Report",
};

/** GET /api/export?section=exec|movement|level1|level2|cashflow|<schedule letter>|<register>&format=pdf|xlsx[&period=ID] */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
    const url = new URL(req.url);
    const periodId = Number(url.searchParams.get("period") || app.period?.id || 0);
    if (!periodId) return NextResponse.json({ error: "Choose a reporting period." }, { status: 400 });
    const sections = (url.searchParams.get("section") ?? "exec").split(",").map((s) => s.trim()).filter(Boolean);
    const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";
    const data = getReportData(app.programme.id, periodId);
    const name = sections.map((s) => NAMES[s] ?? s.replace(/[^A-Za-z0-9]+/g, "_")).join("_");
    const base = `${name}_${app.programme.code}_No${data.period.report_no}_${todayIso()}${data.locked ? "" : "_DRAFT"}`;
    if (format === "xlsx") {
      const buffer = await renderSectionsExcel(data, sections);
      return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
    }
    const buffer = await renderSectionsPdf(data, sections);
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  })(req, ctx);
}
