import PDFDocument from "pdfkit";
import { formatDate, formatMoney } from "../format";
import { formattedValues } from "./word";
import { packRefLabel, type PackType, type PackValues } from "./shared";
import type { ChangeLogRow } from "./data";

/**
 * The RSG documents drawn by the dashboard, laid out as the approved packs are: the two-page PVO
 * form (RSG-CM-FRM-0013), the PVO-to-DVO movement summary with the DVO form (RSG-CM-FRM-0014) and
 * the review and recommendation form (RSG-CM-FRM-0027), the Request for Approval form
 * (RSG-PR-FRM-0004), the Employer's Assessment Report with its cover letter, the draft Variation
 * Order with its Employer's Instruction letter, the index of annexures, the budget particulars and
 * the change log. PDFKit, portrait A4, one pass with the footer written once the pages are known.
 */

const GRAPHITE = "#33383F";
const BRONZE = "#A8845C";
const INK = "#26292E";
const MUTED = "#6B6F75";
const LINE = "#C9CBCE";
const PALE = "#F2F2F0";
const SHADE = "#E4E5E3";
const W = 595.28;
const H = 841.89;
const M = 36;
const TW = W - M * 2;

export interface FormMeta {
  programme: { code: string; name: string };
  ref: string;
  title: string;
  revision: string;
  status: string;
  preparedBy: string;
  generatedAt: string;
}

/** A row of the ACC budget table, one per cost category of the project. */
export interface AccRow {
  category: string;
  budget: number;
  contract: number;
  dvos: number;
  commitments: number;
  pvos: number;
  thisPvo: number;
}

export interface FormExtras {
  acc: AccRow[];
  changeLog: ChangeLogRow[];
}

type Doc = InstanceType<typeof PDFDocument>;

interface Ctx {
  doc: Doc;
  type: PackType;
  v: Record<string, string>;
  raw: PackValues;
  meta: FormMeta;
  /** drawn on every page added while `headerOn` – also the pages PDFKit adds itself when a text runs over */
  header: (doc: Doc) => void;
  headerOn: boolean;
}

const num = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const sar = (n: number) => (n < 0 ? `(${formatMoney(-n)})` : formatMoney(n));
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : "-");
const dash = (s: string | undefined) => (s && s.trim() ? s : "-");

function newDoc(meta: FormMeta, title: string): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: title, Author: meta.preparedBy } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

function finish(ctx: Ctx) {
  ctx.headerOn = false;
  ctx.doc.end();
}

/** The RSG form header: form ref and revision left, classification and page right, the form title beneath. */
function rsgHeader(formRef: string, rev: string, title: string, subtitle?: string) {
  return (doc: Doc) => {
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(formRef, M, 22, { lineBreak: false });
    doc.text(rev, M, 31, { lineBreak: false });
    doc.text("Internal : Confidential", W - M - 160, 22, { width: 160, align: "right", lineBreak: false });
    doc.rect(M, 42, TW, 22).fill(GRAPHITE);
    doc.rect(M, 42, 4, 22).fill(BRONZE);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(11.5).text(title, M + 12, 48, { width: TW - 24, lineBreak: false });
    if (subtitle) doc.fillColor("#D8D9D6").font("Helvetica").fontSize(8).text(subtitle, W - M - 240, 50, { width: 228, align: "right", lineBreak: false });
    doc.y = 74;
  };
}

function ensure(ctx: Ctx, h: number) {
  if (ctx.doc.y + h > H - 44) ctx.doc.addPage();
}

/** A new page, with or without the running header. */
function newPage(ctx: Ctx, withHeader = true) {
  ctx.headerOn = withHeader;
  ctx.doc.addPage();
  ctx.headerOn = true;
}

function section(ctx: Ctx, title: string) {
  ensure(ctx, 30);
  const { doc } = ctx;
  doc.rect(M, doc.y, TW, 14).fill(SHADE);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text(title, M + 6, doc.y + 3, { width: TW - 12, lineBreak: false });
  doc.y += 14;
}

function cellText(ctx: Ctx, x: number, y: number, w: number, h: number, text: string, opts: { bold?: boolean; shade?: string; size?: number; align?: "left" | "right" | "center"; color?: string } = {}) {
  const { doc } = ctx;
  if (opts.shade) doc.rect(x, y, w, h).fill(opts.shade);
  doc.rect(x, y, w, h).lineWidth(0.4).stroke(LINE);
  const pad = (opts.size ?? 7.5) < 6 ? 2 : 4;
  doc.fillColor(opts.color ?? INK).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 7.5).text(text || "", x + pad, y + 3, { width: w - pad * 2, height: h - 4, align: opts.align ?? "left" });
}

function textHeight(ctx: Ctx, text: string, w: number, size = 7.5, bold = false): number {
  const pad = size < 6 ? 2 : 4;
  return ctx.doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).heightOfString(text || " ", { width: w - pad * 2 }) + 6;
}

/** Label / value pairs laid out in `cols` columns (label cell shaded). */
function kv(ctx: Ctx, pairs: [string, string][], cols = 2, labelRatio = 0.38) {
  const { doc } = ctx;
  const colW = TW / cols;
  const lw = Math.round(colW * labelRatio);
  const vw = colW - lw;
  for (let i = 0; i < pairs.length; i += cols) {
    const row = pairs.slice(i, i + cols);
    const h = Math.max(13, ...row.map(([l, v]) => Math.max(textHeight(ctx, l, lw, 7.5, true), textHeight(ctx, v, vw))));
    ensure(ctx, h);
    let x = M;
    const y = doc.y;
    for (const [l, v] of row) {
      cellText(ctx, x, y, lw, h, l, { bold: true, shade: PALE });
      cellText(ctx, x + lw, y, vw, h, v);
      x += colW;
    }
    if (row.length < cols) doc.rect(x, y, TW - (x - M), h).lineWidth(0.4).stroke(LINE);
    doc.y = y + h;
  }
}

/** A labelled block of text spanning the width. */
function block(ctx: Ctx, label: string, text: string, minH = 30) {
  const { doc } = ctx;
  const h = Math.max(minH, textHeight(ctx, text, TW, 8));
  ensure(ctx, 14 + Math.min(h, 500));
  cellText(ctx, M, doc.y, TW, 13, label, { bold: true, shade: PALE });
  doc.y += 13;
  if (h <= H - 44 - doc.y) {
    cellText(ctx, M, doc.y, TW, h, text, { size: 8 });
    doc.y += h;
  } else {
    // a long narrative runs on over the pages
    doc.rect(M, doc.y, TW, H - 44 - doc.y).lineWidth(0.4).stroke(LINE);
    doc.fillColor(INK).font("Helvetica").fontSize(8).text(text, M + 4, doc.y + 3, { width: TW - 8 });
    doc.y += 4;
  }
}

/** A table with a shaded header row; column widths as fractions of the width. */
function table(ctx: Ctx, headers: string[], rows: string[][], widths: number[], opts: { align?: ("left" | "right" | "center")[]; boldLast?: boolean; size?: number } = {}) {
  const { doc } = ctx;
  const total = widths.reduce((a, b) => a + b, 0);
  const ws = widths.map((w) => (w / total) * TW);
  const size = opts.size ?? 7.5;
  const draw = (cells: string[], bold: boolean, shade?: string) => {
    const h = Math.max(14, ...cells.map((c, i) => textHeight(ctx, c, ws[i], size, bold)));
    ensure(ctx, h);
    let x = M;
    const y = doc.y;
    cells.forEach((c, i) => {
      cellText(ctx, x, y, ws[i], h, c, { bold, shade, size, align: opts.align?.[i] ?? (i === 0 ? "left" : "left") });
      x += ws[i];
    });
    doc.y = y + h;
  };
  draw(headers, true, PALE);
  rows.forEach((r, i) => draw(r, !!opts.boldLast && i === rows.length - 1, opts.boldLast && i === rows.length - 1 ? PALE : undefined));
}

/** Prepared / Checked / Approved with name, position, signature and date. */
function signatureBlock(ctx: Ctx, who: [string, string, string, string?][]) {
  const { doc } = ctx;
  ensure(ctx, 20 + who.length * 34);
  const cols = [0.2, 0.3, 0.26, 0.12, 0.12].map((w) => w * TW);
  let x = M;
  let y = doc.y;
  ["", "Name", "Position", "Signature", "Date"].forEach((h, i) => {
    cellText(ctx, x, y, cols[i], 13, h, { bold: true, shade: PALE });
    x += cols[i];
  });
  y += 13;
  for (const [label, name, position, note] of who) {
    x = M;
    const h = Math.max(26, textHeight(ctx, `${label}${note ? `\n${note}` : ""}`, cols[0], 6.8, true), textHeight(ctx, position, cols[2]));
    cellText(ctx, x, y, cols[0], h, `${label}${note ? `\n${note}` : ""}`, { bold: true, shade: PALE, size: 6.8 });
    x += cols[0];
    cellText(ctx, x, y, cols[1], h, name);
    x += cols[1];
    cellText(ctx, x, y, cols[2], h, position);
    x += cols[2];
    cellText(ctx, x, y, cols[3], h, "");
    x += cols[3];
    cellText(ctx, x, y, cols[4], h, "");
    y += h;
  }
  doc.y = y;
}

