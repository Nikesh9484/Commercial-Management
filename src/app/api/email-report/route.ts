import { NextResponse } from "next/server";
import { withHeavyLock } from "@/lib/workbook/heavy";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getReportData } from "@/lib/report/data";
import { renderSectionsPdf } from "@/lib/report/pdf";
import { buildEmailSummary, buildEml } from "@/lib/report/email";
import { buildClaimsEmail, buildFaEmail } from "@/lib/report/email-sections";
import { buildPeriodSummaryEmail } from "@/lib/report/period-summary-email";
import { buildAccommodationEmail, buildCustomsEmail, buildCustomsManagementEmail } from "@/lib/report/recovery-email";
import { buildBondsNoticeEmail, bondsNoticeContractors, type BondsNoticeBucket } from "@/lib/report/bonds-email";
import JSZip from "jszip";
import { todayIso } from "@/lib/format";

/**
 * GET /api/email-report?format=json        -> the summary (subject, recipients, html, text) for the preview
 * GET /api/email-report?format=eml         -> an .eml draft with the summary as body and the three PDFs attached;
 * Optional &kind=exec|claims|final_accounts (claims / final accounts attach their own status report PDF).
 *                                             Outlook opens it as an unsent message ready to send.
 * Optional &period=ID (defaults to the period in the top bar).
 */
async function heavyGET(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
    const url = new URL(req.url);
    const periodId = Number(url.searchParams.get("period") || app.period?.id || 0);
    if (!periodId) return NextResponse.json({ error: "Choose a reporting period." }, { status: 400 });
    const data = getReportData(app.programme.id, periodId);
    const kind = url.searchParams.get("kind") ?? "exec";
    const bucket = (["expired", "d30", "d60"].includes(url.searchParams.get("bucket") ?? "") ? url.searchParams.get("bucket") : "expired") as BondsNoticeBucket;
    // bond notices go one per contractor: a whole category comes as a zip of .eml drafts, each with that contractor's bonds report attached
    if (kind === "bonds" && url.searchParams.get("format") === "eml" && !url.searchParams.get("contractor")) {
      const names = bondsNoticeContractors(data, bucket);
      if (!names.length) return NextResponse.json({ error: "There is nothing in this category at present." }, { status: 400 });
      const zip = new JSZip();
      const suffixB = `${app.programme.code}_No${data.period.report_no}_${todayIso()}`;
      for (const name of names) {
        const one = buildBondsNoticeEmail(data, user, bucket, name);
        const report = await renderSectionsPdf(data, ["bonds_report"], { bonds: { expiry: bucket, category: "all", contractor: name } });
        const eml = buildEml({ from: user.email ? `${user.name} <${user.email}>` : undefined, to: one.to, subject: one.subject, html: one.html, text: one.text, attachments: [{ filename: `Bonds_and_Insurance_${suffixB}.pdf`, contentType: "application/pdf", data: report }] });
        zip.file(`${one.fileBase}.eml`, eml);
      }
      const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const tag = bucket === "expired" ? "Expired" : bucket === "d30" ? "Expiring_30_days" : "Expiring_60_days";
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Bonds_Insurance_Notices_${tag}_${app.programme.code}_${todayIso()}.zip"` } });
    }
    const summary =
      kind === "claims"
        ? buildClaimsEmail(data, user)
        : kind === "final_accounts"
          ? buildFaEmail(data, user)
          : kind === "period_summary"
            ? buildPeriodSummaryEmail(data, user)
            : kind === "accommodation"
              ? buildAccommodationEmail(data, user, url.searchParams.get("contractor"))
              : kind === "customs"
                ? buildCustomsEmail(data, user, url.searchParams.get("contractor"))
                : kind === "customs_management"
                  ? buildCustomsManagementEmail(data, user)
                  : kind === "bonds"
                    ? buildBondsNoticeEmail(data, user, bucket, url.searchParams.get("contractor"))
                    : buildEmailSummary(data, { name: user.name, email: user.email });
    if (url.searchParams.get("format") !== "eml") return NextResponse.json(summary);

    const suffix = `${app.programme.code}_No${data.period.report_no}_${todayIso()}${data.locked ? "" : "_DRAFT"}`;
    const pdf = async (section: string, name: string) => ({ filename: `${name}_${suffix}.pdf`, contentType: "application/pdf", data: await renderSectionsPdf(data, [section]) });
    const attachments =
      kind === "claims"
        ? [await pdf("claims_report", "Claims_Status_Report")]
        : kind === "final_accounts"
          ? [await pdf("fa_report", "Final_Account_Status_Report")]
          : kind === "period_summary"
            ? [await pdf("period_summary", "Period_Summary_Key_Movements"), await pdf("exec", "Executive_Summary"), await pdf("level1", "Cost_Report_Level_1"), await pdf("level2", "Cost_Report_Level_2")]
            : kind === "customs_management"
              ? [await pdf("recovery_report", "Cost_Recovery_Report")]
              : kind === "bonds"
                ? [{ filename: `Bonds_and_Insurance_${suffix}.pdf`, contentType: "application/pdf", data: await renderSectionsPdf(data, ["bonds_report"], { bonds: { expiry: bucket, category: "all", contractor: url.searchParams.get("contractor") ?? "" } }) }]
              : kind === "accommodation" || kind === "customs"
                ? []
              : [await pdf("exec", "Executive_Summary"), await pdf("level1", "Cost_Report_Level_1"), await pdf("level2", "Cost_Report_Level_2")];
    const eml = buildEml({ from: user.email ? `${user.name} <${user.email}>` : undefined, to: summary.to, subject: summary.subject, html: summary.html, text: summary.text, attachments });
    return new Response(eml, {
      headers: { "Content-Type": "message/rfc822", "Content-Disposition": `attachment; filename="${summary.fileBase}.eml"` },
    });
  })(req, ctx);
}

/** Heavy work runs one request at a time and hands memory back afterwards (small hosting plan). */
export const GET: typeof heavyGET = (...args) => withHeavyLock(() => heavyGET(...args));
