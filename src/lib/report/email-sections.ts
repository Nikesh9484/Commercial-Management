import type { ReportData } from "./data";
import type { EmailSummary } from "./email";
import { buildClaimsReport } from "./claims-report";
import { buildFaReport } from "./fa-report";
import { formatDate, formatMoney } from "../format";
import { APP_NAME } from "../brand";

/** Emails for the Claims Status Report and the Final Account Status Report (same shape as the executive email). */
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const H3 = 'style="font-size:14px;margin:16px 0 4px 0;color:#0f2b4c"';

interface Section {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

function render(opts: { data: ReportData; sender: { name: string }; reportName: string; subjectTag: string; fileTag: string; kpis: [string, string][]; sections: Section[] }): EmailSummary {
  const { data, sender } = opts;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;
  const title = `${data.period.label} – ${assetName}`;
  const cutOff = formatDate(data.period.period_end);
  const th = 'style="background:#0f2b4c;color:#fff;padding:6px 10px;text-align:left;font-size:12px"';
  const td = 'style="padding:5px 10px;border-bottom:1px solid #dfe5ee;font-size:12px"';
  const tdr = 'style="padding:5px 10px;border-bottom:1px solid #dfe5ee;font-size:12px;text-align:right;font-family:Consolas,monospace"';
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">
<p>Dear all,</p>
<p>Please find attached the <b>${esc(opts.reportName)}</b> for <b>${esc(title)}</b> (cut-off ${esc(cutOff)}${data.locked ? "" : ", draft from live data"}). In summary:</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dfe5ee;min-width:420px">
<tr><th ${th}>Measure</th><th ${th.replace("text-align:left", "text-align:right")}>Value</th></tr>
${opts.kpis.map(([k, v]) => `<tr><td ${td}>${esc(k)}</td><td ${tdr}>${esc(v)}</td></tr>`).join("\n")}
</table>
${opts.sections
  .map(
    (s) =>
      `<h3 ${H3}>${esc(s.heading)}</h3>${(s.paragraphs ?? []).map((p) => `<p style="margin:4px 0">${esc(p)}</p>`).join("")}${
        s.bullets?.length ? `<ul style="margin:4px 0;padding-left:18px">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""
      }`,
  )
  .join("\n")}
<p>Full detail is in the attached PDF and on ${esc(APP_NAME)}.</p>
<p>Kind regards,<br><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(assetName)}</p>
</div>`;
  const w = 40;
  const text = [
    "Dear all,",
    "",
    `Please find attached the ${opts.reportName} for ${title} (cut-off ${cutOff}${data.locked ? "" : ", draft from live data"}). In summary:`,
    "",
    ...opts.kpis.map(([k, v]) => `${k.padEnd(w)}${v}`),
    "",
    ...opts.sections.flatMap((s) => [s.heading + ":", ...(s.paragraphs ?? []), ...(s.bullets ?? []).map((b) => `- ${b}`), ""]),
    `Full detail is in the attached PDF and on ${APP_NAME}.`,
    "",
    "Kind regards,",
    sender.name,
    `Commercial Management – ${assetName}`,
  ].join("\r\n");
  const to = [...new Set(data.team.map((t) => String(t.email ?? "").trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  return {
    subject: `${data.programme.code} · ${assetName} · ${data.period.label} – ${opts.subjectTag}${data.locked ? "" : " (draft)"}`,
    to,
    html,
    text,
    fileBase: `Email_${opts.fileTag}_${data.programme.code}_No${data.period.report_no}${data.locked ? "" : "_DRAFT"}`,
  };
}

export function buildClaimsEmail(data: ReportData, sender: { name: string }): EmailSummary {
  const r = buildClaimsReport(data);
  const h = r.headline;
  return render({
    data,
    sender,
    reportName: "Claims Status Report",
    subjectTag: "Claims status",
    fileTag: "Claims",
    kpis: [
      ["Claims recorded", `${h.total} (${h.pending} pending, ${h.approved} determined, ${h.rejected} rejected)`],
      ["Claimed (SAR)", formatMoney(h.claimedSar)],
      ["Determined (SAR)", `${formatMoney(h.determinedSar)} (${h.claimedSar ? Math.round((h.determinedSar / h.claimedSar) * 100) : 0}%)`],
      ["EOT claimed / granted (days)", `${h.eotClaimed} / ${h.eotGranted}`],
      ["Open exposure (SAR)", formatMoney(h.pendingSar)],
      ["Carried in cost report (M)", formatMoney(h.costReportM)],
      ["Late notices / particulars", `${h.noticeLate} / ${h.detailLate}`],
      ["Disputes", String(h.disputes)],
    ],
    sections: [
      ...r.narrative.map((n) => ({ heading: n.heading, paragraphs: [n.text] })),
      ...(r.movement && r.movement.items.length ? [{ heading: r.movement.label, bullets: r.movement.items }] : []),
      ...(r.attention.length ? [{ heading: "Items requiring attention", bullets: r.attention }] : []),
    ],
  });
}

export function buildFaEmail(data: ReportData, sender: { name: string }): EmailSummary {
  const r = buildFaReport(data);
  const h = r.headline;
  return render({
    data,
    sender,
    reportName: "Final Account Status Report",
    subjectTag: "Final account status",
    fileTag: "Final_Accounts",
    kpis: [
      ["Packages tracked", String(h.total)],
      ["Open", `${h.open} (SAR ${formatMoney(h.openValue)})`],
      ["Closed – FAS signed", `${h.closed} (SAR ${formatMoney(h.closedValue)})`],
      ["Not required / direct payment", `${h.notRequired} (SAR ${formatMoney(h.notRequiredValue)})`],
      ["Total anticipated final account (SAR)", formatMoney(h.totalAfa)],
      ["Uncommitted on open packages (SAR)", formatMoney(h.uncommittedOpen)],
      ["Past forecast closure date", String(h.overdue)],
      ["Due within 60 days", String(h.dueSoon)],
    ],
    sections: [
      ...r.narrative.map((n) => ({ heading: n.heading, paragraphs: [n.text] })),
      ...(r.movement && r.movement.items.length ? [{ heading: r.movement.label, bullets: r.movement.items }] : []),
      ...(r.attention.length ? [{ heading: "Items requiring attention", bullets: r.attention }] : []),
    ],
  });
}