/** One signature row per name when a role lists several people ("Majid Waleed Alharbi\nBlake Lombard"). */
function pairs(label: string, names: string, positionsText: string, note?: string): [string, string, string, string?][] {
  const ns = String(names ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const ps = String(positionsText ?? "").split("\n").map((x) => x.trim());
  if (!ns.length) return [[label, "", ps[0] ?? "", note]];
  return ns.map((n, i) => [i === 0 ? label : "", n, ps[i] ?? "", i === 0 ? note : undefined]);
}

/** "1 – text – 0 – 1,234.00" lines → rows */
function itemRows(text: string, fallback: [string, string, string, string]): string[][] {
  const rows = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+[–—-]\s+/).map((x) => x.trim()));
  const ok = rows.filter((r) => r.length >= 2);
  if (!ok.length) return [fallback];
  return ok.map((r) => {
    const [ref, desc, omit, add] = r.length >= 4 ? r : r.length === 3 ? [r[0], r[1], "", r[2]] : ["", r[0], "", r[1]];
    return [ref, desc, omit && num(omit) ? sar(num(omit)) : "-", add && num(add) ? sar(num(add)) : "-"];
  });
}

/** "Position – Name" or "Prepared by – Name – Position" lines → cells */
function personLines(text: string): string[][] {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+[–—-]\s+/).map((x) => x.trim()));
}

function ctxFor(doc: Doc, type: PackType, values: PackValues, meta: FormMeta, header: (doc: Doc) => void): Ctx {
  const ctx: Ctx = { doc, type, v: formattedValues(type, values), raw: values, meta, header, headerOn: true };
  doc.on("pageAdded", () => {
    if (ctx.headerOn) ctx.header(doc);
    else doc.y = 60;
  });
  return ctx;
}

/* ------------------------------------------------------------------ */
/* PVO – RSG-CM-FRM-0013                                               */

export async function renderPvoForm(type: PackType, values: PackValues, meta: FormMeta, extras: FormExtras): Promise<Buffer> {
  const { doc, done } = newDoc(meta, `${packRefLabel("PVO", meta.ref)} – ${meta.title}`);
  const header = rsgHeader("RSG-CM-FRM-0013", "Rev. 04, 28 Oct 2025", "Proposed Variation Order (PVO)", "(Stage Gate 3 to 9)");
  const ctx = ctxFor(doc, type, values, meta, header);
  const v = ctx.v;
  header(doc);
  kv(ctx, [["Destination:", v.destination], ["Contract Currency", "SAR"]], 2);
  section(ctx, "1) General Information:");
  kv(ctx, [
    ["Proposed Variation Order No.", dash(v.pvo_no)], ["Date:", dash(v.date)],
    ["Program Name:", dash(v.program_name)], ["Program No:", dash(v.program_no)],
    ["Project Name", dash(v.project_name)], ["Project Code:", dash(v.project_code)],
    ["RFC/CRF Reference:", dash(v.rfc_ref)], ["Requesting Department:", dash(v.requesting_department)],
    ["Development Name:", dash(v.development_name)], ["Development No:", dash(v.development_no)],
    ["Vendor Name:", dash(v.contractor)], ["EWBS Code:", dash(v.ewbs_code)],
    ["Works Package:", dash(v.works_package)], ["ACC Contract No.", dash(v.contract_no)],
  ]);
  section(ctx, "2) Particulars of this Change");
  kv(ctx, [["Title of this Variation:", dash(v.title)], ["Is this change included in the latest EAC?", dash(v.eac_included)]], 2, 0.42);
  block(ctx, "Scope of works / services (brief):", v.scope, 24);
  block(ctx, "a) Reason for Proposed Variation Order:", v.reason, 22);
  kv(ctx, [["Root Cause for this change:", dash(v.root_cause)]], 1, 0.19);
  block(ctx, "Explain if the topic was included within the EAC. If not, explain the reasoning:", v.eac_explanation || (v.budget_line && v.budget_available ? `Current budget available under the construction budget on Hold - ${v.budget_line} = ${v.budget_available}` : ""), 16);
  block(ctx, "Contractual basis for variation entitlement:", v.contractual_basis, 16);
  section(ctx, "b) Estimated Cost Impact (ROM):");
  kv(ctx, [["Basis of ROM Estimate:", dash(v.rom_basis)]], 1, 0.19);
  const total = num(ctx.raw.total_value);
  const omit = num(ctx.raw.omit);
  const add = num(ctx.raw.add) || (total > 0 ? total : 0);
  table(ctx, ["Reference", "Description", "Omit (SAR)", "Add (SAR)"], [...itemRows(ctx.raw.cost_items, ["1", v.title, omit ? sar(omit) : "-", add ? sar(add) : "-"]), ["", "Sub-Total", omit ? sar(omit) : "-", add ? sar(add) : "-"], ["", "Total Value (in Contract Currency)", "", sar(total)], ["", "Total Value (in SAR)", "", sar(total)]], [0.14, 0.5, 0.18, 0.18], { align: ["left", "left", "right", "right"], boldLast: true });
  const original = num(ctx.raw.original_contract);
  const dvos = num(ctx.raw.approved_dvos);
  const pvos = num(ctx.raw.approved_pvos);
  const current = num(ctx.raw.current_revised) || original + dvos;
  const potential = num(ctx.raw.potential_revised) || current + pvos + total;
  section(ctx, "c) Contract Reconciliation Summary");
  kv(ctx, [
    ["Original Contract Value", sar(original)], ["% of approved DVOs to-date vs Original Contract Value", pct(dvos, original)],
    ["Approved DVOs", sar(dvos)], ["% of approved PVOs (Pending DVOs) vs Original Contract Value", pct(pvos, original)],
    ["Current Revised Contract Value", sar(current)], ["% of this PVO vs Original Contract Value", pct(total, original)],
    ["Approved PVOs (Pending DVOs)", sar(pvos)], ["% of Cumulative variations vs Original Contract Value", pct(dvos + pvos + total, original)],
    ["This Proposed Variation Order (PVO)", sar(total)], ["Potential Revised Contract Value (After this PVO)", sar(potential)],
  ], 2, 0.5);
  section(ctx, "d) On-account payment");
  kv(ctx, [["Recommended % for 'On-account' payment for this PVO", dash(v.on_account_pct)], ["Amount (SAR)", v.on_account_pct && /\d/.test(v.on_account_pct) ? sar((total * num(v.on_account_pct)) / 100) : "-"], ["Are the criteria set out in the approved RFA for 'on account' fully met?", dash(v.on_account_criteria)], ["Overall 'Estimated Commercial Impact' due to this Change (this PVO and other impacted Contracts)", sar(total + num(ctx.raw.other_contracts))]], 2, 0.55);
  section(ctx, "e) Potential Impact of this Change on Other Contracts");
  table(ctx, ["Program", "Project / Asset", "Control Account", "Work Package", "Omit (SAR)", "Add (SAR)"], [[v.program_no || "-", v.project_name || "-", "-", "-", "-", num(ctx.raw.other_contracts) ? sar(num(ctx.raw.other_contracts)) : "-"], ["", "", "", "Sub Total (Impact on Other Contracts)", "-", sar(num(ctx.raw.other_contracts))]], [0.12, 0.2, 0.2, 0.24, 0.12, 0.12], { align: ["left", "left", "left", "left", "right", "right"], boldLast: true });
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text("(Note: Individual PVOs need to be raised to cover other contracts impacted)", M, doc.y + 2);
  doc.y += 10;
  // the budget particulars follow on, page 2 as on the RSG form
  section(ctx, "3. Budget Particulars");
  kv(ctx, [["a) Budget Source:", dash(v.budget_source)]], 1, 0.19);
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text("A) No Additional Budget or Budget Transfer Required   ·   B) Budget Transfer Required   ·   C) Additional Budget Required", M, doc.y + 2);
  doc.y += 12;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text("b) Package Budget position:", M, doc.y + 2);
  doc.y += 12;
  const contract = num(ctx.raw.approved_contract) || original;
  const remaining = num(ctx.raw.remaining_budget);
  table(ctx, ["Works Package", "Approved Contract (SAR) [B]", "Approved DVOs (SAR) [C]", "Approved PVOs (SAR) [D]", "Remaining Budget before this PVO (SAR) [E]", "This PVO (SAR) [F]", "Variance (SAR) [E−F]"], [[v.works_package || "-", sar(contract), sar(dvos), sar(pvos), sar(remaining), sar(total), sar(remaining - total)]], [0.24, 0.13, 0.12, 0.12, 0.15, 0.12, 0.12], { align: ["left", "right", "right", "right", "right", "right", "right"] });
  doc.y += 4;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text("c) Budget Transfer details (applicable only if 'Option B' is selected above):", M, doc.y + 2);
  doc.y += 12;
  const available = num(ctx.raw.budget_available);
  table(ctx, ["", "Program", "Project / Asset", "Control Account", "Work Package", "Current Budget", "Transfer Amount", "Revised Budget"], [["From", v.program_no || "-", v.project_name || "-", v.budget_line || "-", "Budget Hold", sar(available), sar(-total), sar(available - total)], ["To", v.program_no || "-", v.project_name || "-", v.budget_to_line || v.contract_no || "-", v.works_package || "-", sar(current), sar(total), sar(current + total)]], [0.06, 0.08, 0.16, 0.2, 0.18, 0.11, 0.1, 0.11], { align: ["left", "left", "left", "left", "left", "right", "right", "right"] });
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text("Note: The approval of this PVO form should not be considered as an approval of a budget transfer, which requires a separate approval under the relevant sub-DoA.", M, doc.y + 2, { width: TW });
  doc.y += 12;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text("d) Project / Asset Budget position (after this PVO):", M, doc.y + 2);
  doc.y += 12;
  // the ACC table as read from the previous PVO (this PVO placed on its own category), else from the cost report
  let accRows: string[][] = [];
  let fromTemplate: string[][] = [];
  try {
    fromTemplate = ctx.raw.acc_table ? (JSON.parse(ctx.raw.acc_table) as string[][]) : [];
  } catch {
    fromTemplate = [];
  }
  if (fromTemplate.length) {
    const cat = fromTemplate.find((row) => /construction/i.test(row[0])) ?? fromTemplate[0];
    const rows = fromTemplate.filter((row) => !/^totals?$/i.test(row[0])).map((row) => {
      const n = row.slice(1).map((x) => Number(x) || 0);
      // A budget, B contract, C DVOs, D commitments, E pending, F PVOs, G total, H this PVO, I other, J pending PVOs, K remaining – this PVO replaces the previous one's
      const [A, B, C, D, E, F] = n;
      const H = row === cat ? total : 0;
      const I = row === cat ? Math.max(0, (n[8] ?? 0) + (n[7] ?? 0)) : n[8] ?? 0;
      const G = D + E + F;
      return [row[0], sar(A), sar(B), sar(C), sar(D), sar(E), sar(F), sar(G), sar(H), sar(I), sar(H + I), sar(A - G - H - I)];
    });
    const sums = Array.from({ length: 11 }, (_, i) => rows.reduce((t, r) => t + num(r[i + 1].replace(/[()]/g, (m) => (m === "(" ? "-" : ""))), 0));
    accRows = [...rows, ["TOTALS", ...sums.map((x) => sar(x))]];
  } else {
    accRows = extras.acc.map((r) => {
      const totalCommit = r.commitments + r.pvos;
      return [r.category, sar(r.budget), sar(r.contract), sar(r.dvos), sar(r.commitments), "0.00", sar(r.pvos), sar(totalCommit), sar(r.thisPvo), "0.00", sar(r.pvos + r.thisPvo), sar(r.budget - r.commitments - r.pvos - r.thisPvo)];
    });
    const sum = (i: number) => extras.acc.reduce((t, r) => t + [r.budget, r.contract, r.dvos, r.commitments, 0, r.pvos, r.commitments + r.pvos, r.thisPvo, 0, r.pvos + r.thisPvo, r.budget - r.commitments - r.pvos - r.thisPvo][i], 0);
    accRows.push(["TOTALS", ...Array.from({ length: 11 }, (_, i) => sar(sum(i)))]);
  }
  table(ctx, ["Control Account", "Current Approved Budget [A]", "Approved Contract [B]", "Approved DVOs [C]", "Total Approved Commitments [D=B+C]", "Pending Contracts [E]", "Approved PVOs [F]", "Total Commitments [G=D+E+F]", "This PVO [H]", "Other PVOs in circulation [I]", "Total Pending PVOs [J=H+I]", "Remaining Budget [K=A−G−J]"], accRows.length > 1 ? accRows : [["(cost report not available)", ...Array(11).fill("-")]], [0.12, 0.09, 0.085, 0.08, 0.09, 0.065, 0.08, 0.09, 0.08, 0.065, 0.075, 0.08], { align: ["left", ...Array(11).fill("right")] as ("left" | "right")[], boldLast: accRows.length > 1, size: 5.4 });
  section(ctx, "4. Time Impact (Contract level):");
  const eot = num(ctx.raw.approved_eot);
  kv(ctx, [
    ["a) Original Contract Completion Date", dash(v.original_completion)], ["b) Approved EOTs (Days)", String(eot)],
    ["c) Current Revised Completion Date (a+b)", dash(v.current_completion)], ["d) Estimated 'time impact' of this variation (Days)", dash(v.time_impact)],
    ["e) Other anticipated EOTs / Un-agreed EOTs of the previous PVO/DVO (Days)", dash(v.other_eots)], ["Comments:", dash(v.time_comments)],
  ], 2, 0.55);
  doc.y += 6;
  signatureBlock(ctx, [
    ...pairs("Prepared/Initiated By:", v.prepared_by, v.prepared_position, "Note: Signatures for preparation are already received on attached CRF forms"),
    ...pairs("Checked by (Pre-Approval):", v.checked_by, v.checked_position, "Note: Signatures for approval are already received on attached CRF forms"),
    ...pairs("Approved by:", v.approved_by, v.approved_position, "- Routed through Aconex Workflow -"),
  ]);
  finish(ctx);
  return done;
}

