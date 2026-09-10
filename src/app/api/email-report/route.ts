import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getReportData } from "@/lib/report/data";
import { renderSectionsPdf } from "@/lib/report/pdf";
import { buildEmailSummary, buildEml } from "@/lib/report/email";
import { buildClaimsEmail, buildFaEmail } from "@/lib/report/email-sections";
import { todayIso } from "@/lib/format";

/**
 * GET /api/email-report?format=json        -> the summary (subject, recipients, html, text) for the preview
 * GET /api/email-report?format=eml         -> an .eml draft with the summary as body and the three PDFs attached;
 * Optional &kind=exec|claims|final_accounts (claims / final accounts attach their own status report PDF).
 *                                             Outlook opens it as an unsent message ready to send.
 * Optional &period=ID (defaults to the period in the top bar).
 */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
    const url = new URL(req.url);
    const periodId = Number(url.searchParams.get("period") || app.period?.id || 0);
    if (!periodId) return NextResponse.json({ error: "Choose a reporting period." }, { status: 400 });
    const data = getReportData(app.programme.id, periodId);
    const kind = url.searchParams.get("kind") ?? "exec";
    const summary = kind === "claims" ? buildClaimsEmail(data, user) : kind === "final_accounts" ? buildFaEmail(data, user) : buildEmailSummary(data, { name: user.name, email: user.email });
    if (url.searchParams.get("format") !== "eml") return NextResponse.json(summary);

    const suffix = `${app.programme.code}_No${data.period.report_no}_${todayIso()}${data.locked ? "" : "_DRAFT"}`;
    const pdf = async (section: string, name: string) => ({ filename: `${name}_${suffix}.pdf`, contentType: "application/pdf", data: await renderSectionsPdf(data, [section]) });
    const attachments =
      kind === "claims"
        ? [await pdf("claims_report", "Claims_Status_Report")]
        : kind === "final_accounts"
          ? [await pdf("fa_report", "Final_Account_Status_Report")]
          : [await pdf("exec", "Executive_Summary"), await pdf("level1", "Cost_Report_Level_1"), await pdf("level2", "Cost_Report_Level_2")];
    const eml = buildEml({ from: user.email ? `${user.name} <${user.email}>` : undefined, to: summary.to, subject: summary.subject, html: summary.html, text: summary.text, attachments });
    return new Response(eml, {
      headers: { "Content-Type": "message/rfc822", "Content-Disposition": `attachment; filename="${summary.fileBase}.eml"` },
    });
  })(req, ctx);
}
