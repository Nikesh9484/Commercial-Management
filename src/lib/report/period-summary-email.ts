import type { ReportData } from "./data";
import type { EmailSummary } from "./email";
import { buildPeriodSummary, sar, sarMove, type PeriodSummary } from "./period-summary";

/**
 * The Period Summary as an email: the same wording the directors receive each month –
 * projected cost to complete, budget position, forecast movement analysis, change status and the
 * items behind every movement – as HTML for Outlook and as plain text for phones and copy/paste.
 */
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tone = (n: number | null) => (n === null ? "" : n > 0.5 ? "color:#b91c1c;" : n < -0.5 ? "color:#047857;" : "");

export function buildPeriodSummaryEmail(data: ReportData, sender: { name: string; email?: string }): EmailSummary {
  const ps = buildPeriodSummary(data, { name: sender.name });
  const to = [...new Set(data.team.map((t) => String(t.email ?? "").trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  const h3 = 'style="font-size:14px;margin:16px 0 4px 0;color:#0f2b4c"';
  const td = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px"';
  const tdr = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;text-align:right;font-family:Consolas,monospace"';
  const tbl = 'cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:460px"';
  const row = (label: string, value: string, bold = false, color = "") =>
    `<tr><td ${td}${bold ? ' style="font-weight:bold;padding:4px 10px;border:1px solid #dfe5ee;font-size:12px"' : ""}>${esc(label)}</td><td ${tdr.replace('"', `"${bold ? "font-weight:bold;" : ""}${color}`)}>${esc(value)}</td></tr>`;

  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">
<p>Hi all,</p>
<p>Please find attached the latest Commercial Report for ${esc(ps.assetName)} for the period, together with a summary of the Key Period Movements.</p>
<h3 ${h3}>Projected Cost to Complete</h3>
<p style="margin:0">Previous Report${ps.previous ? ` (${esc(ps.previous.short)})` : ""}: <b>${ps.projected.prev === null ? "n/a" : esc(sar(ps.projected.prev))}</b><br>
Updated Position (${esc(ps.period.short)}): <b>${esc(sar(ps.projected.now))}</b></p>
<p style="margin:8px 0 4px 0;font-size:14px"><b>Net Movement: <span style="${tone(ps.projected.delta)}">${esc(sarMove(ps.projected.delta))}</span></b></p>
<p>${esc(ps.projected.narrative)}</p>
<h3 ${h3}>Budget Position</h3>
<table ${tbl}>${row("Current Forecast", sar(ps.budget.forecast))}${row("Approved Budget", sar(ps.budget.approved))}${row(`Variance (${ps.budget.verdict})`, `${sarMove(ps.budget.variance)} · ${ps.budget.variancePct.toFixed(2)}%`, true, tone(ps.budget.variance))}</table>
<p style="font-size:11px;color:#4b5563;font-style:italic;margin:4px 0 0 0">Note: ${esc(ps.budget.note)}</p>
${
  ps.hasComparison
    ? `<h3 ${h3}>Forecast Movement Analysis</h3>
<table ${tbl}>${ps.movement.rows.map((r) => row(r.label, sarMove(r.value))).join("")}${row("NET FORECAST MOVEMENT", sarMove(ps.movement.net), true, tone(ps.movement.net))}</table>`
    : ""
}
${
  ps.status.length
    ? `<h3 ${h3}>Key Period Movements</h3>
<p style="margin:0 0 4px 0;font-style:italic">Change Management – Monthly Status Summary</p>
<table ${tbl}><tr><th ${td.replace("font-size", "background:#eef2f7;font-size")}>Category</th><th ${td.replace("font-size", "background:#eef2f7;font-size")}>Position Last Month</th><th ${td.replace("font-size", "background:#eef2f7;font-size")}>Movement</th><th ${td.replace("font-size", "background:#eef2f7;font-size")}>Current Outstanding</th></tr>
${ps.status.map((s) => `<tr><td ${td}>${esc(s.label)}</td><td ${tdr}>${s.prev} pending</td><td ${tdr}>${s.delta > 0 ? "+" : ""}${s.delta}</td><td ${tdr}>${s.now} pending</td></tr>`).join("")}</table>`
    : ""
}
${
  ps.hasComparison && ps.categories.length
    ? `<p style="margin:12px 0 4px 0"><b>Key Period Movements by Category (Value)</b></p><ul style="margin:0;padding-left:18px">${ps.categories.map((c) => `<li>${esc(c.label)}: <b style="${tone(c.total)}">${esc(sarMove(c.total))}</b></li>`).join("")}</ul>` +
      ps.categories
        .map(
          (c) => `<h3 ${h3}>${esc(c.label)} – ${esc(sarMove(c.total))}</h3><p style="margin:0 0 4px 0">${esc(c.narrative)}</p>${c.groups
            .map((g) => `<p style="margin:6px 0 2px 0"><b>${esc(g.heading)}:</b></p><ul style="margin:0;padding-left:18px">${g.items.map((it) => `<li>${esc(it.title.trim() || it.key)}${it.party ? ` [${esc(it.party.toUpperCase())}]` : ""} – ${esc(it.key)}: <span style="${tone(it.delta)}">${esc(sarMove(it.delta))}</span></li>`).join("")}</ul>`)
            .join("")}`,
        )
        .join("")
    : ""
}
<p style="margin-top:14px">Please let me know if you have any questions.</p>
<p>Kind regards,</p>
</div>`;

  const lines: string[] = [
    "Hi all,",
    "",
    `Please find attached the latest Commercial Report for ${ps.assetName} for the period, together with a summary of the Key Period Movements.`,
    "",
    "Projected Cost to Complete",
    `Previous Report${ps.previous ? ` (${ps.previous.short})` : ""}: ${ps.projected.prev === null ? "n/a" : sar(ps.projected.prev)}`,
    `Updated Position (${ps.period.short}): ${sar(ps.projected.now)}`,
    `Net Movement: ${sarMove(ps.projected.delta)}`,
    ps.projected.narrative,
    "",
    "Budget Position",
    `Current Forecast: ${sar(ps.budget.forecast)}`,
    `Approved Budget: ${sar(ps.budget.approved)}`,
    `Variance (${ps.budget.verdict}): ${sarMove(ps.budget.variance)} · ${ps.budget.variancePct.toFixed(2)}%`,
    `Note: ${ps.budget.note}`,
  ];
  if (ps.hasComparison) {
    lines.push("", "Forecast Movement Analysis");
    for (const r of ps.movement.rows) lines.push(`${r.label}: ${sarMove(r.value)}`);
    lines.push(`NET FORECAST MOVEMENT: ${sarMove(ps.movement.net)}`);
  }
  if (ps.status.length) {
    lines.push("", "Key Period Movements – Change Management Monthly Status");
    for (const s of ps.status) lines.push(`${s.label}: ${s.prev} pending → ${s.delta > 0 ? "+" : ""}${s.delta} → ${s.now} pending`);
  }
  if (ps.hasComparison && ps.categories.length) {
    lines.push("", "Key Period Movements by Category (Value)");
    for (const c of ps.categories) lines.push(`${c.label}: ${sarMove(c.total)}`);
    for (const c of ps.categories) {
      lines.push("", `${c.label} – ${sarMove(c.total)}`, c.narrative);
      for (const g of c.groups) {
        lines.push(`${g.heading}:`);
        for (const it of g.items) lines.push(`  - ${it.title.trim() || it.key}${it.party ? ` [${it.party.toUpperCase()}]` : ""} – ${it.key}: ${sarMove(it.delta)}`);
      }
    }
  }
  lines.push("", "Please let me know if you have any questions.", "", "Kind regards,");
  const text = lines.join("\r\n");
  return { subject: ps.subject, to, html, text, fileBase: `Period_Summary_${data.programme.code}_No${data.period.report_no}${data.locked ? "" : "_DRAFT"}` };
}

export type { PeriodSummary };