/* ------------------------------------------------------------------ */
/* DVO – PVO vs DVO comparison: values, references, contract position  */

const GREEN = "#2E7D32";
const RED = "#B3261E";
const SAND = "#EFE6D8";
const SLATE = "#E6E8EB";

/**
 * The page that opens a DVO pack: the approved PVO against the determined DVO side by side – the
 * references and dates, the values, the time impact, the contract position before and after – with
 * the movement coloured (a determination below the PVO in green, above it in red) and the
 * documents behind each figure named.
 */
export async function renderPvoDvoComparison(type: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  const { doc, done } = newDoc(meta, `${packRefLabel("DVO", meta.ref)} – PVO to DVO comparison`);
  const ctx = ctxFor(doc, type, values, meta, (d) => {
    d.y = 60;
  });
  const raw = ctx.raw;
  // the particulars of the PVO, the VO and the DVO are not form fields of the pack: they come straight from the values
  const R = (k: string) => String(raw[k] ?? "").trim();
  const v: Record<string, string> = { ...ctx.v, pvo_no: R("pvo_no") || ctx.v.pvo_no || "", vo_no: R("vo_no") || ctx.v.vo_no || "", pvo_date: R("pvo_date"), pvo_aconex: R("pvo_aconex"), pvo_status: R("pvo_status"), vo_date: R("vo_date"), vo_aconex: R("vo_aconex"), dvo_aconex: R("dvo_aconex"), dvo_status: R("dvo_status"), rfc_ref: R("rfc_ref") || ctx.v.rfc_ref || "", item_no: R("item_no"), budget_line: R("budget_line") || ctx.v.budget_line || "", budget_available: R("budget_available") || ctx.v.budget_available || "", instruction_ref: R("instruction_ref") || ctx.v.instruction_ref || "" };
  const pvo = num(raw.pvo_value);
  const dvo = num(raw.dvo_value) || num(raw.add) - num(raw.omit);
  const move = Math.round((dvo - pvo) * 100) / 100;
  const movePct = pvo ? (move / pvo) * 100 : 0;
  const tone = Math.abs(move) < 0.005 ? INK : move < 0 ? GREEN : RED;
  const moneyOrDash = (n: number) => (n ? sar(n) : "-");
  const signed = (n: number) => (Math.abs(n) < 0.005 ? "-" : `${n < 0 ? "-" : "+"} ${sar(Math.abs(n))}`);
  const dvoNo = v.dvo_no ? (/^DVO/i.test(v.dvo_no) ? v.dvo_no : `DVO-${v.dvo_no.replace(/\D/g, "").padStart(3, "0")}`) : "DVO";
  const pvoNo = v.pvo_no ? (/^PVO/i.test(v.pvo_no) ? v.pvo_no : `PVO-${v.pvo_no.replace(/\D/g, "").padStart(3, "0")}`) : "PVO";

  // title band
  doc.rect(M, 40, TW, 34).fill(GRAPHITE);
  doc.rect(M, 40, 4, 34).fill(BRONZE);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13).text("PVO TO DVO – COST MOVEMENT AND REFERENCES", M + 12, 47, { lineBreak: false });
  doc.fillColor("#D8D9D6").font("Helvetica").fontSize(8).text(`${dvoNo} - ${v.title}`, M + 12, 62, { width: TW - 24, height: 10, lineBreak: false, ellipsis: true });
  doc.y = 84;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text([v.contractor, v.works_package, v.contract_no || v.contract_ref, v.project_name].filter(Boolean).join("  ·  "), M, doc.y, { width: TW, height: 10, lineBreak: false, ellipsis: true });
  doc.y = 102;

  // the four figures
  const boxW = (TW - 30) / 4;
  const boxes: [string, string, string, string][] = [
    ["APPROVED PVO VALUE", `SAR ${sar(pvo)}`, pvoNo, BRONZE],
    ["DETERMINED DVO VALUE", `SAR ${sar(dvo)}`, dvoNo, GRAPHITE],
    ["MOVEMENT (DVO - PVO)", Math.abs(move) < 0.005 ? "SAR 0.00" : `${move < 0 ? "-" : "+"} SAR ${sar(Math.abs(move))}`, move < -0.005 ? "determination below the PVO" : move > 0.005 ? "determination above the PVO" : "no change", tone],
    ["MOVEMENT % OF PVO", pvo ? `${move < 0 ? "-" : move > 0 ? "+" : ""}${Math.abs(movePct).toFixed(2)}%` : "-", pvo ? "of the approved PVO value" : "PVO value not recorded", tone],
  ];
  const top = doc.y;
  boxes.forEach(([label, val, sub, colour], i) => {
    const x = M + i * (boxW + 10);
    doc.rect(x, top, boxW, 58).fill(PALE);
    doc.rect(x, top, boxW, 4).fill(colour);
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.8).text(label, x + 8, top + 10, { width: boxW - 16, height: 9, lineBreak: false });
    doc.fillColor(colour).font("Helvetica-Bold").fontSize(12.5).text(val, x + 8, top + 22, { width: boxW - 16, height: 15, lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(sub, x + 8, top + 42, { width: boxW - 16, height: 9, lineBreak: false, ellipsis: true });
  });
  doc.y = top + 70;

  // side by side
  const colX = [M, M + TW * 0.26, M + TW * 0.56, M + TW * 0.86];
  const colW = [TW * 0.26, TW * 0.3, TW * 0.3, TW * 0.14];
  const headRow = (y: number) => {
    doc.rect(colX[0], y, colW[0], 18).fill(SLATE);
    doc.rect(colX[1], y, colW[1], 18).fill(SAND);
    doc.rect(colX[2], y, colW[2], 18).fill(GRAPHITE);
    doc.rect(colX[3], y, colW[3], 18).fill(SLATE);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text("ITEM", colX[0] + 6, y + 5.5, { lineBreak: false });
    doc.fillColor(INK).text(`APPROVED PVO  ·  ${pvoNo}`, colX[1] + 6, y + 5.5, { width: colW[1] - 12, lineBreak: false });
    doc.fillColor("#FFFFFF").text(`DETERMINED DVO  ·  ${dvoNo}`, colX[2] + 6, y + 5.5, { width: colW[2] - 12, lineBreak: false });
    doc.fillColor(INK).text("MOVEMENT", colX[3] + 6, y + 5.5, { lineBreak: false });
    return y + 18;
  };
  const row = (y: number, label: string, a: string, b: string, m: string, opts: { bold?: boolean; tone?: string; shade?: boolean } = {}) => {
    const h = Math.max(16, textHeight(ctx, a, colW[1] - 12, 7.5, !!opts.bold) + 6, textHeight(ctx, b, colW[2] - 12, 7.5, !!opts.bold) + 6);
    if (opts.shade) doc.rect(colX[0], y, TW, h).fill("#F8F8F6");
    doc.rect(colX[0], y, TW, h).lineWidth(0.4).stroke(LINE);
    for (let i = 1; i < 4; i++) doc.moveTo(colX[i], y).lineTo(colX[i], y + h).lineWidth(0.4).stroke(LINE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(label, colX[0] + 6, y + 4.5, { width: colW[0] - 12 });
    doc.fillColor(INK).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).text(a, colX[1] + 6, y + 4.5, { width: colW[1] - 12 });
    doc.fillColor(INK).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).text(b, colX[2] + 6, y + 4.5, { width: colW[2] - 12 });
    doc.fillColor(opts.tone ?? INK).font("Helvetica-Bold").fontSize(7.5).text(m, colX[3] + 6, y + 4.5, { width: colW[3] - 12, align: "right" });
    return y + h;
  };
  const pvoTime = num(raw.pvo_time_impact);
  const dvoTime = num(raw.this_eot) || num(raw.time_impact);
  // every date in the same DD-MMM-YY form, whatever form it was recorded in
  const fmtD = (d: string | undefined) => {
    const t = String(d ?? "").trim();
    return t ? formatDate(t) || t : "";
  };
  v.pvo_date = fmtD(v.pvo_date);
  v.vo_date = fmtD(v.vo_date);
  v.date = fmtD(v.date);
  v.budget_line = v.budget_line.replace(/[:\s]+$/, "");
  const budgetText = v.budget_line ? `${v.budget_line}${v.budget_available ? ` – SAR ${sar(num(v.budget_available))} available` : ""}` : "-";
  const dateOr = (d: string | undefined) => (d && d.trim() ? d : "-");
  let y = doc.y;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text("The change, as proposed and as determined", M, y, { lineBreak: false });
  y += 14;
  y = headRow(y);
  y = row(y, "Reference", pvoNo, dvoNo, "");
  y = row(y, "Date", dateOr(v.pvo_date), dateOr(v.date), "", { shade: true });
  y = row(y, "Aconex workflow / approval", dateOr(v.pvo_aconex), dateOr(v.dvo_aconex), "");
  const voLabel = v.vo_no ? (/^(VO|EI|EVO)/i.test(v.vo_no) ? v.vo_no : `VO ${v.vo_no}`) : "";
  y = row(y, "Instruction behind the change", dateOr(v.rfc_ref ? `RFC / EMI ${v.rfc_ref}` : ""), dateOr([voLabel, v.instruction_ref && v.instruction_ref !== voLabel ? v.instruction_ref : "", v.vo_date ? `dated ${v.vo_date}` : ""].filter(Boolean).join(" – ")), "", { shade: true });
  y = row(y, "Title", v.title, `${dvoNo} – ${v.title}`, "");
  y = row(y, "Value (SAR, excl. VAT)", `SAR ${sar(pvo)}`, `SAR ${sar(dvo)}`, signed(move), { bold: true, tone, shade: true });
  y = row(y, "Time impact (days)", pvoTime ? String(Math.round(pvoTime)) : "-", dvoTime ? String(Math.round(dvoTime)) : "-", pvoTime || dvoTime ? `${dvoTime - pvoTime >= 0 ? "+" : "-"} ${Math.abs(Math.round(dvoTime - pvoTime))} days` : "-");
  y = row(y, "Status", dateOr(v.pvo_status), dateOr(v.dvo_status), "", { shade: true });
  doc.y = y + 16;

  // the contract position before and after
  const a = num(raw.contract_price);
  const b = num(raw.previous_dvos);
  const c = num(raw.interim_vos);
  const withPvo = a + b + c + pvo;
  const withDvo = num(raw.revised_contract) || a + b + c + dvo;
  y = doc.y;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text("Contract position", M, y, { lineBreak: false });
  y += 14;
  doc.rect(colX[0], y, colW[0], 18).fill(SLATE);
  doc.rect(colX[1], y, colW[1], 18).fill(SAND);
  doc.rect(colX[2], y, colW[2], 18).fill(GRAPHITE);
  doc.rect(colX[3], y, colW[3], 18).fill(SLATE);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text("SAR", colX[0] + 6, y + 5.5, { lineBreak: false });
  doc.fillColor(INK).text("WITH THE APPROVED PVO", colX[1] + 6, y + 5.5, { lineBreak: false });
  doc.fillColor("#FFFFFF").text("WITH THIS DVO", colX[2] + 6, y + 5.5, { lineBreak: false });
  doc.fillColor(INK).text("MOVEMENT", colX[3] + 6, y + 5.5, { lineBreak: false });
  y += 18;
  y = row(y, "Contract Price [a]", sar(a), sar(a), "-");
  y = row(y, "Previous Determined Variation Orders [b]", moneyOrDash(b), moneyOrDash(b), "-", { shade: true });
  if (c) y = row(y, "Interim value variations [c]", sar(c), sar(c), "-");
  y = row(y, "This change [d]", `SAR ${sar(pvo)}`, `SAR ${sar(dvo)}`, signed(move), { bold: true, tone });
  y = row(y, c ? "Revised Contract Price [e] = [a+b+c+d]" : "Revised Contract Price [e] = [a+b+d]", sar(withPvo), sar(withDvo), signed(withDvo - withPvo), { bold: true, tone, shade: true });
  y = row(y, "Variations as % of the original Contract Price", pct(withPvo - a, a), pct(withDvo - a, a), a ? `${((withDvo - withPvo) / a) * 100 >= 0 ? "+" : "-"}${Math.abs(((withDvo - withPvo) / a) * 100).toFixed(2)}%` : "-", { tone });
  doc.y = y + 16;

  // the note and where each figure comes from
  const note = v.movement_note || (Math.abs(move) < 0.005 ? "The DVO value equals the approved PVO value." : `The DVO value is ${move < 0 ? "lower" : "higher"} than the approved PVO value, with a variance of SAR ${sar(Math.abs(move))}.`);
  doc.rect(M, doc.y, TW, 3).fill(tone);
  doc.y += 9;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text("Basis of the movement", M, doc.y, { lineBreak: false });
  doc.y += 12;
  doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(`${note} ${Math.abs(move) < 0.005 ? "" : "The determined value follows the Employer's assessment of the Contractor's final cost proposal (Annexure 2) against the scope and rates of the Contract; the approved PVO was the estimate at the time the change was proposed."}`, M, doc.y, { width: TW, lineGap: 1.5 });
  doc.y += 10;
  const refs: [string, string][] = [
    ["Request for change / instruction", v.rfc_ref || "-"],
    ["Proposed Variation Order", `${pvoNo}${v.pvo_date ? ` dated ${v.pvo_date}` : ""}${v.pvo_aconex ? ` – ${v.pvo_aconex}` : ""}`],
    ["Variation Order / Employer's instruction", [voLabel, v.instruction_ref && v.instruction_ref !== voLabel ? v.instruction_ref : "", v.vo_date ? `dated ${v.vo_date}` : ""].filter(Boolean).join(" – ") || "-"],
    ["Determined Variation Order", `${dvoNo}${v.date ? ` dated ${v.date}` : ""}${v.dvo_aconex ? ` – ${v.dvo_aconex}` : ""}`],
    ["Change register item", v.item_no || "-"],
    ["Budget", budgetText],
  ];
  kv(ctx, refs, 2, 0.42);
  doc.y += 14;
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text("Values exclude VAT. Annexure 1 holds the approved PVO and VO with their workflow approvals; Annexure 2 the cost proposal and the Employer's assessment and determination; Annexure 3 the budget particulars; Annexure 4 the change log of the contract.", M, doc.y, { width: TW });
  doc.y += 18;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("#CLASSIFICATION: INTERNAL SENSITIVE", M, doc.y, { width: TW, align: "center" });
  finish(ctx);
  return done;
}

