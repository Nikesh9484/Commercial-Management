import type { ReportData } from "./data";
import type { EmailSummary } from "./email";
import { buildClaimsReport, type ClaimLine } from "./claims-report";
import { buildFaReport, type FaLine } from "./fa-report";
import { formatDate, formatMoney } from "../format";
import { APP_NAME } from "../brand";

/**
 * Emails for the Claims Status Report and the Final Account Status Report: a navy header, headline
 * tiles, a short executive summary, the key tables, movement, attention items and a by-contractor
 * summary. Built with plain tables and inline styles so Outlook renders them faithfully.
 */
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const NAVY = "#0f2b4c";
const MUTED = "#5b6577";
const LINE = "#d9dee8";

type Cell = string | number | null | undefined;
interface Column {
  label: string;
  align?: "left" | "right";
  width?: string;
  money?: boolean;
  tone?: (v: Cell, row: Cell[]) => string | undefined; // background colour
}
interface Table {
  title: string;
  note?: string;
  columns: Column[];
  rows: Cell[][];
  total?: Cell[];
}
interface Tile {
  label: string;
  value: string;
  note?: string;
  tone?: "navy" | "green" | "amber" | "red";
}
interface Section {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  bulletTone?: "normal" | "warn";
  table?: Table;
}

const TILE_INK: Record<NonNullable<Tile["tone"]>, string> = { navy: NAVY, green: "#047857", amber: "#b45309", red: "#b91c1c" };

function tilesHtml(tiles: Tile[]): string {
  const rows: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += 4) rows.push(tiles.slice(i, i + 4));
  return `<table cellspacing="0" cellpadding="0" width="100%" style="border-collapse:separate;border-spacing:6px 6px;margin:0 -6px">${rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (t) =>
              `<td width="25%" valign="top" style="border:1px solid ${LINE};border-top:3px solid ${TILE_INK[t.tone ?? "navy"]};border-radius:6px;padding:8px 10px;background:#ffffff"><div style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">${esc(t.label)}</div><div style="font-size:17px;font-weight:bold;color:${TILE_INK[t.tone ?? "navy"]};margin-top:2px;white-space:nowrap">${esc(t.value)}</div>${t.note ? `<div style="font-size:10px;color:${MUTED};margin-top:2px">${esc(t.note)}</div>` : ""}</td>`,
          )
          .join("")}${r.length < 4 ? `<td colspan="${4 - r.length}"></td>` : ""}</tr>`,
    )
    .join("")}</table>`;
}

function tableHtml(t: Table): string {
  const th = (c: Column) => `<th style="background:${NAVY};color:#fff;padding:6px 8px;font-size:11px;text-align:${c.align ?? "left"};${c.width ? `width:${c.width};` : ""}white-space:nowrap">${esc(c.label)}</th>`;
  const fmt = (c: Column, v: Cell) => (v === null || v === undefined || v === "" ? "" : c.money && typeof v === "number" ? formatMoney(v) : esc(v));
  const td = (c: Column, v: Cell, row: Cell[], zebra: boolean) => {
    const bg = c.tone?.(v, row) ?? (zebra ? "#f6f8fb" : "#ffffff");
    return `<td style="padding:5px 8px;border-bottom:1px solid ${LINE};font-size:11px;vertical-align:top;background:${bg};text-align:${c.align ?? "left"};${c.money || c.align === "right" ? "font-family:Consolas,monospace;white-space:nowrap;" : ""}">${fmt(c, v)}</td>`;
  };
  return `<h3 style="font-size:14px;margin:18px 0 2px 0;color:${NAVY}">${esc(t.title)}</h3>${t.note ? `<div style="font-size:11px;color:${MUTED};margin:0 0 6px 0">${esc(t.note)}</div>` : ""}<table cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;border:1px solid ${LINE}"><tr>${t.columns.map(th).join("")}</tr>${
    t.rows.length ? t.rows.map((r, i) => `<tr>${t.columns.map((c, j) => td(c, r[j], r, i % 2 === 1)).join("")}</tr>`).join("") : `<tr><td colspan="${t.columns.length}" style="padding:8px;font-size:11px;color:${MUTED}">None.</td></tr>`
  }${
    t.total ? `<tr>${t.columns.map((c, j) => `<td style="padding:6px 8px;border-top:2px solid ${NAVY};background:#e8eef7;font-weight:bold;font-size:11px;text-align:${c.align ?? "left"};${c.money ? "font-family:Consolas,monospace;" : ""}">${fmt(c, t.total![j])}</td>`).join("")}</tr>` : ""
  }</table>`;
}

