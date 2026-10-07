import { AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import ExcelJS from "exceljs";
import { formatMoney } from "../format";
import { basisKind, clean, dmy, evoLetter, items, lines, longDate, narrativeOf, num, pvoNoOf, sar, voDescription, voNoOf } from "./annexures";
import type { ChangeLogRow } from "./data";
import type { PackType, PackValues } from "./shared";

/**
 * Every document of a pack in its own file type as well: the letters and narrative pages as Word,
 * the schedules and figures as Excel. The content is the same as the pages of the compiled pack –
 * the same values, the same wording – laid out plainly so it can be edited and sent on.
 */

export type DocFormat = "pdf" | "docx" | "xlsx";
export interface PackDocument {
  id: string;
  label: string;
  formats: DocFormat[];
}

/** The documents a pack of this kind is made of, each with the file types it comes in. */
export function packDocuments(t: PackType): PackDocument[] {
  const form: PackDocument = { id: "form", label: `${t.short} form`, formats: ["pdf", "xlsx", "docx"] };
  if (t.key === "pvo")
    return [
      form,
      { id: "letter", label: "Employer's letter – Variation Order", formats: ["pdf", "docx"] },
      { id: "vo_form", label: "Variation Order (draft VO)", formats: ["pdf", "docx"] },
      { id: "appendix01", label: "Appendix 01 – particulars of the Variation", formats: ["pdf", "xlsx"] },
      { id: "summary", label: "Executive summary", formats: ["pdf", "docx"] },
      { id: "basis", label: "Contractual basis", formats: ["pdf", "docx"] },
      { id: "assessment", label: "Employer's assessment of cost and time", formats: ["pdf", "docx"] },
      { id: "budget", label: "Budget particulars", formats: ["pdf", "xlsx"] },
      { id: "contract_summary", label: "Contract summary", formats: ["pdf", "xlsx"] },
      { id: "change_log", label: "Change log", formats: ["pdf", "xlsx"] },
    ];
  if (t.key === "vo")
    return [
      form,
      { id: "letter", label: "Employer's letter – Variation Order", formats: ["pdf", "docx"] },
      { id: "vo_form", label: "Variation Order (Emergency Protocol)", formats: ["pdf", "docx"] },
    ];
  if (t.key === "dvo")
    return [form, { id: "budget", label: "Budget particulars", formats: ["pdf", "xlsx"] }, { id: "contract_summary", label: "Contract summary", formats: ["pdf", "xlsx"] }, { id: "change_log", label: "Change log", formats: ["pdf", "xlsx"] }];
  return [form];
}

/* ------------------------------------------------------------------ */
/* Word                                                                */

type Block = { h: string } | { p: string; bold?: boolean; italic?: boolean; size?: number } | { kv: [string, string][] } | { table: { head: string[]; rows: string[][]; widths?: number[]; align?: ("left" | "right" | "center")[]; boldLast?: boolean } } | { bullets: string[] } | { gap: number };

const FONT = "Arial";
const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
const run = (text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}) => new TextRun({ text: clean(text), bold: opts.bold, italics: opts.italic, size: (opts.size ?? 10) * 2, font: FONT, color: opts.color });
const para = (text: string, opts: { bold?: boolean; italic?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number } = {}) =>
  new Paragraph({ children: clean(text).split("\n").flatMap((l, i) => (i ? [new TextRun({ break: 1 }), run(l, opts)] : [run(l, opts)])), alignment: opts.align, spacing: { after: opts.after ?? 120, before: opts.before ?? 0 } });
const cell = (text: string, opts: { bold?: boolean; shade?: string; width: number; align?: "left" | "right" | "center"; size?: number }) =>
  new TableCell({ borders, width: { size: opts.width, type: WidthType.DXA }, shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: "auto" } : undefined, margins: { top: 60, bottom: 60, left: 90, right: 90 }, children: [new Paragraph({ children: [run(text, { bold: opts.bold, size: opts.size ?? 9 })], alignment: opts.align === "right" ? AlignmentType.RIGHT : opts.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT })] });