/* ------------------------------------------------------------------ */
/* DVO – movement summary, RSG-CM-FRM-0014 and RSG-CM-FRM-0027         */

export async function renderDvoForm(type: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  const { doc, done } = newDoc(meta, `${packRefLabel("DVO", meta.ref)} – ${meta.title}`);
  const header = rsgHeader("RSG-CM-FRM-0014", "Rev.07, 08 January 2026", "Determination of Variation Order Form");
  const ctx = ctxFor(doc, type, values, meta, header);
  const v = ctx.v;
  const pvo = num(ctx.raw.pvo_value);
  const dvo = num(ctx.raw.dvo_value);
  // page 1 – the movement summary
  doc.rect(M, 60, TW, 26).fill(GRAPHITE);
  doc.rect(M, 60, 4, 26).fill(BRONZE);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13).text("PVO to DVO Cost Movement Summary", M + 12, 67);
  const boxW = (TW - 20) / 3;
  [["PVO Value", sar(pvo)], ["DVO Value", sar(dvo)], ["Variance", sar(pvo - dvo)]].forEach(([l, val], i) => {
    const x = M + i * (boxW + 10);
    doc.rect(x, 100, boxW, 54).fill(PALE);
    doc.rect(x, 100, boxW, 54).lineWidth(0.5).stroke(LINE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(l, x + 10, 108);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(`SAR ${val}`, x + 10, 124, { width: boxW - 20 });
  });
  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(`•  ${v.movement_note || (pvo && dvo ? `The DVO value is ${pvo > dvo ? "lower" : pvo < dvo ? "higher" : "equal to"} the approved PVO value${pvo !== dvo ? `, with a variance of SAR ${sar(Math.abs(pvo - dvo))}` : ""}.` : "")}`, M, 172, { width: TW });
  doc.y = 200;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`${v.title}  ·  ${v.contractor}  ·  ${v.contract_no || v.contract_ref}`, M, doc.y, { width: TW });
  // page 2 – the DVO form
  newPage(ctx);
  kv(ctx, [["Destination", v.destination], ["Form is being used for", "Adjustment to the Contract Price"]], 2);
  section(ctx, "General Information");
  kv(ctx, [
    ["Variation Order No:", dash(v.dvo_no)], ["Date", dash(v.date)],
    ["Program Name", dash(v.program_name)], ["Project Name", dash(v.project_name)],
    ["Project Code", dash(v.project_code)], ["Contract Ref.", dash(v.contract_ref || v.contract_no)],
    ["Works Package", dash(v.works_package)], ["Contractor/Consultant", dash(v.contractor)],
    ["Contract Price [a]", sar(num(ctx.raw.contract_price))], ["Contract Commencement Date", dash(v.commencement_date)],
    ["Rev. No.", dash(v.revision)], ["Instruction Reference", dash(v.instruction_ref)],
  ]);
  section(ctx, "VARIATION");
  kv(ctx, [["Variation Order Title:", `${v.dvo_no ? `${v.dvo_no} - ` : ""}${v.title}`]], 1, 0.19);
  block(ctx, "Reason for Variation Order:", v.reason || v.description, 26);
  const omit = num(ctx.raw.omit);
  const add = num(ctx.raw.add) || dvo;
  table(ctx, ["Instruction Reference", "Description", "Omit (SAR)", "Add (SAR)"], [...itemRows(ctx.raw.cost_items, [v.instruction_ref || v.vo_no || "-", v.description || v.title, omit ? sar(omit) : "-", add ? sar(add) : "-"]), ["", "Sub-Total", omit ? sar(omit) : "-", add ? sar(add) : "-"], ["", "Total Value", "", sar(dvo)]], [0.16, 0.5, 0.17, 0.17], { align: ["left", "left", "right", "right"], boldLast: true });
  section(ctx, "Contract Reconciliation Summary");
  const a = num(ctx.raw.contract_price);
  const b = num(ctx.raw.previous_dvos);
  const c = num(ctx.raw.interim_vos);
  const e = num(ctx.raw.revised_contract) || a + b + c + dvo;
  kv(ctx, [
    ["Contract Price [a]", sar(a)], ["Original Contract Completion Date [x]", dash(v.original_completion)],
    ["Sum of Previous Determination of Variation Orders / Adjustments [b]", sar(b)], ["Previous Approved Extension of Time (Days) [y]", dash(v.previous_eot)],
    ["Sum of Interim Value Variations (for on account payments) [c]", sar(c)], ["This Agreed Extension of Time (Days) [z]", dash(v.this_eot)],
    ["This Variation Order [d]", sar(dvo)], ["Total Extension (Days Difference to the Original Contract Completion Date) [y+z]", dash(v.total_eot)],
    ["Revised Contract Price [e] = [a+b+c+d]", sar(e)], ["Revised Contract Completion Date [x+y+z]", dash(v.revised_completion)],
    ["VO's % Original Contract Price [(e-a)/a]", v.vo_pct || pct(e - a, a)], ["", ""],
  ], 2, 0.55);
  section(ctx, "Information Provided with this Determination of Variation Order Form");
  const info = personLines(ctx.raw.information_provided);
  table(ctx, ["Document Ref. No.", "Document Title", "Rev. Date"], info.length ? info.map((r, i) => [r[0] || String(i + 1), r[1] ?? "", r[3] ?? r[2] ?? ""]) : [["1", "Annexure 1 – Approved PVO & VO", ""], ["2", "Annexure 2 – Cost impact – Employer's assessment and determination", ""], ["3", "Annexure 3 – Budget particulars", ""], ["4", "Annexure 4 – Change log", ""]], [0.25, 0.55, 0.2]);
  doc.y += 6;
  signatureBlock(ctx, [
    ["Agreement for Final Determination to the Contract Price & Time for Completion by the Contractor (Contractor's Representative)", v.contractor_rep, v.contractor_rep_position],
    ["Final Determination by the Employer (Employer's Representative)", v.employer_rep, v.employer_rep_position],
  ]);
  // page 3 – review and recommendation
  ctx.header = rsgHeader("RSG-CM-FRM-0027", "Rev. 04, 08 January 2026", "Determination of Variation Order Review & Recommendation");
  newPage(ctx);
  kv(ctx, [["Destination", v.destination], ["Form is being used for", "Adjustment to the Contract Price"]], 2);
  section(ctx, "General Information");
  kv(ctx, [["Variation Order No:", dash(v.dvo_no)], ["Date", dash(v.date)], ["Program Name", dash(v.program_name)], ["Project Name", dash(v.project_name)], ["Project Code", dash(v.project_code)], ["Contract Ref.", dash(v.contract_ref || v.contract_no)], ["Works Package", dash(v.works_package)], ["Contractor/Consultant", dash(v.contractor)], ["Contract Price [a]", sar(a)], ["Contract Commencement Date", dash(v.commencement_date)]]);
  section(ctx, "VARIATION");
  kv(ctx, [["Variation Order Title:", `${v.dvo_no ? `${v.dvo_no} - ` : ""}${v.title}`]], 1, 0.19);
  block(ctx, "Reason for Variation Order:", v.reason || v.description, 26);
  table(ctx, ["Instruction Reference", "Description", "Omit (SAR)", "Add (SAR)"], [[v.instruction_ref || v.vo_no || "-", v.description || v.title, omit ? sar(omit) : "-", sar(add)], ["", "Total Value", "", sar(dvo)]], [0.16, 0.5, 0.17, 0.17], { align: ["left", "left", "right", "right"], boldLast: true });
  section(ctx, "Contract Reconciliation Summary");
  kv(ctx, [["Contract Price [a]", sar(a)], ["Original Contract Completion Date [x]", dash(v.original_completion)], ["Sum of Previous Determination of Variation Orders / Adjustments [b]", sar(b)], ["Previous Approved Extension of Time (Days) [y]", dash(v.previous_eot)], ["Sum of Interim Value Variations [c]", sar(c)], ["This Agreed Extension of Time (Days) [z]", dash(v.this_eot)], ["This Variation Order [d]", sar(dvo)], ["Total Extension [y+z]", dash(v.total_eot)], ["Revised Contract Price [e] = [a+b+c+d]", sar(e)], ["Revised Contract Completion Date [x+y+z]", dash(v.revised_completion)], ["VO's % Original Contract Price [(e-a)/a]", v.vo_pct || pct(e - a, a)], ["", ""]], 2, 0.55);
  section(ctx, "Review and Recommendation Panel");
  const panel = personLines(ctx.raw.review_panel);
  signatureBlock(ctx, panel.length ? panel.map((r) => [r[0] ?? "", r[1] ?? "", r[0] ?? ""] as [string, string, string]) : [["Employer's Associate Director - Commercial", "", "Employer's Associate Director - Commercial"], ["Employer's Planning Director", "", "Employer's Planning Director"], ["Employer's Senior Director - Projects", "", "Employer's Senior Director - Projects"], ["Contractor's Representative", v.contractor_rep, v.contractor_rep_position || "Contractor's Representative"]]);
  finish(ctx);
  return done;
}