function tableText(t: Table): string[] {
  const widths = t.columns.map((c, j) => Math.min(c.money ? 18 : 40, Math.max(c.label.length, ...t.rows.map((r) => String(r[j] ?? "").length), ...(t.total ? [String(t.total[j] ?? "").length] : []))));
  const cell = (c: Column, v: Cell, j: number) => {
    const s = v === null || v === undefined ? "" : c.money && typeof v === "number" ? formatMoney(v) : String(v).replace(/\s+/g, " ").slice(0, widths[j]);
    return c.align === "right" || c.money ? s.padStart(widths[j]) : s.padEnd(widths[j]);
  };
  const line = (r: Cell[]) => t.columns.map((c, j) => cell(c, r[j], j)).join("  ");
  return [t.title.toUpperCase(), ...(t.note ? [t.note] : []), line(t.columns.map((c) => c.label)), "-".repeat(Math.min(110, widths.reduce((a, b) => a + b + 2, 0))), ...(t.rows.length ? t.rows.map(line) : ["None."]), ...(t.total ? [line(t.total)] : []), ""];
}

function render(opts: { data: ReportData; sender: { name: string }; reportName: string; subjectTag: string; fileTag: string; tiles: Tile[]; summary: string[]; sections: Section[] }): EmailSummary {
  const { data, sender } = opts;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;
  const cutOff = formatDate(data.period.period_end);
  const draft = data.locked ? "" : " · DRAFT (period not locked)";
  const html = `<div style="font-family:Calibri,Segoe UI,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45;max-width:900px">
<table cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse"><tr><td style="background:${NAVY};color:#fff;padding:12px 16px;border-left:6px solid #2f80ed">
<div style="font-size:18px;font-weight:bold">${esc(opts.reportName)}</div>
<div style="font-size:12px;color:#cfe0f5;margin-top:2px">${esc(data.programme.code)} · ${esc(assetName)} · ${esc(data.period.label)} · cut-off ${esc(cutOff)}${esc(draft)}</div>
</td></tr></table>
<p style="margin:12px 0 6px 0">Dear all,</p>
<p style="margin:0 0 10px 0">Please find attached the <b>${esc(opts.reportName)}</b> for <b>${esc(data.period.label)}</b>. The position in brief:</p>
${tilesHtml(opts.tiles)}
<div style="margin:12px 0;padding:10px 12px;background:#f3f6fb;border-left:4px solid ${NAVY};font-size:12.5px">${opts.summary.map((p) => `<p style="margin:0 0 6px 0">${esc(p)}</p>`).join("")}</div>
${opts.sections
  .map((s) => {
    if (s.table) return tableHtml(s.table);
    const bul = s.bullets?.length ? `<ul style="margin:4px 0;padding-left:18px;${s.bulletTone === "warn" ? "color:#7c2d12;" : ""}">${s.bullets.map((b) => `<li style="margin-bottom:3px">${esc(b)}</li>`).join("")}</ul>` : "";
    const par = (s.paragraphs ?? []).map((p) => `<p style="margin:4px 0">${esc(p)}</p>`).join("");
    return `<h3 style="font-size:14px;margin:18px 0 4px 0;color:${NAVY}">${esc(s.heading)}</h3>${par}${bul}`;
  })
  .join("\n")}