async function docxOf(blocks: Block[], title: string): Promise<Buffer> {
  const TOTAL = 9360;
  const children: (Paragraph | Table)[] = [];
  for (const b of blocks) {
    if ("h" in b) children.push(para(b.h, { bold: true, size: 11, before: 160, after: 80 }));
    else if ("p" in b) children.push(para(b.p, { bold: b.bold, italic: b.italic, size: b.size ?? 10, align: AlignmentType.JUSTIFIED }));
    else if ("bullets" in b) for (const l of b.bullets) children.push(para(l.startsWith("•") ? l : `• ${l}`, { size: 10, after: 60 }));
    else if ("gap" in b) children.push(new Paragraph({ spacing: { after: b.gap * 20 } }));
    else if ("kv" in b) {
      const rows = b.kv.map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, shade: "F4EEE0", width: Math.round(TOTAL * 0.24) }), cell(v, { width: Math.round(TOTAL * 0.76) })] }));
      children.push(new Table({ rows, width: { size: TOTAL, type: WidthType.DXA }, columnWidths: [Math.round(TOTAL * 0.24), Math.round(TOTAL * 0.76)] }));
      children.push(new Paragraph({ spacing: { after: 120 } }));
    } else if ("table" in b) {
      const widths = (b.table.widths ?? b.table.head.map(() => 1 / b.table.head.length)).map((w) => Math.round(TOTAL * w));
      const rows = [new TableRow({ tableHeader: true, children: b.table.head.map((h, i) => cell(h, { bold: true, shade: "1F3864", width: widths[i], align: b.table.align?.[i] })) })];
      for (let r = 0; r < b.table.rows.length; r++) {
        const last = b.table.boldLast && r === b.table.rows.length - 1;
        rows.push(new TableRow({ children: b.table.rows[r].map((c, i) => cell(c, { width: widths[i], align: b.table.align?.[i], bold: last, shade: last ? "F2F2F2" : undefined })) }));
      }
      children.push(new Table({ rows, width: { size: TOTAL, type: WidthType.DXA }, columnWidths: widths }));
      children.push(new Paragraph({ spacing: { after: 120 } }));
    }
  }
  const doc = new Document({
    creator: "Commercial Dashboard",
    title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, bottom: 1100, left: 1270, right: 1270 } } }, children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/* ------------------------------------------------------------------ */
/* Excel                                                               */

/** a cell: text, a number, empty, or a live formula with the figure it gives */
type Cell = string | number | null | { formula: string; result: number };
interface Sheet {
  name: string;
  rows: Cell[][];
  widths?: number[];
  bold?: number[];
  money?: number[];
  title?: string;
}
async function xlsxOf(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Commercial Dashboard";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    let r = 1;
    if (s.title) {
      ws.getCell(r, 1).value = s.title;
      ws.getCell(r, 1).font = { bold: true, size: 13 };
      r += 2;
    }
    const start = r;
    for (const row of s.rows) {
      row.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        if ((typeof v === "number" || (v && typeof v === "object")) && s.money?.includes(i)) c.numFmt = "#,##0.00;(#,##0.00)";
        c.alignment = { vertical: "top", wrapText: true };
      });
      if (s.bold?.includes(r - start)) ws.getRow(r).font = { bold: true };
      r++;
    }
    (s.widths ?? []).forEach((w, i) => (ws.getColumn(i + 1).width = w));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------ */
/* the documents                                                       */

const MIME: Record<DocFormat, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
export const mimeOf = (f: DocFormat) => MIME[f];