/* ------------------------------------------------------------------ */
/* RFA – RSG-PR-FRM-0004                                               */

export async function renderRfaForm(type: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  const { doc, done } = newDoc(meta, `${packRefLabel("RFA", meta.ref)} – ${meta.title}`);
  const header = rsgHeader("RSG-PR-FRM-0004", "Revision 00, Rev. Date 19-Oct-2020", "Request for Approval Form - RFA", "(TRS-PR-FRM-0004)");
  const ctx = ctxFor(doc, type, values, meta, header);
  const v = ctx.v;
  header(doc);
  section(ctx, "General Information");
  kv(ctx, [["Contact Information", dash(v.contact)], ["RFA Form Reference", dash(v.rfa_no)], ["Submittal Date", dash(v.submittal_date || v.date)], ["Requesting Department", dash(v.requesting_department)], ["Program / Project", `${v.program_name || ""}${v.project_name ? ` · ${v.project_name}` : ""}${v.project_code ? ` (${v.project_code})` : ""}`], ["Contract Name", dash(v.contract_title)]], 2, 0.34);
  section(ctx, "STEP 1: Identify Program/Business Unit and DoA Items for Approval");
  table(ctx, ["Item", "Description"], [
    ["Purpose of Request for Approval", v.purpose || v.subject || "-"],
    ["Requested Approvals:", v.requested_approvals ? v.requested_approvals.split("\n").filter(Boolean).map((l, i) => (/^\d+[.)]/.test(l) ? l : `${i + 1}. ${l}`)).join("\n") : "-"],
    ["Requesting Department", v.requesting_department || "-"],
    ["Contract Name", v.contract_title || "-"],
    ["Project Budget / Funding Source", [v.amount ? `SAR ${v.amount}` : "", v.funding_source].filter(Boolean).join(" · ") || "-"],
    ["Budget Remaining to Date", v.budget_remaining || "TBC"],
    ["Preferred Tenderer", v.preferred_tenderer || "-"],
    ["Contract Price", v.contract_price || "Subject to Tender and Award."],
  ], [0.3, 0.7], { size: 8 });
  // page 2 – recommended for approval
  newPage(ctx);
  section(ctx, "Recommended for Approval");
  const rec = personLines(ctx.raw.recommended_by);
  const rows = rec.length ? rec.map((r) => [r[0] ?? "", r[1] ?? "", "", ""]) : [["Head of Commercial", "", "", ""], ["Executive Director – Commercial", "", "", ""], ["Head of Construction - AMAALA", "", "", ""]];
  table(ctx, ["Function", "Name", "Signature", "Date"], rows, [0.36, 0.3, 0.2, 0.14], { size: 8 });
  doc.y += 8;
  section(ctx, "Executive Approval");
  table(ctx, ["Function", "Name", "Signature", "Date"], [[v.executive_position || "Group Chief Executive Officer", v.executive_approver || "", "", ""]], [0.36, 0.3, 0.2, 0.14], { size: 8 });
  // page 3 – description
  newPage(ctx);
  section(ctx, "Request for Approval – Description");
  block(ctx, "Background:", v.background, 60);
  block(ctx, "Justification:", v.justification, 60);
  if (v.options) block(ctx, "Options considered:", v.options, 40);
  block(ctx, "Next Steps:", v.next_steps ? v.next_steps.split("\n").filter(Boolean).map((l, i) => (/^\d+[.)]/.test(l) ? l : `${i + 1}. ${l}`)).join("\n") : "", 30);
  section(ctx, "Attachments");
  const att = v.attachments ? v.attachments.split("\n").filter(Boolean) : [];
  doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(att.length ? att.map((l, i) => (/^\d+[.)]/.test(l) ? l : `${i + 1}. ${l}`)).join("\n") : "As listed in the compiled pack.", M + 4, doc.y + 4, { width: TW - 8 });
  doc.y += 8;
  finish(ctx);
  return done;
}