<p style="margin:16px 0 4px 0;font-size:12px;color:${MUTED}">Full detail is in the attached PDF and on ${esc(APP_NAME)}.</p>
<p>Kind regards,<br><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(assetName)}</p>
</div>`;

  const text = [
    opts.reportName.toUpperCase(),
    `${data.programme.code} · ${assetName} · ${data.period.label} · cut-off ${cutOff}${draft}`,
    "",
    "Dear all,",
    "",
    `Please find attached the ${opts.reportName} for ${data.period.label}. The position in brief:`,
    "",
    ...opts.tiles.map((t) => `${t.label.padEnd(34)}${t.value}${t.note ? `  (${t.note})` : ""}`),
    "",
    ...opts.summary,
    "",
    ...opts.sections.flatMap((s) => (s.table ? tableText(s.table) : [s.heading.toUpperCase(), ...(s.paragraphs ?? []), ...(s.bullets ?? []).map((b) => `- ${b}`), ""])),
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

const money = (n: number) => formatMoney(n);
const sar = (n: number) => `SAR ${formatMoney(n)}`;
const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const daysTone = (v: Cell) => (typeof v === "number" ? (v > 90 ? "#fee2e2" : v > 45 ? "#fef3c7" : undefined) : undefined);
const statusTone = (v: Cell) => (v === "Pending" ? "#fef3c7" : v === "Rejected" ? "#fee2e2" : typeof v === "string" && v.startsWith("Approved") ? "#dcfce7" : undefined);

/* ------------------------------------------------------------------ claims */
export function buildClaimsEmail(data: ReportData, sender: { name: string }): EmailSummary {
  const r = buildClaimsReport(data);
  const h = r.headline;
  const pending = r.claims.filter((c) => c.status === "Pending");
  const closed = r.claims.filter((c) => c.status !== "Pending");
  const prevLabel = data.movement?.previous?.label ?? null;
  const top = pending[0];
  const stale = pending.filter((c) => (c.daysSinceReceipt ?? 0) > 90).length;
  const pct = h.claimedSar ? Math.round((h.determinedSar / h.claimedSar) * 100) : 0;

  const summary = [
    r.claims.length === 0
      ? `No contractor claims are recorded as at ${formatDate(r.asOf)}.`
      : `${h.total} claims from ${h.contractors} contractor(s): ${h.pending} pending, ${h.approved} determined and ${h.rejected} rejected. Contractors have claimed ${sar(h.claimedSar)} and ${h.eotClaimed} days; ${sar(h.determinedSar)} (${pct}%) and ${h.eotGranted} days have been determined.`,
    ...(top && top.claimedSar > 0 ? [`Largest open exposure: ${top.claim_no} ${top.contractor}, ${sar(top.claimedSar)}${top.eotClaimed ? ` and ${top.eotClaimed} days` : ""}, ${top.stage.toLowerCase()}, action with ${top.actionWith}.`] : []),
    ...(r.movement ? [r.movement.items.length ? `Since ${prevLabel}: ${r.movement.items.length} claim(s) new or changed (listed below); the claims column of the cost report moved by ${(() => { const k = data.movement?.keyMovements.find((x) => x.col === "M"); return k && Math.abs(k.kpiDelta) >= 0.005 ? `${k.kpiDelta > 0 ? "+" : ""}${money(k.kpiDelta)}` : "nil"; })()}.` : `No movement in the claims register since ${prevLabel}.`] : []),
    `${h.pendingSar ? `Open claims carry a gross exposure of ${sar(h.pendingSar)}, of which ${sar(h.costReportM)} is in the cost report (column M); the rest is covered by the early warnings until determined.` : ""}${stale ? ` ${stale} pending claim(s) have been open for more than 90 days.` : ""}${h.disputes ? ` ${h.disputes} claim(s) carry a Notice of Dissatisfaction or Dispute.` : ""}`.trim(),
  ].filter(Boolean);

  const tiles: Tile[] = [
    { label: "Claims recorded", value: String(h.total), note: `${h.pending} pending · ${h.approved} determined · ${h.rejected} rejected` },
    { label: "Claimed (SAR)", value: money(h.claimedSar), note: `${h.eotClaimed} EOT days claimed` },
    { label: "Determined (SAR)", value: money(h.determinedSar), note: `${pct}% of value · ${h.eotGranted} days granted`, tone: "green" },
    { label: "Open exposure (SAR)", value: money(h.pendingSar), note: `${sar(h.costReportM)} in cost report (M)`, tone: h.pendingSar ? "amber" : "navy" },
    { label: "Pending > 90 days", value: String(stale), note: "assessment overdue", tone: stale ? "red" : "green" },
    { label: "Late notices / particulars", value: `${h.noticeLate} / ${h.detailLate}`, note: "later than 28 / 42 business days", tone: h.noticeLate + h.detailLate ? "amber" : "green" },
    { label: "Disputes", value: String(h.disputes), note: "Notice of Dissatisfaction / Dispute", tone: h.disputes ? "red" : "green" },
    { label: "Contractors with claims", value: String(h.contractors) },
  ];

  const openTable: Table = {
    title: `Open claims (${pending.length})`,
    note: "Largest first. Assessed = Employer's assessment, else Engineer's recommendation. Days = since the (detailed) claim was received.",
    columns: [
      { label: "Ref", width: "6%" },
      { label: "Contractor", width: "14%" },
      { label: "Claim", width: "28%" },
      { label: "Type", width: "8%" },
      { label: "Claimed SAR", align: "right", money: true },
      { label: "Assessed SAR", align: "right", money: true },
      { label: "EOT cl./gr.", align: "right" },
      { label: "Stage / next step", width: "16%" },
      { label: "Action with", width: "9%" },
      { label: "Days", align: "right", tone: daysTone },
    ],
    rows: pending.map((c: ClaimLine) => [c.claim_no, c.contractor, short(c.description), c.type, c.claimedSar || null, c.assessedSar, c.eotClaimed === null && c.eotGranted === null ? "" : `${c.eotClaimed ?? "–"} / ${c.eotGranted ?? "–"}`, c.stage, c.actionWith, c.daysSinceReceipt]),
    total: ["TOTAL", "", "", "", pending.reduce((t, c) => t + c.claimedSar, 0), pending.reduce((t, c) => t + (c.assessedSar ?? 0), 0), `${pending.reduce((t, c) => t + (c.eotClaimed ?? 0), 0)} / ${pending.reduce((t, c) => t + (c.eotGranted ?? 0), 0)}`, "", "", ""],
  };
  const closedTable: Table = {
    title: `Determined, agreed or rejected (${closed.length})`,
    columns: [
      { label: "Ref", width: "6%" },
      { label: "Contractor", width: "16%" },
      { label: "Claim", width: "34%" },
      { label: "Claimed SAR", align: "right", money: true },
      { label: "Determined SAR", align: "right", money: true },
      { label: "EOT cl./gr.", align: "right" },
      { label: "Status", tone: statusTone },
    ],
    rows: closed.map((c) => [c.claim_no, c.contractor, short(c.description), c.claimedSar || null, c.determinedSar, c.eotClaimed === null && c.eotGranted === null ? "" : `${c.eotClaimed ?? "–"} / ${c.eotGranted ?? "–"}`, c.status]),
    total: ["TOTAL", "", "", closed.reduce((t, c) => t + c.claimedSar, 0), closed.reduce((t, c) => t + (c.determinedSar ?? 0), 0), `${closed.reduce((t, c) => t + (c.eotClaimed ?? 0), 0)} / ${closed.reduce((t, c) => t + (c.eotGranted ?? 0), 0)}`, ""],
  };
  const byContractor: Table = {
    title: "By contractor",
    columns: [
      { label: "Contractor / consultant" },
      { label: "Claims", align: "right" },
      { label: "Pending", align: "right" },
      { label: "Claimed SAR", align: "right", money: true },
      { label: "Determined SAR", align: "right", money: true },
      { label: "EOT claimed", align: "right" },
      { label: "EOT granted", align: "right" },
    ],
    rows: r.byContractor.map((c) => [c.contractor, c.claims, c.pending, c.claimedSar, c.determinedSar, c.eotClaimed, c.eotGranted]),
  };
  const outlook = r.narrative.find((n) => n.heading.startsWith("Outlook"));
  const sections: Section[] = [
    { heading: "", table: openTable },
    ...(r.movement ? [{ heading: r.movement.label, bullets: r.movement.items.length ? r.movement.items : ["No movement in the claims register."] }] : []),
    ...(r.attention.length ? [{ heading: "Items requiring attention", bullets: r.attention, bulletTone: "warn" as const }] : []),
    ...(outlook ? [{ heading: "Recommended actions", paragraphs: [outlook.text] }] : []),
    { heading: "", table: closedTable },
    { heading: "", table: byContractor },
  ];
  return render({ data, sender, reportName: "Claims Status Report", subjectTag: "Claims status", fileTag: "Claims", tiles, summary, sections });
}

/* ------------------------------------------------------------------ final accounts */
export function buildFaEmail(data: ReportData, sender: { name: string }): EmailSummary {
  const r = buildFaReport(data);
  const h = r.headline;
  const open = r.rows.filter((x) => x.status === "Open");
  const rest = r.rows.filter((x) => x.status !== "Open");
  const prevLabel = data.movement?.previous?.label ?? null;
  const next = open.filter((x) => x.forecast && String(x.forecast) >= r.asOf).sort((a, b) => String(a.forecast).localeCompare(String(b.forecast)))[0];
  const summary = [
    r.rows.length === 0
      ? `No final accounts are recorded as at ${formatDate(r.asOf)}.`
      : `${h.total} packages tracked: ${h.open} open (${sar(h.openValue)}), ${h.closed} closed with the statement signed (${sar(h.closedValue)}) and ${h.notRequired} not requiring a final account (${sar(h.notRequiredValue)}). Total anticipated final account ${sar(h.totalAfa)}, of which ${sar(h.uncommittedOpen)} on open packages is still to be agreed.`,
    `${h.overdue ? `${h.overdue} package(s) are past their forecast closure date. ` : "No package is past its forecast closure date. "}${h.dueSoon ? `${h.dueSoon} due within 60 days. ` : ""}${next ? `Next closure forecast ${formatDate(next.forecast!)} (${next.acc_ref} ${next.contractor}). ` : ""}${h.noDate ? `${h.noDate} open package(s) have no forecast date.` : ""}`.trim(),
    ...(r.movement ? [r.movement.items.length ? `Since ${prevLabel}: ${r.movement.items.length} package(s) changed (listed below).` : `No change to the final account status since ${prevLabel}.`] : []),
  ];
  const tiles: Tile[] = [
    { label: "Packages tracked", value: String(h.total), note: `${h.open} open · ${h.closed} closed · ${h.notRequired} not required` },
    { label: "Open (SAR)", value: money(h.openValue), note: "anticipated final account", tone: "amber" },
    { label: "Closed – FAS signed (SAR)", value: money(h.closedValue), tone: "green" },
    { label: "Total anticipated FA (SAR)", value: money(h.totalAfa), note: "all tracked packages" },
    { label: "Uncommitted, open packages", value: money(h.uncommittedOpen), note: "still to be agreed", tone: h.uncommittedOpen > 0 ? "amber" : "green" },
    { label: "Past forecast closure", value: String(h.overdue), tone: h.overdue ? "red" : "green" },
    { label: "Due within 60 days", value: String(h.dueSoon), tone: h.dueSoon ? "amber" : "green" },
    { label: "No forecast date", value: String(h.noDate), note: "open packages", tone: h.noDate ? "amber" : "green" },
  ];
  const daysTone2 = (v: Cell) => (typeof v === "number" ? (v < 0 ? "#fee2e2" : v <= 60 ? "#fef3c7" : undefined) : undefined);
  const openTable: Table = {
    title: `Open final accounts (${open.length})`,
    note: "Earliest forecast closure first. Committed and anticipated final account are read from the cost report.",
    columns: [
      { label: "ACC code", width: "9%" },
      { label: "Package", width: "24%" },
      { label: "Contractor", width: "18%" },
      { label: "Committed (I)", align: "right", money: true },
      { label: "Anticipated FA (N)", align: "right", money: true },
      { label: "Uncommitted", align: "right", money: true },
      { label: "Responsible", width: "10%" },
      { label: "Forecast", width: "8%" },
      { label: "Days", align: "right", tone: daysTone2 },
    ],
    rows: open.map((x: FaLine) => [x.acc_ref, short(x.description, 50), x.contractor, x.committed, x.afa, x.uncommitted, x.responsible, x.forecast ? formatDate(x.forecast) : "TBC", x.daysRemaining]),
    total: ["TOTAL", "", "", open.reduce((t, x) => t + x.committed, 0), open.reduce((t, x) => t + x.afa, 0), open.reduce((t, x) => t + x.uncommitted, 0), "", "", ""],
  };
  const restTable: Table = {
    title: `Closed and not required (${rest.length})`,
    columns: [
      { label: "ACC code", width: "9%" },
      { label: "Package", width: "30%" },
      { label: "Contractor", width: "22%" },
      { label: "Anticipated FA (N)", align: "right", money: true },
      { label: "Status", tone: (v) => (v === "Closed" ? "#dcfce7" : "#e5e7eb") },
      { label: "Closed / signed" },
    ],
    rows: rest.map((x) => [x.acc_ref, short(x.description, 50), x.contractor, x.afa, x.status, x.closedDate ? formatDate(x.closedDate) : ""]),
    total: ["TOTAL", "", "", rest.reduce((t, x) => t + x.afa, 0), "", ""],
  };
  const outlook = r.narrative.find((n) => n.heading.startsWith("Outlook"));
  const sections: Section[] = [
    { heading: "", table: openTable },
    ...(r.movement ? [{ heading: r.movement.label, bullets: r.movement.items.length ? r.movement.items : ["No change to the final account status."] }] : []),
    ...(r.attention.length ? [{ heading: "Items requiring attention", bullets: r.attention, bulletTone: "warn" as const }] : []),
    ...(outlook ? [{ heading: "Recommended actions", paragraphs: [outlook.text] }] : []),
    { heading: "", table: restTable },
  ];
  return render({ data, sender, reportName: "Final Account Status Report", subjectTag: "Final account status", fileTag: "Final_Accounts", tiles, summary, sections });
}