export async function letterDocx(v: PackValues, evo: boolean): Promise<Buffer> {
  const n = narrativeOf(v);
  const no = voNoOf(v);
  const paragraphs = evo && !v.__narrative ? evoLetter(v) : n.letter_paragraphs;
  const letterRef = `${String(v.contract_no ?? v.contract_ref ?? "").replace(/[-.]/g, "").slice(0, 12) || "1TB0XXXX-XXXXXX"}-AMA-LTR-00XX`.replace(/^(\w{8})(\w{6})/, "$1-$2");
  return docxOf(
    [
      { p: `Letter Ref.: ${letterRef}`, bold: true },
      { kv: [["From:", 'AMAALA Company ("Employer")\nBuilding No. 8491, An Nu\'aylah 6726, Zip Code: 48511, Alwajh, Kingdom of Saudi Arabia.'], ["To:", `${v.contractor || "the Contractor"} ("Contractor")${v.contractor_address ? `\n${v.contractor_address}` : ""}`], ["Subject:", `Variation Order VO (No. ${no}) – ${v.title ?? ""}`], ["Date:", v.date ? longDate(v.date) : ""]] },
      ...paragraphs.map((p) => ({ p })),
      { gap: 10 },
      { p: "Signed:", bold: true },
      { gap: 24 },
      { p: "___________________________________" },
      { p: String(v.employer_rep || "Employer's Representative"), bold: true },
      { p: String(v.employer_rep_position || "Employer's Representative") },
      { p: evo ? `Enclosed: Variation Order (VO) No. ${no}` : `Enclosed: Variation Order (VO) No. ${no} and Appendix 01`, italic: true, size: 9 },
    ],
    "Employer's letter",
  );
}

export async function voFormDocx(v: PackValues, evo: boolean, projectCode = ""): Promise<Buffer> {
  const n = narrativeOf(v);
  const no = voNoOf(v);
  const impact = Math.round(num(v.time_impact));
  const info = lines(v.information_provided).map((l) => l.split(/\s+[–-]\s+/));
  const rows = info.length ? info : [["Appendix 01", `Schedule to Variation Order No. ${no} – ${v.title ?? ""}`, "0", v.date ? dmy(v.date) : ""]];
  return docxOf(
    [
      { p: evo ? "Variation Order Form (RSG-CM-FRM-0034)" : "Variation Order (VO) – AMA-CM-FRM-0013", bold: true, size: 13 },
      { p: evo ? "This Variation Order is issued under the Emergency Protocol and in accordance with the Terms and Conditions of the Contract. Terms defined in the Contract have the same meaning as in this Variation Order unless otherwise defined." : "This Variation Order is issued in accordance with the Terms and Conditions of the Contract. Terms defined in the Contract have the same meaning as in this Variation Order unless otherwise defined.", size: 9 },
      { h: "General Information" },
      { kv: [["Variation Order No.", no], ["Date", v.date ? dmy(v.date) : ""], ["Project Name", [v.program_name, v.development_name].filter(Boolean).join(" - ") || String(v.project_name ?? "")], ["Project Code", projectCode || String(v.project_code ?? "")], ["Contract Name", String(v.contract_title || v.project_name || "")], ["Contract No.", String(v.contract_no ?? "")], ["Works Package", String(v.works_package ?? "")], ["Contractor/Consultant", String(v.contractor ?? "")]] },
      { h: "Variation Title" },
      { p: String(v.title ?? "") },
      { h: `Instruction Reference: VO-${no}` },
      { p: evo ? voDescription(v) : n.vo_bullets.join("\n") },
      { h: "Time Impact (Contract Level)" },
      { kv: [["Estimated 'time impact' of this variation (Days)", impact ? String(impact) : "TBA"]] },
      { h: "Information Provided with this Variation Order" },
      { table: { head: ["Document Ref. No.", "Document Title", "Rev. No.", "Rev. Date"], rows: rows.map((r) => [r[0] ?? "", r[1] ?? "", r[2] ?? "", r[3] ?? ""]), widths: [0.2, 0.56, 0.1, 0.14] } },
      { h: "Approved and Issued by (Employer's Representative)" },
      { kv: [["Name", String(v.employer_rep ?? "")], ["Position", String(v.employer_rep_position || "Employer's Representative")], ["Signature / Date", ""]] },
      { h: "Received by (Consultant/Contractor's Representative)" },
      { kv: [["Name", String(v.contractor_rep ?? "")], ["Position", String(v.contractor_rep_position || "Contractor's Representative")], ["Signature / Date", ""]] },
    ],
    "Variation Order",
  );
}