/* ------------------------------------------------------------------ */
/* EAR – cover letter and the report                                   */

/** Paragraph numbering: blank-line separated paragraphs of a section become 1.1, 1.2 …; lines that read as sub-headings ("Overview") become 1.1 headings with 1.1.1 paragraphs. */
function numberedParagraphs(text: string, sectionNo: number): { kind: "h" | "p" | "t"; no: string; text: string }[] {
  const out: { kind: "h" | "p" | "t"; no: string; text: string }[] = [];
  const paras = String(text ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let sub = 0;
  let para = 0;
  for (const p of paras) {
    const line = p.replace(/\n/g, " ");
    if (line.length <= 70 && !/[.:;]$/.test(line) && /^[A-Z]/.test(line) && line.split(" ").length <= 9) {
      sub++;
      para = 0;
      out.push({ kind: "h", no: `${sectionNo}.${sub}`, text: line });
    } else if (/^(table|figure) \d+/i.test(line)) out.push({ kind: "t", no: "", text: line });
    else {
      if (!sub) {
        sub = 1;
        out.push({ kind: "h", no: `${sectionNo}.${sub}`, text: "Overview" });
      }
      para++;
      out.push({ kind: "p", no: `${sectionNo}.${sub}.${para}`, text: p });
    }
  }
  return out;
}

export async function renderEarReport(type: PackType, values: PackValues, meta: FormMeta, opts: { withLetter: boolean }): Promise<Buffer> {
  const { doc, done } = newDoc(meta, `Employer's Assessment Report – ${meta.ref}`);
  const v = formattedValues(type, values);
  const isTime = type.key === "eot_ear";
  const eot = v.eot_no || meta.ref;
  const reportTitle = isTime ? "Extension of Time Report" : "Cost Claim Assessment Report";
  const runHead = `Contract No. ${v.contract_ref || v.contract_no} – ${v.contractor} – ${eot}`;
  const header = (d: Doc) => {
    d.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(reportTitle, M, 22, { lineBreak: false });
    d.text(runHead, M, 32, { width: TW - 160, lineBreak: false });
    d.text(v.template_rev || "Template Revision Sep-2025", W - M - 160, 22, { width: 160, align: "right", lineBreak: false });
    d.moveTo(M, 44).lineTo(W - M, 44).lineWidth(0.6).stroke(BRONZE);
    d.y = 58;
  };
  const ctx = ctxFor(doc, type, values, meta, header);
  let page = 1;
  // the cover letter (Aconex LTR)
  if (opts.withLetter) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text("AMAALA Company - C.R: 1010590650  ·  Building No. 8491, An Nu'aylah 48511-3110, Alwajh, Kingdom of Saudi Arabia", M, 24, { width: TW, align: "center" });
    doc.text("CLASSIFICATION: INTERNAL & SENSITIVE", M, 34, { width: TW, align: "center" });
    doc.y = 70;
    kv(ctx, [["Letter Ref.:", dash(v.letter_ref)], ["Date:", dash(v.letter_date || v.date)]], 2, 0.25);
    doc.y += 8;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(v.contractor || "", M, doc.y);
    if (v.contractor_address) doc.font("Helvetica").fontSize(9).text(v.contractor_address, M, doc.y + 2, { width: TW * 0.6 });
    doc.y += 8;
    kv(ctx, [["Attention:", dash(v.attention)], ["Contract:", `${v.contract_title || v.works_package}${v.contract_no ? `, Contract No. ${v.contract_no}` : ""}`], ["Subject:", `Employer's Assessment Report for ${isTime ? `Extension of Time Claim ${eot}` : `${v.claim_type || "Cost"} Claim ${eot}`}`], ["Reference:", `[1] ${v.claim_letter_ref || "-"}${v.claim_letter_date ? ` dated ${v.claim_letter_date}` : ""} – ${v.title || "Contractor's claim submission"}`]], 1, 0.16);
    doc.y += 10;
    const body = [
      "Dear Sir,",
      `The Employer refers to the Construction Contract entered into between (i) AMAALA Company (as the 'Employer'); and (ii) ${v.contractor} (as the 'Contractor'), in respect of the ${v.contract_title || v.works_package}, Contract No. ${v.contract_no} ("Contract") for the ${v.project_name} project, Kingdom of Saudi Arabia (the 'Project').`,
      "All capitalized terms used in this letter but not otherwise defined herein shall have the same meaning as set out in the Contract.",
      isTime
        ? `With reference to the Contractor's [Extension of Time Claim No. ${eot}], claim for additional time submitted via the Contractor's letter reference ${v.claim_letter_ref || "-"}${v.claim_letter_date ? ` dated ${v.claim_letter_date}` : ""} above, please find attached the Employer's Assessment Report, which provides detailed comments and explanations in accordance with ${v.clauses || "Clause 8.4"} as to the Contractor's entitlement to Extension of Time.`
        : `With reference to the Contractor's [Claim No. ${eot}] for additional payment submitted via the Contractor's letter reference ${v.claim_letter_ref || "-"}${v.claim_letter_date ? ` dated ${v.claim_letter_date}` : ""} above, please find attached the Employer's Assessment Report, which provides detailed comments and explanations in accordance with ${v.clauses || "Clause 20.1"} as to the Contractor's entitlement.`,
      `The Contractor is requested to review the Employer's assessment and either provide comments supported by further particulars for the Employer's consideration or confirm its agreement with the entitlement stated. In accordance with ${v.determination_clause || "Clause 3.5 [Determinations]"} of the Conditions of Contract, if an agreement is not reached within twenty (20) Business Days (or such other period as the Parties may agree), the Employer shall make a fair determination in accordance with the Contract, taking due regard of all relevant circumstances.`,
      "This notification is issued for the Contractor's information and necessary action.",
    ];
    for (const p of body) {
      ensure(ctx, 40);
      doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(p, M, doc.y, { width: TW, lineGap: 1.5 });
      doc.y += 8;
    }
    doc.y += 10;
    doc.text("Yours faithfully,", M, doc.y);
    doc.y += 34;
    doc.text("_______________________", M, doc.y);
    doc.y += 14;
    doc.font("Helvetica-Bold").text(v.signatory || "Employer's Representative", M, doc.y);
    doc.y += 12;
    doc.font("Helvetica").text("AMAALA Company", M, doc.y);
    doc.y += 24;
    doc.fillColor(MUTED).fontSize(8.5).text(`Attachments: Employer's Assessment Report for ${eot}`, M, doc.y);
    newPage(ctx, false);
    page++;
  }
  // the cover page
  doc.rect(0, 0, W, 190).fill(GRAPHITE);
  doc.rect(M, 150, 60, 3).fill(BRONZE);
  doc.fillColor("#D8D9D6").font("Helvetica").fontSize(9).text("AMAALA  ·  COMMERCIAL", M, 60);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(22).text(`Employer's Assessment Report for ${eot}`, M, 84, { width: TW });
  if (v.revision && v.revision !== "00") doc.fillColor("#D8D9D6").font("Helvetica").fontSize(10).text(`Revision ${v.revision}${v.previous_revision ? ` – supersedes ${v.previous_revision}` : ""}`, M, 126, { width: TW });
  doc.y = 230;
  kv(ctx, [["Contract No. & Title:", `${v.contract_no} - ${v.contract_title || v.works_package}`], ["Project:", `${v.project_name}${v.project_code ? ` (${v.project_code})` : ""}`], ["Contractor:", v.contractor], ["Claim:", v.title || eot], ["Date:", v.date]], 1, 0.22);
  doc.y += 20;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(v.report_ref ? `Aconex ref. ${v.report_ref}` : "", M, doc.y);
  // revision history
  newPage(ctx);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("Revision History", M, doc.y);
  doc.y += 16;
  const hist = personLines(values.revision_history ?? "");
  const histRows = hist.length ? hist.map((r) => [v.revision || "00", r[0] ?? "", r[1] ?? "", r[2] ?? "", "", ""]) : [[v.revision || "00", "Prepared by:", v.prepared_by, v.prepared_position, "", ""], [v.revision || "00", "Reviewed by:", v.checked_by, v.checked_position, "", ""], [v.revision || "00", "Approved by:", v.approved_by, v.approved_position, "", ""]];
  table(ctx, ["Rev.", "Details", "Name", "Position", "Date", "Signature"], histRows, [0.07, 0.18, 0.25, 0.3, 0.1, 0.1], { size: 8 });
  if (v.previous_revision) {
    doc.y += 8;
    doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(`Rev. ${v.revision} – supersedes ${v.previous_revision}.`, M, doc.y, { width: TW });
  }
  // table of contents – filled once the sections are laid out
  newPage(ctx);
  const tocPage = doc.bufferedPageRange().count - 1;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("Table of Contents", M, doc.y);
  const tocY = doc.y + 18;
  const sections: [string, string, string][] = [
    ["1.0", "Executive Summary", values.executive_summary ?? ""],
    ["2.0", "Project Summary", values.project_summary ?? ""],
    ["3.0", "Relevant Contract Provisions", values.contract_provisions ?? ""],
    ["4.0", "The Contractor's Claim", values.contractor_claim ?? ""],
    ["5.0", "The Employer's Assessment", values.employer_assessment ?? ""],
    ["6.0", "Cost Assessment", values.cost_assessment ?? ""],
    ["7.0", "Conclusion and Recommendation", values.conclusion ?? ""],
  ];
  const starts: number[] = [];
  // the project summary and claim figures give the report its standard tables when the narrative is thin
  const projectTable: [string, string][] = [["Project Name", v.project_name], ["Contract No.", v.contract_no], ["Contractor", v.contractor], ["Contract Price", v.contract_price ? `SAR ${v.contract_price}` : "-"], ["Contract dated", v.contract_date || "-"], ["Time for Completion", v.completion_date || "-"], ["Previous Extension of Time", v.revised_completion_date ? `Revised Time for Completion ${v.revised_completion_date}` : "-"]];
  const claimTable: [string, string][] = isTime ? [["Claim reference", v.claim_letter_ref || "-"], ["Claim dated", v.claim_letter_date || "-"], ["Notice", `${v.notice_ref || "-"}${v.notice_date ? ` dated ${v.notice_date}` : ""}`], ["Extension of Time claimed", v.days_claimed ? `${v.days_claimed} days` : "-"], ["Extension of Time assessed", v.days_assessed ? `${v.days_assessed} days` : "-"], ["Assessed Time for Completion", v.assessed_completion_date || "-"]] : [["Claim reference", v.claim_letter_ref || "-"], ["Claim dated", v.claim_letter_date || "-"], ["Notice", `${v.notice_ref || "-"}${v.notice_date ? ` dated ${v.notice_date}` : ""}`], ["Amount claimed", v.amount_claimed ? `SAR ${v.amount_claimed}` : "-"], ["Amount assessed", v.amount_assessed ? `SAR ${v.amount_assessed}` : "-"]];
  sections.forEach(([no, title, text], idx) => {
    newPage(ctx);
    starts.push(doc.bufferedPageRange().count);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(`${no}    ${title}`, M, doc.y);
    doc.y += 18;
    const sectionNo = idx + 1;
    if (sectionNo === 2) {
      kv(ctx, projectTable, 1, 0.3);
      doc.y += 8;
    }
    if (sectionNo === 4) {
      kv(ctx, claimTable, 1, 0.3);
      doc.y += 8;
      if (isTime && values.delay_events) {
        const rows = personLines(values.delay_events).map((r) => [r[0] ?? "", r[1] ?? "", r[2] ?? "", r[3] ?? "", r[4] ?? ""]);
        table(ctx, ["Delay Event", "Title", "Clause", "Validity (in principle)", "Remarks"], rows, [0.1, 0.32, 0.14, 0.14, 0.3], { size: 7.5 });
        doc.y += 8;
      }
      if (!isTime && values.heads_of_claim) {
        const rows = personLines(values.heads_of_claim).map((r) => [r[0] ?? "", r[1] ?? "", r[2] ?? "", r[3] ?? ""]);
        table(ctx, ["Head of claim", "Claimed (SAR)", "Assessed (SAR)", "Basis"], rows, [0.34, 0.16, 0.16, 0.34], { size: 7.5, align: ["left", "right", "right", "left"] });
        doc.y += 8;
      }
    }
    const paras = numberedParagraphs(text, sectionNo);
    if (!paras.length) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("[To be completed]", M, doc.y);
      doc.y += 14;
    }
    for (const p of paras) {
      if (p.kind === "h") {
        ensure(ctx, 30);
        doc.y += 4;
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(`${p.no}    ${p.text}`, M, doc.y);
        doc.y += 16;
      } else if (p.kind === "t") {
        ensure(ctx, 16);
        doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text(p.text, M + 40, doc.y, { width: TW - 40, align: "center" });
        doc.y += 14;
      } else {
        const h = doc.font("Helvetica").fontSize(9.5).heightOfString(p.text, { width: TW - 44, lineGap: 1.5 });
        ensure(ctx, Math.min(h, 200) + 8);
        doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(p.no, M, doc.y, { width: 40, lineBreak: false });
        doc.text(p.text, M + 44, doc.y, { width: TW - 44, lineGap: 1.5 });
        doc.y += 8;
      }
    }
  });
  // fill in the table of contents
  doc.switchToPage(tocPage);
  let y = tocY;
  sections.forEach(([no, title], i) => {
    doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(no, M, y, { width: 36, lineBreak: false });
    doc.text(title, M + 40, y, { width: TW - 100, lineBreak: false });
    doc.text(String(starts[i]), W - M - 40, y, { width: 40, align: "right", lineBreak: false });
    doc.moveTo(M + 40 + doc.widthOfString(title) + 6, y + 8).lineTo(W - M - 44, y + 8).dash(1, { space: 2 }).lineWidth(0.4).stroke(LINE).undash();
    y += 16;
  });
  doc.switchToPage(doc.bufferedPageRange().count - 1);
  finish(ctx);
  void page;
  return done;
}

