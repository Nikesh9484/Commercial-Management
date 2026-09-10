import type { ReportData } from "./data";
import { executiveTotals } from "../cost-report/executive";
import { formatDate, formatMoney } from "../format";

/**
 * "Email the Report": a short summary (table + text) of the month, ready to paste into or open as an
 * email, plus an .eml builder that Outlook opens as an unsent draft with the PDFs attached.
 */
export interface EmailSummary {
  subject: string;
  to: string[];
  html: string;
  text: string;
  fileBase: string;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => formatMoney(n);
const signed = (n: number) => (Math.abs(n) < 0.005 ? "–" : `${n > 0 ? "+" : ""}${formatMoney(n)}`);
const pad = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);

export function buildEmailSummary(data: ReportData, sender: { name: string; email: string }): EmailSummary {
  const g = executiveTotals(data.costReport);
  const m = data.movement;
  const d = data.dashboard;
  const prevLabel = m?.previous?.label ?? null;
  const kpi = (k: string) => m?.kpis.find((x) => x.key === k);
  const rows: { label: string; prev: number | null; now: number; delta: number | null }[] = [
    ["E", "Approved Baseline Budget"],
    ["G", "Latest Budget (incl. transfers)"],
    ["I", "Committed Costs"],
    ["J", "Potential VOs"],
    ["K", "Requests for Change"],
    ["L", "Early Warnings"],
    ["M", "Claims"],
    ["N", "Anticipated Final Account"],
    ["O", "Variance to Latest Budget"],
    ["P", "Certified to Date"],
    ["Q", "Works to Complete"],
  ].map(([k, label]) => {
    const x = kpi(k);
    return { label: `${k}  ${label}`, prev: prevLabel && x ? x.prev : null, now: g[k as keyof typeof g], delta: prevLabel && x ? x.delta : null };
  });

  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;
  const title = `${data.period.label} – ${assetName}`;
  const subject = `${data.programme.code} · ${assetName} · ${data.period.label} – Commercial summary${data.locked ? "" : " (draft)"}`;
  const cutOff = formatDate(data.period.period_end);

  // Key movements: the biggest items per cost-report column
  const keyMoves: { col: string; label: string; total: number; items: string[] }[] = [];
  if (m?.previous) {
    for (const k of m.keyMovements) {
      if (!k.items.length && Math.abs(k.kpiDelta) < 0.5) continue;
      keyMoves.push({ col: k.col, label: k.label, total: k.kpiDelta, items: k.items.slice(0, 4).map((it) => `${it.key} ${it.title}${it.note ? ` (${it.note})` : ""}: ${signed(it.delta)}`) });
    }
  }
  const overdueDvo = m?.dvoAgeing.find((b) => b.bucket.startsWith("Overdue"))?.now ?? 0;
  const certPeriod = m ? m.payments.reduce((t, r) => t + r.certifiedPeriod, 0) : 0;
  const late = m ? m.payments.reduce((t, r) => t + r.lateIpcs + r.latePayments, 0) : 0;
  const openItems = [
    `Open changes: ${d.openStages.map((s) => `${s.stage} ${s.open}`).join(", ")} (${d.openChanges} open in total${overdueDvo ? `; ${overdueDvo} DVO(s) pending over 90 days` : ""})`,
    `Open claims: ${d.openClaims} (${money(d.claimsPendingValue)} claimed and pending)`,
    `Open early warnings: ${d.openEarlyWarnings} (${money(d.ewOpenValue)} potential cost); open risks: ${d.openRisks}`,
    `Bonds & insurance: ${d.bonds.expired} expired, ${d.bonds.expiring.length} expiring within 60 days`,
    m ? `Payments: ${money(certPeriod)} certified this period across ${m.payments.length} contract(s); ${late} late IPC(s) / payment(s) against contract dates` : "",
  ].filter(Boolean);
  const keyIssues = (d.keyIssues ?? "").trim();
  const attachments = "Executive Summary, Cost Report Level 1 (Executive) and Cost Report Level 2 (Detailed)";

  // ---------- HTML
  const th = 'style="background:#0f2b4c;color:#fff;padding:6px 10px;text-align:left;font-size:12px"';
  const thr = th.replace("text-align:left", "text-align:right");
  const td = 'style="padding:5px 10px;border-bottom:1px solid #dfe5ee;font-size:12px"';
  const tdr = td.replace('font-size', 'text-align:right;font-family:Consolas,monospace;font-size');
  const bold = (k: string) => (["N", "O"].includes(k) ? "font-weight:bold;background:#eff6ff;" : "");
  const tableHtml = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dfe5ee;min-width:520px">
<tr><th ${th}>Cost report (SAR)</th>${prevLabel ? `<th ${thr}>${esc(prevLabel)}</th>` : ""}<th ${thr}>This report</th>${prevLabel ? `<th ${thr}>Movement</th>` : ""}</tr>
${rows
  .map((r) => {
    const k = r.label.slice(0, 1);
    const adverse = r.delta !== null && ((["N", "O", "J", "K", "L", "M"].includes(k) && r.delta > 0) || (["P"].includes(k) && r.delta < 0));
    return `<tr><td ${td.replace('"', `"${bold(k)}`)}>${esc(r.label)}</td>${prevLabel ? `<td ${tdr.replace('"', `"${bold(k)}`)}>${r.prev === null ? "" : money(r.prev)}</td>` : ""}<td ${tdr.replace('"', `"${bold(k)}`)}>${money(r.now)}</td>${prevLabel ? `<td ${tdr.replace('"', `"${bold(k)}${adverse ? "color:#b91c1c;" : r.delta && Math.abs(r.delta) >= 0.005 ? "color:#047857;" : ""}`)}>${r.delta === null ? "" : signed(r.delta)}</td>` : ""}</tr>`;
  })
  .join("\n")}
</table>`;
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">
<p>Dear all,</p>
<p>Please find attached the <b>${esc(attachments)}</b> for <b>${esc(title)}</b> (cut-off ${esc(cutOff)}${data.locked ? "" : ", draft from live data"}). The headline position is:</p>
${tableHtml}
<p style="margin:6px 0 0 0;font-size:11px;color:#6b7280">Budget columns include the budget hold; change and forecast columns exclude it. Variance to Latest Budget: negative = under budget.</p>
${
  keyMoves.length
    ? `<h3 style="font-size:14px;margin:16px 0 4px 0;color:#0f2b4c">Key movements since ${esc(prevLabel)}</h3><ul style="margin:0;padding-left:18px">${keyMoves
        .map((k) => `<li><b>${esc(k.col)} ${esc(k.label)}: ${esc(signed(k.total))}</b>${k.items.length ? `<ul style="margin:2px 0 4px 0;padding-left:16px">${k.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}</li>`)
        .join("")}</ul>`
    : prevLabel
      ? `<p><b>Key movements since ${esc(prevLabel)}:</b> no movement in the change, early warning or claim columns.</p>`
      : ""
}
<h3 style="font-size:14px;margin:16px 0 4px 0;color:#0f2b4c">Open items at cut-off</h3>
<ul style="margin:0;padding-left:18px">${openItems.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
${keyIssues ? `<h3 style="font-size:14px;margin:16px 0 4px 0;color:#0f2b4c">Key issues this period</h3><p style="white-space:pre-wrap">${esc(keyIssues)}</p>` : ""}
<p>Full detail is in the attached PDFs and on the Commercial Dashboard.</p>
<p>Kind regards,<br><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(assetName)}</p>
</div>`;

  // ---------- plain text
  const w = 34;
  const line = (r: (typeof rows)[number]) => `${r.label.padEnd(w)}${prevLabel ? pad(r.prev === null ? "" : money(r.prev), 20) : ""}${pad(money(r.now), 20)}${prevLabel ? pad(r.delta === null ? "" : signed(r.delta), 18) : ""}`;
  const text = [
    "Dear all,",
    "",
    `Please find attached the ${attachments} for ${title} (cut-off ${cutOff}${data.locked ? "" : ", draft from live data"}). The headline position is:`,
    "",
    `${"Cost report (SAR)".padEnd(w)}${prevLabel ? pad(prevLabel, 20) : ""}${pad("This report", 20)}${prevLabel ? pad("Movement", 18) : ""}`,
    ...rows.map(line),
    "",
    ...(keyMoves.length ? [`Key movements since ${prevLabel}:`, ...keyMoves.flatMap((k) => [`- ${k.col} ${k.label}: ${signed(k.total)}`, ...k.items.map((i) => `    · ${i}`)]), ""] : prevLabel ? [`Key movements since ${prevLabel}: no movement in the change, early warning or claim columns.`, ""] : []),
    "Open items at cut-off:",
    ...openItems.map((i) => `- ${i}`),
    "",
    ...(keyIssues ? ["Key issues this period:", keyIssues, ""] : []),
    "Full detail is in the attached PDFs and on the Commercial Dashboard.",
    "",
    "Kind regards,",
    sender.name,
    `Commercial Management – ${assetName}`,
  ].join("\r\n");

  const to = [...new Set(data.team.map((t) => String(t.email ?? "").trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  const fileBase = `Email_${data.programme.code}_No${data.period.report_no}${data.locked ? "" : "_DRAFT"}`;
  return { subject, to, html, text, fileBase };
}

/* ------------------------------------------------------------------ */
/* .eml builder                                                        */

export interface EmlAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

const b64 = (buf: Buffer) => buf.toString("base64").replace(/(.{76})/g, "$1\r\n");
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/**
 * Builds an RFC 822 message. "X-Unsent: 1" makes Outlook for Windows open the file in compose mode
 * (an unsent draft with the attachments in place) instead of as a received message.
 */
export function buildEml(opts: { from?: string; to: string[]; subject: string; html: string; text: string; attachments: EmlAttachment[] }): string {
  const mixed = `mixed_${Date.now().toString(36)}`;
  const alt = `alt_${Date.now().toString(36)}`;
  const lines: string[] = [];
  if (opts.from) lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to.join(", ")}`);
  lines.push(`Subject: ${encWord(opts.subject)}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push("X-Unsent: 1");
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
  lines.push("");
  lines.push(`--${mixed}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
  lines.push("");
  lines.push(`--${alt}`);
  lines.push('Content-Type: text/plain; charset="utf-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(b64(Buffer.from(opts.text, "utf8")));
  lines.push(`--${alt}`);
  lines.push('Content-Type: text/html; charset="utf-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(b64(Buffer.from(`<html><body>${opts.html}</body></html>`, "utf8")));
  lines.push(`--${alt}--`);
  for (const a of opts.attachments) {
    lines.push(`--${mixed}`);
    lines.push(`Content-Type: ${a.contentType}; name="${a.filename}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    lines.push("");
    lines.push(b64(a.data));
  }
  lines.push(`--${mixed}--`);
  lines.push("");
  return lines.join("\r\n");
}