export async function summaryDocx(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  return docxOf([{ p: `Executive Summary – ${basisKind(String(v.rfc_ref ?? "")).label}`, bold: true, size: 13 }, ...n.executive_summary.map((p) => ({ p }))], "Executive summary");
}

export async function basisDocx(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  const price = num(v.original_contract) || num(v.contract_price);
  return docxOf(
    [
      { p: "CONTRACTUAL BASIS FOR VARIATION ENTITLEMENT", bold: true, size: 13 },
      { p: `PVO ${pvoNoOf(v)} – ${v.title ?? ""}`, size: 9 },
      { kv: [["Contract", `${v.contract_title ? `${v.contract_title} ` : ""}${v.contract_no ? `Contract Ref. No. ${v.contract_no}` : ""}${v.works_package ? ` – ${v.works_package}` : ""}${v.project_name ? ` for the ${v.project_name}` : ""}`], ["Parties", `AMAALA Company (the Employer) and ${v.contractor ?? "the Contractor"} (the Contractor)`], ["Contract Date", v.commencement_date ? longDate(v.commencement_date) : "As per the Contract"], ["Contract Price", price ? `SAR ${formatMoney(price)} (excluding VAT)` : "As per the Contract"]] },
      { table: { head: ["Sub-Clause", "Title", "Application to this PVO"], rows: n.basis_rows.map((r) => [r.clause, r.title, r.application]), widths: [0.14, 0.26, 0.6], align: ["center", "left", "left"] } },
      { p: "Note: The signed Contract pages (cover page and the Sub-Clauses listed above) are to be appended to this Annexure, with the relevant Sub-Clauses highlighted.", italic: true, size: 8 },
    ],
    "Contractual basis",
  );
}

export async function assessmentDocx(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  const its = items(v);
  const total = num(v.total_value) || its.reduce((a, b) => a + b.add - b.omit, 0);
  const rom = num(v.rom_estimate);
  const rows: string[][] = (its.length ? its : [{ ref: "1", desc: String(v.title ?? ""), omit: total < 0 ? -total : 0, add: total > 0 ? total : 0 }]).map((it) => [it.desc, sar(it.add - it.omit), total < 0 ? "Recovered under this PVO" : "Included in this PVO"]);
  if (rom && Math.abs(rom - Math.abs(total)) > 0.5) rows.push(["Contractor's proposal / ROM as submitted", sar(rom), `Assessed to ${sar(Math.abs(total))}`]);
  rows.push([total < 0 ? "Recoverable under this PVO (SAR)" : "Value of this PVO (SAR)", sar(total), "PVO form, Section 2 b)"]);
  return docxOf(
    [
      { p: "PARTICULARS OF 'ESTIMATED COST & TIME IMPACT'", bold: true, size: 13 },
      { p: `Employer's Assessment – PVO ${pvoNoOf(v)} / draft VO ${voNoOf(v)}`, size: 9 },
      { h: "1. Basis of assessment" },
      { p: n.assessment_basis },
      { h: "2. Reconciliation of the value" },
      { table: { head: ["Item", "Amount (SAR)", "Treatment in this PVO"], rows, widths: [0.5, 0.18, 0.32], align: ["left", "right", "left"], boldLast: true } },
      { h: "3. Evidence" },
      { p: n.assessment_evidence },
      { h: "4. Exclusions and time impact" },
      { bullets: n.assessment_exclusions },
    ],
    "Employer's assessment",
  );
}

export async function appendix01Xlsx(v: PackValues): Promise<Buffer> {
  const its = items(v);
  const total = num(v.total_value) || its.reduce((a, b) => a + b.add - b.omit, 0);
  const list = its.length ? its : [{ ref: "1", desc: String(v.title ?? ""), omit: total < 0 ? -total : 0, add: total > 0 ? total : 0 }];
  const rows: (string | number | null)[][] = [["No.", "Description", "Omit (SAR)", "Add (SAR)", "Net (SAR)"], ...list.map((it, i) => [i + 1, it.desc, it.omit || null, it.add || null, it.add - it.omit]), ["", "TOTAL VALUE OF THIS VARIATION ORDER (SAR)", null, null, total]];
  return xlsxOf([{ name: "Appendix 01", title: `APPENDIX 01 TO VARIATION ORDER No. ${voNoOf(v)} – ${clean(v.title)}`, rows, widths: [6, 70, 16, 16, 16], bold: [0, rows.length - 1], money: [2, 3, 4] }]);
}