/* ------------------------------------------------------------------ */
/* generated annexure pages                                            */

/** "ANNEXURE 1 / DRAFT VARIATION ORDER (VO) …" – the RSG-style index page listing every annexure. */
export async function renderIndexPage(type: PackType, meta: FormMeta, entries: { no: number; title: string; attached: boolean }[], values: PackValues): Promise<Buffer> {
  const { doc, done } = newDoc(meta, "Index of annexures");
  const header = (d: Doc) => {
    d.y = 60;
  };
  const ctx = ctxFor(doc, type, values, meta, header);
  doc.rect(M, 40, TW, 30).fill(GRAPHITE);
  doc.rect(M, 40, 4, 30).fill(BRONZE);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(12).text(`${type.label.toUpperCase()}`, M + 12, 47, { width: TW - 24, lineBreak: false });
  doc.fillColor("#D8D9D6").font("Helvetica").fontSize(8).text("INDEX OF ANNEXURES", M + 12, 60, { lineBreak: false });
  doc.y = 90;
  table(ctx, ["SECTION", "DESCRIPTION", "ATTACHED", "NOT APPLICABLE"], entries.map((e) => [`ANNEXURE ${e.no}`, e.title.toUpperCase(), e.attached ? "✓" : "", e.attached ? "" : "✓"]), [0.18, 0.58, 0.12, 0.12], { size: 8.5, align: ["left", "left", "center", "center"] });
  doc.y += 20;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("#CLASSIFICATION: INTERNAL SENSITIVE", M, doc.y, { width: TW, align: "center" });
  finish(ctx);
  return done;
}