export async function budgetXlsx(v: PackValues, short: string): Promise<Buffer> {
  const n = narrativeOf(v);
  const total = num(v.total_value) || num(v.dvo_value) || num(v.add) - num(v.omit);
  const budget = num(v.approved_contract) || num(v.original_contract) || num(v.contract_price);
  const current = num(v.acc_budget) || budget;
  const dvos = num(v.approved_dvos) || num(v.previous_dvos);
  const before = current - budget - dvos;
  const after = before - total;
  const rows: (string | number | null)[][] = [
    ["SUBJECT", clean(v.title)],
    ["BUDGET TREATMENT", n.budget_treatment],
    [],
    ["Description", "Amount (SAR)"],
    [`Current approved budget in ACC${v.budget_to_line ? ` – ${v.budget_to_line}` : ""}`, current],
    ["Less: Approved contract (Original Contract Value)", -budget],
    ["Less: Approved DVOs to date", -dvos],
    [`Remaining budget before this ${short}`, before],
    [`${total < 0 ? "Add" : "Less"}: This ${short}`, -total],
    [`Remaining budget after this ${short}`, after],
  ];
  return xlsxOf([{ name: "Budget particulars", title: "BUDGET PARTICULARS", rows, widths: [60, 22], bold: [3, 7, 9], money: [1] }]);
}

/** a cancelled, rejected or superseded change stays in the log with no value */
const dead = (r: ChangeLogRow) => /^(cancelled|rejected|superseded)$/i.test(r.status ?? "");

export async function changeLogXlsx(v: PackValues, log: ChangeLogRow[]): Promise<Buffer> {
  const original = num(v.original_contract) || num(v.contract_price);
  const thisValue = num(v.total_value) || num(v.dvo_value) || num(v.add) - num(v.omit);
  const rows: (string | number | null)[][] = [
    ["Contract No.", String(v.contract_no ?? v.contract_ref ?? "")],
    ["Contractor's Name", String(v.contractor ?? "")],
    ["Scope of Works", String(v.works_package ?? v.contract_title ?? "")],
    ["Contract Completion Date", dmy(v.original_completion)],
    ["Revised Completion Date", dmy(v.current_completion || v.revised_completion || v.original_completion)],
    [],
    ["Sr", "Description", "RFC", "PVO", "VO", "DVO", "Contract Value", "PVO", "DVO", "This PVO / DVO"],
    ["", "Original Contract", "", "", "", "", original || null, null, null, null],
    ...log.filter((r) => !r.thisOne).map((r, i) => [i + 1, r.description, r.rfc || "-", r.pvo || "-", r.vo || "-", r.dvo || "-", null, dead(r) ? "Cancelled" : r.dvoValue === null && r.pvoValue !== null ? r.pvoValue : r.dvoValue === null ? "Cancelled" : null, dead(r) ? null : r.dvoValue, null]),
    ["", `This PVO / DVO (${v.title ?? ""})`, "", "", "", "", null, null, null, thisValue || null],
  ];
  const totalPvo = log.filter((r) => !r.thisOne && !dead(r) && r.dvoValue === null).reduce((t, r) => t + (r.pvoValue ?? 0), 0);
  const totalDvo = log.filter((r) => !r.thisOne && !dead(r)).reduce((t, r) => t + (r.dvoValue ?? 0), 0);
  rows.push(["", "Total", "", "", "", "", original || null, totalPvo, totalDvo, thisValue || null]);
  return xlsxOf([{ name: "Change Log", title: "CHANGE LOG", rows, widths: [5, 60, 10, 10, 10, 10, 18, 16, 16, 16], bold: [6, rows.length - 1], money: [6, 7, 8, 9] }]);
}

/** The contract summary as a workbook: every change with its status, approval reference and value, the totals and the potential revised contract value. */
export async function contractSummaryXlsx(v: PackValues, log: ChangeLogRow[], kind: "PVO" | "DVO"): Promise<Buffer> {
  const original = num(v.original_contract) || num(v.contract_price);
  const thisValue = num(v.total_value) || num(v.dvo_value) || num(v.add) - num(v.omit);
  const live = log.filter((r) => !r.thisOne && !/^(cancelled|rejected|superseded)$/i.test(r.status ?? ""));
  let agreed = 0;
  let unagreed = 0;
  const no = kind === "PVO" ? pvoNoOf(v) : String(v.dvo_no ?? "").replace(/\D/g, "") || pvoNoOf(v);
  const rows: Cell[][] = [
    ["Contractor", String(v.contractor ?? "")],
    ["Contract No.", String(v.contract_no ?? v.contract_ref ?? "")],
    ["Scope of Works", String(v.works_package ?? v.contract_title ?? "")],
    [],
    ["Reference", "Description", "Current status", "Approval reference", "Contract value (SAR)", "Agreed VO (SAR)", "Unagreed VO (SAR)", `This ${kind} (SAR)`],
    ["Contract", "Contract Price", "", "", original || null, null, null, null],
  ];
  for (const r of live) {
    const isAgreed = r.status === "DVO approved";
    const value = isAgreed ? (r.dvoValue ?? r.pvoValue) : (r.pvoValue ?? r.dvoValue);
    if (isAgreed) agreed += value ?? 0;
    else unagreed += value ?? 0;
    rows.push([r.pvo || r.itemNo || "", r.description, r.status ?? "", r.approvalRef ?? "", null, isAgreed ? value : null, isAgreed ? null : value, null]);
  }
  rows.push([`${kind} ${no}`, String(v.title ?? ""), `This ${kind} – for approval`, "", null, null, null, thisValue || null]);
  // the sheet starts with its title on row 1 and a blank row: the table's first data row (Contract Price) is row 9
  const first = 9;
  const last = first + rows.length - 7;
  const sum = (col: string, result: number) => ({ formula: `SUM(${col}${first}:${col}${last})`, result });
  rows.push(["Totals", "", "", "", sum("E", original), sum("F", agreed), sum("G", unagreed), sum("H", thisValue)]);
  const totals = last + 1;
  rows.push([`Potential Revised Contract Value (after this ${kind})`, "", "", "", { formula: `E${totals}+F${totals}+G${totals}+H${totals}`, result: original + agreed + unagreed + thisValue }, null, null, null]);
  return xlsxOf([{ name: "Contract Summary", title: `CONTRACT SUMMARY – ${String(v.contractor ?? "")}`, rows, widths: [22, 60, 18, 26, 18, 16, 16, 16], bold: [4, rows.length - 2, rows.length - 1], money: [4, 5, 6, 7] }]);
}

/** The form's values as a plain workbook – one row per field, in the sections of the form – when no RSG workbook was uploaded to write into. */
export async function formXlsx(t: PackType, v: PackValues): Promise<Buffer> {
  const rows: (string | number | null)[][] = [];
  const bold: number[] = [];
  for (const g of t.groups) {
    const fields = t.fields.filter((f) => f.group === g);
    if (!fields.length) continue;
    bold.push(rows.length);
    rows.push([g, null]);
    for (const f of fields) {
      const raw = v[f.key] ?? "";
      const n = f.kind === "money" || f.kind === "number" ? num(raw) : NaN;
      rows.push([f.label, raw !== "" && Number.isFinite(n) ? n : clean(raw)]);
    }
    rows.push([null, null]);
  }
  return xlsxOf([{ name: `${t.short} form`.slice(0, 31), title: `${t.label.toUpperCase()} (${t.formRef})`, rows, widths: [42, 90], bold, money: [1] }]);
}