/** The draft Variation Order behind a PVO: the Employer's Instruction letter and the VO form (RSG-CM-FRM-0010). */
export async function renderDraftVo(type: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  const { doc, done } = newDoc(meta, "Draft Variation Order");
  const header = rsgHeader("Variation Order Form (RSG-CM-FRM-0010)", "Revision 05, Rev. Date 02-Feb-2023", "Variation Order Form");
  const ctx = ctxFor(doc, type, values, meta, header);
  const v = ctx.v;
  const voNo = v.vo_no || (v.pvo_no ? `VO-${v.pvo_no.replace(/\D/g, "").padStart(3, "0")}` : "VO-XXX");
  const clauses = v.contractual_basis?.match(/(?:sub-)?clauses?\s+[\d.]+[\d](?:\s*[\[(][^\])]+[\])])?(?:\s*(?:&|and|,)\s*(?:(?:sub-)?clauses?\s*)?[\d.]+[\d](?:\s*[\[(][^\])]+[\])])?)*/i)?.[0] ?? "Clause 3.4 (Employer's Instruction) and Clause 12.1 (Right to Vary)";
  // the Employer's Instruction letter
  doc.fillColor(MUTED).font("Helvetica").fontSize(7).text("AMAALA Company - C.R: 1010590650  ·  Building No. 8491, An Nu'aylah 48511-3110, Alwajh, Kingdom of Saudi Arabia", M, 24, { width: TW, align: "center" });
  doc.text("CLASSIFICATION: INTERNAL & SENSITIVE", M, 34, { width: TW, align: "center" });
  doc.y = 70;
  kv(ctx, [["Letter Ref.:", `${v.project_code ? v.project_code.replace(/\./g, "") : "1TB0XXX"}-XXXX-AMA-LTR-XXXX (draft – to be numbered on issue)`], ["Date:", v.date]], 2, 0.25);
  doc.y += 8;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(v.contractor || "", M, doc.y);
  doc.y += 6;
  kv(ctx, [["Attention:", "Contractor's Representative"], ["Project:", `${v.project_name}${v.project_code ? ` (${v.project_code})` : ""}`], ["Subject:", `Employer's Instruction – Variation Order No. ${voNo.replace(/^VO-?/i, "")} - ${v.title}`]], 1, 0.16);
  doc.y += 10;
  const body = [
    "Dear Sir,",
    `The Employer refers to the Construction Contract entered into between (i) AMAALA Company (as the 'Employer'); and (ii) ${v.contractor} (as the 'Contractor'), in respect of the ${v.works_package || v.contract_title}, Contract No. ${v.contract_no} ("Contract") for the ${v.project_name} project, Kingdom of Saudi Arabia (the 'Project').`,
    "All capitalized terms used in this letter but not otherwise defined herein shall have the same meaning as set out in the Contract.",
    `Pursuant to ${clauses} of the Contract, the Employer hereby instructs the Contractor to proceed with the following:`,
    v.scope || v.title,
    "Any additional costs beyond those allowed under the respective Bill items and included in accordance with the current contract specification will be considered a variation, subject to verification of its contractual merits. A Variation Order will be issued in accordance with the contract.",
    "The Contractor is required to complete the specified work in all respects and in accordance with the operational requirements of the RSG.",
  ];
  for (const p of body) {
    ensure(ctx, 40);
    doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(p, M, doc.y, { width: TW, lineGap: 1.5 });
    doc.y += 8;
  }
  doc.y += 10;
  doc.text("Yours faithfully,", M, doc.y);
  doc.y += 40;
  doc.font("Helvetica-Bold").text(v.employer_rep ? `${v.employer_rep}${v.employer_rep_position ? ` (${v.employer_rep_position})` : ""}` : "Employer's Representative", M, doc.y);
  doc.y += 12;
  doc.font("Helvetica").text("Employer's Representative, AMAALA Company", M, doc.y);
  // the VO form
  newPage(ctx);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7).text("This Variation Order is issued in accordance with the Terms and Conditions of the Contract. Terms defined in the Contract have the same meaning as in this Variation Order unless otherwise defined.", M, doc.y, { width: TW });
  doc.y += 18;
  section(ctx, "General Information");
  kv(ctx, [["Variation Order No.", voNo], ["Date", v.date], ["Project Name", dash(v.project_name)], ["Project Code", dash(v.project_code)], ["Contract Name", dash(v.contract_title)], ["Contract No.", dash(v.contract_no)], ["Works Package", dash(v.works_package)], ["Contractor/Consultant", dash(v.contractor)], ["Rev. No.", dash(v.revision)], ["Estimated 'time impact' of this variation (Days)", dash(v.time_impact)]]);
  section(ctx, "Variation");
  kv(ctx, [["Variation Title:", dash(v.title)]], 1, 0.19);
  table(ctx, ["Instruction Reference", "Description"], [[voNo, `Pursuant to ${clauses} of the Contract, the Employer hereby instructs the Contractor to proceed with the following;\n${v.scope || v.title}`]], [0.2, 0.8], { size: 8 });
  section(ctx, "Information Provided with this Variation Order");
  const info = personLines(ctx.raw.information_provided ?? "");
  table(ctx, ["Document Ref. No.", "Document Title", "Rev. Date"], info.length ? info.map((r, i) => [r[0] || String(i + 1), r[1] ?? "", r[3] ?? r[2] ?? ""]) : [["1", "Drawings and particulars as attached to the PVO", v.date]], [0.25, 0.55, 0.2]);
  doc.y += 6;
  signatureBlock(ctx, [["Approved and Issued by (Employer's Representative)", v.employer_rep, v.employer_rep_position], ["Received by (Consultant/Contractor's Representative)", v.contractor_rep, v.contractor_rep_position]]);
  finish(ctx);
  return done;
}

/** ANNEXURE – BUDGET PARTICULARS: subject, source and destination of the budget. */
export async function renderBudgetParticulars(type: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  const { doc, done } = newDoc(meta, "Budget particulars");
  const ctx = ctxFor(doc, type, values, meta, (d) => { d.y = 60; });
  const v = ctx.v;
  doc.rect(M, 40, TW, 26).fill(GRAPHITE);
  doc.rect(M, 40, 4, 26).fill(BRONZE);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(12).text("BUDGET PARTICULARS", M + 12, 47);
  doc.y = 84;
  const amount = v.total_value || v.dvo_value || v.amount || "";
  kv(ctx, [["SUBJECT:", dash(v.title)], ["SOURCE OF THE BUDGET:", `${v.budget_line ? `Budget on Hold - ${v.budget_line.replace(/[:\s]+$/, "")}` : "-"}${v.budget_available ? ` – SAR ${sar(num(ctx.raw.budget_available))}` : ""}`], ["DESTINATION OF THE BUDGET:", `${v.contractor ? `${v.contractor.split(" ")[0]} ` : ""}Original Contract Budget ${v.budget_to_line || v.contract_no || "-"} – Variations`], ["AMOUNT OF THIS CHANGE:", amount ? `SAR ${amount}` : "-"], ["BUDGET SOURCE OPTION:", dash(v.budget_source)]], 1, 0.3);
  doc.y += 12;
  if (v.budget_available && amount) {
    const after = num(ctx.raw.budget_available) - num(amount);
    table(ctx, ["Control Account", "Current Budget (SAR)", "This change (SAR)", "Revised Budget (SAR)"], [[(v.budget_line || "Budget hold").replace(/[:\s]+$/, ""), sar(num(ctx.raw.budget_available)), sar(-num(amount)), sar(after)], [v.budget_to_line || v.contract_no || "This contract", sar(num(ctx.raw.current_revised) || num(ctx.raw.contract_price) || num(ctx.raw.original_contract)), sar(num(amount)), sar((num(ctx.raw.current_revised) || num(ctx.raw.contract_price) || num(ctx.raw.original_contract)) + num(amount))]], [0.4, 0.2, 0.2, 0.2], { align: ["left", "right", "right", "right"], size: 8 });
  }
  doc.y += 20;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("#CLASSIFICATION: INTERNAL SENSITIVE", M, doc.y, { width: TW, align: "center" });
  finish(ctx);
  return done;
}

/** ANNEXURE – CHANGE LOG: every change on the contract with its RFC, PVO, VO and DVO refs and values, this one marked. */
export async function renderChangeLog(type: PackType, values: PackValues, meta: FormMeta, rows: ChangeLogRow[]): Promise<Buffer> {
  const { doc, done } = newDoc(meta, "Change log");
  const ctx = ctxFor(doc, type, values, meta, (d) => { d.y = 60; });
  const v = ctx.v;
  doc.rect(M, 40, TW, 26).fill(GRAPHITE);
  doc.rect(M, 40, 4, 26).fill(BRONZE);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(12).text("CHANGE LOG", M + 12, 47);
  doc.y = 84;
  kv(ctx, [["Contract No.", dash(v.contract_no)], ["Contractor's Name", dash(v.contractor)], ["Scope of Works", dash(v.works_package || v.contract_title)], ["Contract Completion Date", dash(v.original_completion || v.completion_date)], ["Revised Completion Date", dash(v.current_completion || v.revised_completion || v.revised_completion_date)]], 2, 0.4);
  doc.y += 8;
  const original = num(ctx.raw.original_contract) || num(ctx.raw.contract_price);
  const thisValue = num(ctx.raw.total_value) || num(ctx.raw.dvo_value);
  const body = rows.map((r, i) => [String(i + 1), r.description + (r.thisOne ? `  (this ${type.short})` : ""), r.rfc || "-", r.pvo || "-", r.vo || "-", r.dvo || "-", r.pvoValue === null ? "-" : sar(r.pvoValue), r.dvoValue === null ? "-" : sar(r.dvoValue)]);
  const totalPvo = rows.reduce((t, r) => t + (r.pvoValue ?? 0), 0);
  const totalDvo = rows.reduce((t, r) => t + (r.dvoValue ?? 0), 0);
  table(ctx, ["Sr", "Description", "RFC", "PVO", "VO", "DVO", "PVO value (SAR)", "DVO value (SAR)"], [["", "Original Contract", "", "", "", "", sar(original), ""], ...body, ["", `This ${type.short}`, "", "", "", "", sar(thisValue), ""], ["", "Total", "", "", "", "", sar(original + totalPvo), sar(totalDvo)]], [0.05, 0.31, 0.09, 0.09, 0.09, 0.09, 0.14, 0.14], { size: 7, align: ["left", "left", "left", "left", "left", "left", "right", "right"], boldLast: true });
  doc.y += 16;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Classification: Internal", M, doc.y, { width: TW, align: "center" });
  finish(ctx);
  return done;
}

/** ANNEXURE – CONTRACTUAL BASIS FOR VARIATION ENTITLEMENT: the clause relied on, as stated on the PVO. */
export async function renderBasisPage(type: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  const { doc, done } = newDoc(meta, "Contractual basis");
  const ctx = ctxFor(doc, type, values, meta, (d) => { d.y = 60; });
  const v = ctx.v;
  doc.rect(M, 40, TW, 26).fill(GRAPHITE);
  doc.rect(M, 40, 4, 26).fill(BRONZE);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(12).text("CONTRACTUAL BASIS FOR VARIATION ENTITLEMENT", M + 12, 47);
  doc.y = 84;
  kv(ctx, [["Contract", `${v.contract_title || v.works_package}${v.contract_no ? ` – ${v.contract_no}` : ""}`], ["Contractor", dash(v.contractor)], ["Change", dash(v.title)]], 1, 0.22);
  doc.y += 10;
  block(ctx, "Contractual basis for variation entitlement:", v.contractual_basis || "[The clause relied on – e.g. Pursuant to Contract Sub-Clause 12.1 [Right to Vary] & 12.3 [Variation Proposal]]", 40);
  doc.y += 8;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("The relevant pages of the Conditions of Contract follow, where attached.", M, doc.y);
  doc.y += 20;
  doc.text("#CLASSIFICATION: INTERNAL SENSITIVE", M, doc.y, { width: TW, align: "center" });
  finish(ctx);
  return done;
}
