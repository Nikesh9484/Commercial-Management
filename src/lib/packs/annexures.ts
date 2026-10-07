/**
 * The pages of a PVO pack that the dashboard writes itself, laid out as the approved packs are:
 * the Employer's letter and the draft Variation Order with its appendix (Annexure 1), the
 * executive summary that opens the change assessment pack (Annexure 2), the contractual basis
 * (Annexure 3), the Employer's assessment of the cost and time impact (Annexure 4), the budget
 * particulars (Annexure 5) and the change log (Annexure 6).
 *
 * The wording comes from the values read from the uploaded files. Where a narrative has been
 * drafted for the pack (see narrative.ts) it is used; otherwise the sentences are built from the
 * values alone.
 */
import PDFDocument from "pdfkit";
import { formatDate, formatMoney } from "../format";
import type { ChangeLogRow } from "./data";
import type { PackValues } from "./shared";

type Doc = InstanceType<typeof PDFDocument>;
const W = 595.28;
const H = 841.89;
const M = 48;
const TW = W - M * 2;
const NAVY = "#1F3864";
const INK = "#222222";
const MUTED = "#6B6F75";
const LINE = "#BFBFBF";
const PALE = "#F2F2F2";
const BEIGE = "#F4EEE0";

/** the narrative a pack may carry, drafted or templated */
export interface Narrative {
  letter_paragraphs?: string[];
  vo_bullets?: string[];
  executive_summary?: string[];
  basis_rows?: { clause: string; title: string; application: string }[];
  assessment_basis?: string;
  assessment_evidence?: string;
  assessment_exclusions?: string[];
  budget_treatment?: string;
}

export const num = (s: unknown) => {
  const t = String(s ?? "").trim();
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const n = Number(t.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && /\d/.test(t) ? (neg ? -n : n) : 0;
};
export const sar = (n: number) => (n < 0 ? `(${formatMoney(-n)})` : formatMoney(n));
export const dmy = (s: unknown) => {
  const t = String(s ?? "").trim();
  return t ? formatDate(t) || t : "";
};
export const longDate = (s: unknown) => {
  const t = String(s ?? "").trim();
  const d = t ? new Date(t) : null;
  if (!d || Number.isNaN(d.getTime())) return t;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
};
export const clean = (t: unknown) => String(t ?? "").replace(/\r\n?/g, "\n").replace(/[‐-―]/g, "–").replace(/[^\x09\x0A\x20-\x7E -ɏ‐-‧€]/g, "").trim();
export const lines = (v: unknown) => clean(v).split(/\n/).map((s) => s.trim()).filter(Boolean);
export const voNoOf = (v: PackValues) => {
  const raw = String(v.vo_no ?? "").replace(/^VO[\s-]*/i, "") || String(v.pvo_no ?? "").replace(/\D/g, "");
  return raw ? raw.padStart(3, "0") : "0XX";
};
export const pvoNoOf = (v: PackValues) => (String(v.pvo_no ?? "").replace(/\D/g, "") || "0XX").padStart(3, "0");
export const items = (v: PackValues) =>
  lines(v.cost_items).map((l) => {
    const parts = l.split(/\s+[–-]\s+/);
    if (parts.length >= 4) return { ref: parts[0], desc: parts.slice(1, -2).join(" – "), omit: num(parts[parts.length - 2]), add: num(parts[parts.length - 1]) };
    return { ref: "", desc: l, omit: 0, add: 0 };
  });
const clausesOf = (basis: string) => {
  const out: { clause: string; title: string }[] = [];
  const re = /(?:sub-?\s?clauses?\s*)?(\d{1,2}(?:\.\d{1,2}){1,2})\s*[\[(]([^\])]+)[\])]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(basis))) if (!out.some((o) => o.clause === m![1])) out.push({ clause: m[1], title: m[2].trim() });
  return out;
};

/* ------------------------------------------------------------------ */
/* drawing                                                             */

function newDoc(title: string, landscape = false): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: M, bufferPages: true, info: { Title: title } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}
function finish(doc: Doc, left: string, classification = "CLASSIFICATION: INTERNAL SENSITIVE") {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const w = doc.page.width;
    const h = doc.page.height;
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text(left, M, h - 26, { width: w / 2, lineBreak: false });
    doc.text(classification, w / 2, h - 26, { width: w / 2 - M, align: "right", lineBreak: false });
    if (range.count > 1) doc.text(`Page ${i + 1} of ${range.count}`, w / 2 - 40, h - 26, { width: 80, align: "center", lineBreak: false });
  }
  doc.end();
}
function title(doc: Doc, text: string, sub?: string, sub2?: string) {
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text(text, M, 60, { width: TW, align: "center" });
  let y = 80;
  if (sub) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(clean(sub), M, y, { width: TW, align: "center" });
    y += 14;
  }
  if (sub2) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(7.5).text(clean(sub2), M, y, { width: TW, align: "center" });
    y += 12;
  }
  doc.y = y + 12;
  doc.fillColor(INK);
}
function para(doc: Doc, text: string, opts: { size?: number; bold?: boolean; gap?: number; indent?: number; align?: "left" | "justify" } = {}) {
  if (doc.y > H - 80) doc.addPage();
  doc.fillColor(INK).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 9.5).text(clean(text), M + (opts.indent ?? 0), doc.y, { width: TW - (opts.indent ?? 0), lineGap: 2, align: opts.align ?? "left" });
  doc.y += opts.gap ?? 8;
}
function h2(doc: Doc, text: string) {
  if (doc.y > H - 90) doc.addPage();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(text, M, doc.y, { width: TW });
  doc.y += 4;
}
/** a table with a navy header row; `cols` are fractions of the width */
function table(doc: Doc, head: string[], rows: string[][], cols: number[], opts: { size?: number; align?: ("left" | "right" | "center")[]; boldRows?: number[]; shade?: Record<number, string>; headFill?: string; headColor?: string; width?: number; x?: number } = {}) {
  const size = opts.size ?? 8;
  const width = opts.width ?? TW;
  const x0 = opts.x ?? M;
  const widths = cols.map((c) => c * width);
  const heightOf = (cells: string[], bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    return Math.max(...cells.map((c, i) => doc.heightOfString(clean(c) || " ", { width: widths[i] - 8, lineGap: 1 }))) + 7;
  };
  const drawRow = (cells: string[], y: number, h: number, fill: string | null, bold: boolean, color = INK) => {
    let x = x0;
    cells.forEach((c, i) => {
      if (fill) doc.rect(x, y, widths[i], h).fill(fill);
      doc.rect(x, y, widths[i], h).lineWidth(0.4).stroke(LINE);
      doc.fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).text(clean(c), x + 4, y + 3.5, { width: widths[i] - 8, align: opts.align?.[i] ?? "left", lineGap: 1 });
      x += widths[i];
    });
  };
  // text() moves doc.y to the end of the last cell written: each row is placed at its own top and the
  // next starts exactly at its bottom, whatever the last cell wrapped to
  const hh = heightOf(head, true);
  if (doc.y + hh + 30 > doc.page.height - 50) doc.addPage();
  let y = doc.y;
  drawRow(head, y, hh, opts.headFill ?? NAVY, true, opts.headColor ?? "#FFFFFF");
  y += hh;
  rows.forEach((r, i) => {
    const bold = opts.boldRows?.includes(i) ?? false;
    const h = heightOf(r, bold);
    if (y + h > doc.page.height - 50) {
      doc.addPage();
      y = doc.y;
      drawRow(head, y, hh, opts.headFill ?? NAVY, true, opts.headColor ?? "#FFFFFF");
      y += hh;
    }
    drawRow(r, y, h, opts.shade?.[i] ?? null, bold);
    y += h;
  });
  doc.y = y + 10;
}
/** label / value rows with a shaded label column, as the approved packs set them */
function kv(doc: Doc, rows: [string, string][], labelW = 0.2) {
  const lw = TW * labelW;
  for (const [k, v] of rows) {
    doc.font("Helvetica").fontSize(8.5);
    const h = Math.max(doc.heightOfString(clean(v) || " ", { width: TW - lw - 8, lineGap: 1 }), 10) + 7;
    if (doc.y + h > H - 50) doc.addPage();
    const y = doc.y;
    doc.rect(M, y, lw, h).fill(BEIGE);
    doc.rect(M, y, lw, h).lineWidth(0.4).stroke(LINE);
    doc.rect(M + lw, y, TW - lw, h).lineWidth(0.4).stroke(LINE);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text(k, M + 4, y + 3.5, { width: lw - 8 });
    doc.font("Helvetica").text(clean(v), M + lw + 4, y + 3.5, { width: TW - lw - 8, lineGap: 1 });
    doc.y = y + h;
  }
  doc.y += 10;
}

/* ------------------------------------------------------------------ */
/* the sentences, when none were drafted                               */

function fallback(v: PackValues): Required<Narrative> {
  const contractor = String(v.contractor ?? "the Contractor");
  const title = String(v.title ?? "the works");
  const voNo = voNoOf(v);
  const pvoNo = pvoNoOf(v);
  const basis = String(v.contractual_basis ?? "").trim();
  const clauses = clausesOf(basis);
  const clauseText = clauses.length ? clauses.map((c) => `Sub-Clause ${c.clause} [${c.title}]`).join(" and ") : "Sub-Clause 3.4 [Employer's Instructions] and Sub-Clause 12.1 [Employer's Right to Vary]";
  const total = num(v.total_value) || num(v.add) - num(v.omit);
  const credit = total < 0;
  const amount = `SAR ${formatMoney(Math.abs(total))}`;
  const contractRef = String(v.contract_no ?? v.contract_ref ?? "").trim();
  const project = String(v.project_name ?? "").trim();
  const instructionRef = String(v.rfc_ref ?? v.instruction_ref ?? "").trim();
  const raised = basisKind(instructionRef);
  const scopeLines = lines(v.scope);
  const scopeFirst = scopeLines[0] ?? title;
  // the scope as written: a plain sentence runs on, a list keeps its lines
  const scopeParas = (() => {
    const out: string[] = [];
    let run = "";
    for (const l of scopeLines) {
      if (/^[•\-–]/.test(l)) {
        if (run) out.push(run);
        run = "";
        out.push(l.replace(/^[-–]\s*/, "• "));
      } else if (/:$/.test(l)) {
        if (run) out.push(run);
        run = "";
        out.push(l);
      } else run = run ? `${run} ${l}` : l;
    }
    if (run) out.push(run);
    return out;
  })();
  return {
    letter_paragraphs: [
      `We write with reference to the ${v.contract_title ? `${v.contract_title} ` : ""}Contract${contractRef ? ` (Ref No. ${contractRef})` : ""}${v.commencement_date ? ` dated ${longDate(v.commencement_date)}` : ""}${project ? `, for the ${project} at AMAALA` : ""}${instructionRef ? `, and to ${raised.label} Ref. ${instructionRef}${v.date ? ` dated ${longDate(v.date)}` : ""}` : ""}.`,
      `This Variation Order is given pursuant to ${clauseText} of the Contract. ${credit ? `The amount of ${amount}, as detailed in Appendix 01 to the Variation Order VO-${voNo} attached, shall be recovered from the Contractor by a reduction of the Contract Price.` : `The Contractor is instructed to carry out the works described in Appendix 01 to the Variation Order VO-${voNo} attached, for the sum of ${amount}, which shall be added to the Contract Price.`}`,
      "Capitalized terms in this Variation Order and Employer's Instruction shall have the meanings given to them in the Contract unless otherwise indicated.",
      `Should the Contractor have any comments on Appendix 01, it shall submit its detailed particulars, with supporting documents, within 3 days from the date of this instruction in accordance with Contract Sub-Clause 12.1.`,
      "The Employer confirms that the adjustment to the Contract Price and Schedule 11 (Payment Schedule) arising from this Variation Order and Employer's Instruction shall be agreed or determined strictly in accordance with the Contract.",
      `The Contractor is hereby requested to sign, stamp, and return the Variation Order VO-${voNo}, acknowledging the ${credit ? "recovery" : "instruction"} set out therein.`,
      "The Employer otherwise reserves all rights under the Contract and at Law.",
    ],
    vo_bullets: [
      `This Variation Order is given pursuant to ${clauseText} of the Contract${instructionRef ? `, further to ${raised.label} Ref. ${instructionRef}` : ""}. The Contractor is hereby notified that:`,
      `• ${scopeFirst}`,
      ...scopeLines.slice(1, 5).map((l) => (/^[•\-–\d]/.test(l) ? l.replace(/^[-–]\s*/, "• ") : `• ${l}`)),
      `• The ${credit ? "amount to be recovered" : "value of the works"} is ${amount}, as detailed in Appendix 01. ${credit ? "The recovery is effected through a reduction of the Contract Price." : "The Contract Price is adjusted accordingly."}`,
      `• The Contractor shall review Appendix 01 and confirm its acknowledgement, or submit any comments with supporting particulars, within 3 days from the date of this Variation Order.`,
      `• This Variation Order has ${num(v.time_impact) ? `a time impact of ${Math.round(num(v.time_impact))} days` : "no impact"} on the Time for Completion.`,
    ],
    executive_summary: [
      `The Employer has ${raised.verb} for ${title}, under the ${v.contract_title ? `${v.contract_title} ` : ""}Contract${contractRef ? ` No. ${contractRef}` : ""} with ${contractor}.`,
      ...scopeParas,
      ...lines(v.reason).slice(0, 14),
      `This PVO ${pvoNo} ${credit ? `recovers ${amount} from the Contractor` : `proposes a Variation of ${amount}`}${num(v.time_impact) ? ` with a time impact of ${Math.round(num(v.time_impact))} days` : " with no impact on the Time for Completion"}, to be issued as Variation Order VO-${voNo} upon approval.`,
    ],
    basis_rows: (clauses.length ? clauses : [{ clause: "3.4", title: "Employer's Instructions" }, { clause: "12.1", title: "Employer's Right to Vary" }]).map((c) => ({
      clause: c.clause,
      title: c.title,
      application: /instruction/i.test(c.title)
        ? `${raised.kind === "rfc" ? "The Employer's instruction" : `${raised.label} ${instructionRef}`} directs the Contractor to ${credit ? "acknowledge the recovery of" : "carry out"} ${scopeFirst.replace(/\.$/, "")}.`
        : /vary|variation/i.test(c.title)
          ? `The change is implemented as a Variation adjusting the Contract Price by ${amount}${credit ? " (omission)" : " (addition)"}. Variation Order VO-${voNo} (Annexure 1) is to be issued by the Employer's Representative upon approval of this PVO.`
          : /set-?off|withholding/i.test(c.title)
            ? `Invoked: the amount recoverable under this PVO may be set off against amounts due or becoming due to the Contractor.`
            : /backcharg/i.test(c.title)
              ? `Invoked: costs incurred by the Employer on the Contractor's behalf are backcharged to the Contractor.`
              : /determination/i.test(c.title)
                ? `Following issue of the VO, the adjustment to the Contract Price will be agreed or determined by the Employer (DVO).`
                : `Relied on as the basis of this Variation: ${basis || "see the PVO form, Section 2 a)."}`,
    })),
    assessment_basis: credit
      ? `The value of this PVO is the amount paid by the Employer on the Contractor's behalf, as evidenced by the attached records; it is not an estimate. The line-by-line build-up is Appendix 01 to the draft VO (Annexure 1).`
      : `The value of this PVO is the Employer's assessment of the Contractor's cost proposal attached in this Annexure${v.rom_basis ? `, on the basis of ${String(v.rom_basis).toLowerCase()}` : ""}. Rates and quantities have been checked against the proposal and the Contract; the line-by-line build-up is Appendix 01 to the draft VO (Annexure 1).`,
    assessment_evidence: `The ${raised.label}${instructionRef ? ` ${instructionRef}` : ""} and the supporting documents are in Annexure 2; the cost proposal${v.cost_subject ? ` (${v.cost_subject})` : ""} and the drawings follow this page.`,
    assessment_exclusions: [
      `The ${credit ? "recovery" : "assessment"} is limited to the items listed in Appendix 01; no mark-up beyond the Contract rates has been allowed.`,
      `Time impact: ${num(v.time_impact) ? `${Math.round(num(v.time_impact))} days, as assessed against the programme` : "Nil – the change does not affect the Time for Completion"}.`,
    ],
    budget_treatment: /^A/i.test(String(v.budget_source ?? ""))
      ? `No additional budget or budget transfer required (Option A). This PVO ${credit ? `is a credit of ${amount}, retained within` : `of ${amount} is accommodated within`} the package budget${v.budget_to_line ? ` – ${v.budget_to_line}` : ""}.${v.budget_line ? ` Budget hold ${v.budget_line} is not affected.` : ""}`
      : /^C/i.test(String(v.budget_source ?? ""))
        ? `Additional budget required (Option C). This PVO of ${amount} requires an allocation of additional budget to the package${v.budget_to_line ? ` – ${v.budget_to_line}` : ""}, to be approved under the relevant sub-DoA.`
        : `Budget transfer required (Option B). This PVO of ${amount} is funded by a transfer from the budget on hold${v.budget_line ? ` – ${v.budget_line}` : ""}${v.budget_available ? ` (current balance SAR ${formatMoney(num(v.budget_available))})` : ""} to the package budget${v.budget_to_line ? ` – ${v.budget_to_line}` : ""}. The approval of this PVO is not an approval of the budget transfer, which requires a separate approval under the relevant sub-DoA.`,
  };
}
/** What the change was raised with, from its reference: an RFC, an Employer's Instruction, an Emergency Variation Order or an RFA. */
export function basisKind(ref: string): { kind: "rfc" | "ei" | "evo" | "rfa"; label: string; verb: string } {
  if (/EMI|-EI-/i.test(ref)) return { kind: "ei", label: "Employer's Instruction", verb: "issued an Instruction" };
  if (/VOR-CM|Emergency VO|EVO/i.test(ref)) return { kind: "evo", label: "Emergency Variation Order", verb: "issued an Emergency Variation Order" };
  if (/-RFA-|^RFA/i.test(ref)) return { kind: "rfa", label: "Request for Approval", verb: "raised a Request for Approval" };
  return { kind: "rfc", label: "Request for Change", verb: "raised a Request for Change" };
}

export function narrativeOf(v: PackValues): Required<Narrative> {
  const base = fallback(v);
  let drafted: Narrative = {};
  try {
    drafted = v.__narrative ? (JSON.parse(String(v.__narrative)) as Narrative) : {};
  } catch {
    drafted = {};
  }
  const pick = <K extends keyof Narrative>(k: K): Required<Narrative>[K] => {
    const d = drafted[k];
    if (Array.isArray(d) ? d.length : typeof d === "string" ? d.trim() : false) return d as Required<Narrative>[K];
    return base[k];
  };
  return { letter_paragraphs: pick("letter_paragraphs"), vo_bullets: pick("vo_bullets"), executive_summary: pick("executive_summary"), basis_rows: pick("basis_rows"), assessment_basis: pick("assessment_basis"), assessment_evidence: pick("assessment_evidence"), assessment_exclusions: pick("assessment_exclusions"), budget_treatment: pick("budget_treatment") };
}

/** The "Description" of the Variation Order page: what the Contractor is instructed to proceed with, as the issued VOs word it. */
export function voDescription(v: PackValues): string {
  if (String(v.description ?? "").trim()) return clean(v.description);
  const clauses = String(v.clauses ?? "").trim() || "Contract Clause 12 [Variations and Adjustments]";
  const sc = lines(v.scope);
  const first = (sc[0] ?? String(v.title ?? "")).replace(/[.:]$/, "");
  const bullets = sc.slice(1).map((l) => (/^[•\-–]/.test(l) ? l.replace(/^[-–]\s*/, "• ") : `• ${l}`));
  return [
    `This Variation Order is given Pursuant to ${clauses}. The Contractor is instructed to proceed with ${first.charAt(0).toLowerCase() + first.slice(1)}${bullets.length ? ", including:" : "."}`,
    ...bullets,
    "",
    "The Contractor must ensure compliance with insurance provisions under Clause 17 [Insurance] of the Contract. Maintaining the highest standards of delivery in compliance with the Contract, Law, and best industry practices, is the Contractor's responsibility, including but not limited to coordination with other contractors, obtaining permits, permission, consents, other such Authority-mandated approvals, and payments toward securing any and all permits and clearances to undertake works directed by this VO.",
  ].join("\n");
}

/** The Employer's letter that issues an Emergency Variation Order, as the issued letters word it. */
export function evoLetter(v: PackValues): string[] {
  const no = voNoOf(v);
  const clauses = String(v.clauses ?? "").trim() || "Contract Clause 12 [Variations and Adjustments]";
  const particulars = /12\.3|Sub-Clause 12\.1|12\.1/.test(clauses) ? "Contract Sub-Clause 12.3 [Variation Proposal]" : "Contract Clause 12";
  const days = /12\.3|12\.1/.test(clauses) ? 5 : 7;
  const contractRef = String(v.contract_no ?? v.contract_ref ?? "").trim();
  return [
    `We write with reference to the signed Construction Contract${contractRef ? ` (Ref No. ${contractRef})` : ""}${v.commencement_date ? ` dated ${longDate(v.commencement_date)}` : ""}, for the ${v.project_name || "Project"} at the AMAALA Project, Kingdom of Saudi Arabia.`,
    `This Variation Order is given pursuant to ${clauses} of the Contract. The Contractor is instructed to proceed with the scope of work outlined in the Variation Order VO-${no} attached.`,
    "Capitalized terms in this Variation Order and Employer's Instruction shall have the meanings given to them in the Contract unless otherwise indicated.",
    `The Contractor shall proceed in accordance with ${particulars} to submit detailed particulars to the Employer within ${days} days from the date of this instruction.`,
    "The Employer confirms that any adjustments to the Contract Price, the Time for Completion, and Schedule 11 (Payment Schedule) arising from this Variation Order and Employer's Instruction shall be agreed or determined strictly in accordance with the Contract.",
    `The Contractor is hereby requested to sign, stamp, and return the Variation Order VO-${no}, acknowledging that the Contractor is proceeding with the Variation works.`,
    "The Employer otherwise reserves all rights under the Contract and at Law.",
  ];
}

/* ------------------------------------------------------------------ */
/* Annexure 1 – the Employer's letter, the VO form and Appendix 01     */

export async function renderEmployerLetter(v: PackValues, opts: { evo?: boolean } = {}): Promise<Buffer> {
  const n = narrativeOf(v);
  const paragraphs = opts.evo && !v.__narrative ? evoLetter(v) : n.letter_paragraphs;
  const { doc, done } = newDoc("Employer's letter");
  const voNo = voNoOf(v);
  const letterRef = `${String(v.contract_no ?? v.contract_ref ?? "").replace(/[-.]/g, "").slice(0, 12) || "1TB0XXXX-XXXXXX"}-AMA-LTR-00XX`.replace(/^(\w{8})(\w{6})/, "$1-$2");
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("AMAALA", M, 48, { lineBreak: false });
  doc.y = 110;
  const row = (k: string, val: string, bold = false) => {
    doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(k, M, doc.y, { width: 80, lineBreak: false });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(clean(val), M + 80, doc.y, { width: TW - 80, lineGap: 1.5 });
    doc.y += 10;
  };
  doc.font("Helvetica").fontSize(9.5).text("Letter Ref.: ", M, doc.y, { continued: true }).font("Helvetica-Bold").text(letterRef);
  doc.y += 16;
  doc.font("Helvetica").text("From:", M, doc.y, { width: 80, lineBreak: false });
  doc.font("Helvetica-Bold").text("AMAALA Company", M + 80, doc.y, { continued: true }).font("Helvetica").text(' ("Employer")');
  doc.text("Building No. 8491, An Nu'aylah 6726, Zip Code: 48511, Alwajh, Kingdom of Saudi Arabia.", M + 80, doc.y, { width: TW - 80 });
  doc.y += 12;
  doc.font("Helvetica").text("To:", M, doc.y, { width: 80, lineBreak: false });
  doc.font("Helvetica-Bold").text(clean(v.contractor || "the Contractor"), M + 80, doc.y, { continued: true }).font("Helvetica").text(' ("Contractor")');
  if (v.contractor_address) doc.text(clean(v.contractor_address), M + 80, doc.y, { width: TW - 80 });
  doc.y += 12;
  doc.font("Helvetica").text("Subject:", M, doc.y, { width: 80, lineBreak: false });
  doc.font("Helvetica-Bold").text(`Variation Order VO (No. ${voNo}) – `, M + 80, doc.y, { continued: true, width: TW - 80 }).font("Helvetica").text(clean(v.title));
  doc.y += 12;
  row("Date:", v.date ? longDate(v.date) : "XX Month 2026");
  doc.y += 10;
  const body = paragraphs.join(" ");
  const size = body.length > 2200 ? 8.5 : body.length > 1700 ? 9 : 9.5;
  for (const p of paragraphs) para(doc, p, { align: "justify", gap: size < 9.5 ? 6 : 8, size });
  doc.y += 2;
  para(doc, "Signed:", { bold: true, gap: 26 });
  doc.moveTo(M, doc.y).lineTo(M + 160, doc.y).lineWidth(0.6).stroke(INK);
  doc.y += 8;
  para(doc, String(v.employer_rep || "Employer's Representative"), { bold: true, gap: 2 });
  para(doc, String(v.employer_rep_position || "Employer's Representative"), { gap: 2 });
  doc.font("Helvetica-BoldOblique").fontSize(8.5).text("Enclosed: ", M, doc.y, { continued: true }).font("Helvetica-Oblique").text(opts.evo ? `Variation Order (VO) No. ${voNo}` : `Variation Order (VO) No. ${voNo} and Appendix 01`);
  doc.page.margins.bottom = 0;
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text("AMAALA Company | C.R: 1010590650\nBuilding No. 8491, An Nu'aylah 6726, Zip Code: 48511, Alwajh, Kingdom of Saudi Arabia.", M, H - 54, { width: TW, align: "center", lineBreak: false });
  finish(doc, "", "CLASSIFICATION: INTERNAL & SENSITIVE");
  return done;
}

export async function renderVoForm(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  const { doc, done } = newDoc("Variation Order");
  const voNo = voNoOf(v);
  const GREY = "#7F7F7F";
  const LIGHT = "#E7E6E6";
  const x = M - 8;
  const w = TW + 16;
  // the header grid: form name, document ref, policy, revision
  const cell = (cx: number, cy: number, cw: number, ch: number, t: string, o: { bold?: boolean; fill?: string; color?: string; size?: number; align?: "left" | "center" } = {}) => {
    if (o.fill) doc.rect(cx, cy, cw, ch).fill(o.fill);
    doc.rect(cx, cy, cw, ch).lineWidth(0.5).stroke(GREY);
    doc.fillColor(o.color ?? INK).font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 8).text(clean(t), cx + 4, cy + (ch - (o.size ?? 8)) / 2 - 1, { width: cw - 8, align: o.align ?? "left", lineBreak: false });
  };
  let y = 44;
  cell(x, y, w * 0.4, 16, "Variation Order Form", { bold: true, fill: LIGHT, size: 9 });
  cell(x + w * 0.4, y, w * 0.3, 16, "Document Ref.", { bold: true, fill: LIGHT, size: 9 });
  cell(x + w * 0.7, y, w * 0.3, 16, "AMA-CM-FRM-0013", { bold: true, fill: LIGHT, size: 9, color: "#C00000" });
  y += 16;
  cell(x, y, w * 0.1, 14, "Policy", { bold: true, fill: LIGHT });
  cell(x + w * 0.1, y, w * 0.3, 14, "Commercial", { bold: true, fill: LIGHT });
  cell(x + w * 0.4, y, w * 0.3, 14, "Rev.", { bold: true, fill: LIGHT });
  cell(x + w * 0.7, y, w * 0.3, 14, "0", { fill: LIGHT });
  y += 20;
  doc.rect(x, y, w, 30).fill(GREY);
  doc.rect(x, y, 56, 30).fill("#FFFFFF");
  doc.rect(x, y, 56, 30).lineWidth(0.5).stroke(GREY);
  doc.fillColor(GREY).font("Helvetica").fontSize(5).text("AMAALA", x + 4, y + 20, { width: 48, align: "center", lineBreak: false });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13).text("Variation Order (VO)", x + 56, y + 9, { width: w - 56, align: "center", lineBreak: false });
  y += 36;
  doc.fillColor(INK).font("Helvetica").fontSize(7.5).text("This Variation Order is issued in accordance with the Terms and Conditions of the Contract. Terms defined in the Contract have the same meaning as in this Variation Order unless otherwise defined.", x, y, { width: w });
  y += 24;
  const band = (t: string) => {
    doc.rect(x, y, w, 12).fill(GREY);
    doc.fillColor("#FFFFFF").font("Helvetica").fontSize(7.5).text(t, x + 4, y + 2.5, { lineBreak: false });
    y += 12;
  };
  const grid = (rows: [string, string, string, string][]) => {
    for (const [k1, v1, k2, v2] of rows) {
      doc.font("Helvetica").fontSize(7.5);
      const h = Math.max(13, doc.heightOfString(clean(v1) || " ", { width: w * 0.35 - 8 }) + 5, doc.heightOfString(clean(v2) || " ", { width: w * 0.25 - 8 }) + 5);
      cell(x, y, w * 0.2, h, k1, { size: 7.5 });
      doc.rect(x + w * 0.2, y, w * 0.35, h).lineWidth(0.5).stroke(GREY);
      doc.fillColor(INK).font("Helvetica").fontSize(7.5).text(clean(v1), x + w * 0.2 + 4, y + 3, { width: w * 0.35 - 8 });
      cell(x + w * 0.55, y, w * 0.2, h, k2, { size: 7.5 });
      doc.rect(x + w * 0.75, y, w * 0.25, h).lineWidth(0.5).stroke(GREY);
      doc.fillColor(INK).font("Helvetica").fontSize(7.5).text(clean(v2), x + w * 0.75 + 4, y + 3, { width: w * 0.25 - 8 });
      y += h;
    }
  };
  band("General Information");
  grid([
    ["Variation Order No.", voNo, "Date", dmy(v.date)],
    ["Project Name", `${v.program_name ? `${String(v.program_name).replace(/^Program \d+ - /, "")} - ` : ""}${v.project_name ?? ""}`, "Project Code", String(v.project_code ?? "")],
    ["Contract Name", String(v.project_name ?? v.contract_title ?? ""), "Contract No.", String(v.contract_no ?? v.contract_ref ?? "")],
    ["Works Package", String(v.works_package ?? v.contract_title ?? ""), "Contractor", String(v.contractor ?? "")],
  ]);
  y += 4;
  band("Instruction Reference");
  // the description beside the VO number
  doc.font("Helvetica").fontSize(7.5);
  const text = n.vo_bullets.join("\n");
  const th = doc.heightOfString(clean(text), { width: w * 0.8 - 10, lineGap: 1.5 }) + 10;
  doc.rect(x, y, w * 0.2, th).lineWidth(0.5).stroke(GREY);
  doc.rect(x + w * 0.2, y, w * 0.8, th).lineWidth(0.5).stroke(GREY);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(8).text(`VO ${voNo}`, x + 4, y + th / 2 - 4, { width: w * 0.2 - 8, lineBreak: false });
  doc.font("Helvetica").fontSize(7.5).text(clean(text), x + w * 0.2 + 5, y + 5, { width: w * 0.8 - 10, lineGap: 1.5 });
  y += th;
  band("Information Provided with this Variation Order");
  const info: [string, string, string, string][] = [["Appendix 01", `Schedule to Variation Order No. ${voNo} – ${v.title ?? ""}`, "0", dmy(v.date)]];
  if (v.rfc_ref) info.push([String(v.rfc_ref), `${basisKind(String(v.rfc_ref)).label} – ${v.title ?? ""}`, "0", dmy(v.date)]);
  for (const d of lines(v.information_provided)) {
    const p = d.split(/\s+[–-]\s+/);
    if (p.length >= 2) info.push([p[0], p.slice(1, -1).join(" – ") || p[1], "0", p.length > 2 ? p[p.length - 1] : dmy(v.date)]);
  }
  const hcols = [0.2, 0.58, 0.1, 0.12];
  const hrow = (cells: string[], fill: string | null, bold = false, color = INK) => {
    let cx = x;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(6.5);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(clean(c) || " ", { width: hcols[i] * w - 6 }))) + 6;
    cells.forEach((c, i) => {
      if (fill) doc.rect(cx, y, hcols[i] * w, h).fill(fill);
      doc.rect(cx, y, hcols[i] * w, h).lineWidth(0.5).stroke(GREY);
      doc.fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(6.5).text(clean(c), cx + 3, y + 3, { width: hcols[i] * w - 6, align: i >= 2 ? "center" : "left" });
      cx += hcols[i] * w;
    });
    y += h;
  };
  hrow(["Document Ref. No.", "Document Title", "Rev. No.", "Rev. Date"], LIGHT, true);
  for (const r of info) hrow(r, null, true);
  y += 2;
  const sign = (heading: string, name: string, position: string) => {
    doc.rect(x, y, w, 12).fill(GREY);
    doc.fillColor("#FFFFFF").font("Helvetica").fontSize(7.5).text(heading, x + 4, y + 2.5, { lineBreak: false });
    y += 12;
    doc.rect(x, y, w, 96).lineWidth(0.5).stroke(GREY);
    const cols = [0.22, 0.34, 0.26, 0.18];
    let cx = x + 8;
    const labels = ["Name", "Position", "Signature", "Date"];
    cols.forEach((c, i) => {
      const cw = c * w - 16;
      doc.moveTo(cx, y + 72).lineTo(cx + cw, y + 72).lineWidth(0.5).stroke(LINE);
      doc.fillColor(MUTED).font("Helvetica").fontSize(6).text(labels[i], cx, y + 75, { width: cw, align: "center", lineBreak: false });
      if (i === 0 && name) doc.fillColor(INK).font("Helvetica").fontSize(8).text(clean(name), cx, y + 60, { width: cw, align: "center", lineBreak: false });
      if (i === 1 && position) doc.fillColor(INK).font("Helvetica").fontSize(8).text(clean(position), cx, y + 52, { width: cw, align: "center" });
      cx += c * w;
    });
    y += 100;
  };
  sign("Approved and Issued by (Employer's Representative)", String(v.employer_rep ?? ""), String(v.employer_rep_position ?? "Employer's Representative"));
  sign("Received by (Contractor's Representative)", String(v.contractor_rep ?? ""), String(v.contractor_rep_position ?? "Contractor's Representative"));
  doc.page.margins.bottom = 0;
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text("Page 1 of 1", M, H - 40, { width: TW, align: "right", lineBreak: false });
  doc.end();
  return done;
}

/** The Variation Order issued under the Emergency Protocol (RSG-CM-FRM-0034), drawn in the form's own layout. */
export async function renderVoFormEmergency(v: PackValues, projectCode = ""): Promise<Buffer> {
  const { doc, done } = newDoc("Variation Order");
  const GOLD = "#B5985C";
  const SAND = "#F3EEE2";
  const LINEC = "#D9D2C2";
  const x = M;
  const w = TW;
  const no = String(v.pvo_no ?? v.vo_no ?? "").replace(/\D/g, "").padStart(3, "0");
  doc.fillColor(GOLD).font("Times-Roman").fontSize(16).text("Variation Order Form", x, 60, { lineBreak: false });
  doc.fillColor(GOLD).font("Times-Roman").fontSize(7.5).text("RSG-CM-FRM-0034", x, 84, { lineBreak: false });
  doc.moveTo(x, 94).lineTo(x + w, 94).lineWidth(0.6).stroke(GOLD);
  doc.fillColor(INK).font("Helvetica").fontSize(7.2).text("This Variation Order is issued under the Emergency Protocol and in accordance with the Terms and Conditions of the Contract. Terms defined in the Contract have the same meaning as in this Variation Order unless otherwise defined.", x, 106, { width: w, lineGap: 1 });
  let y = doc.y + 10;
  const band = (t: string) => {
    doc.rect(x, y, w, 13).fill(GOLD);
    doc.fillColor("#FFFFFF").font("Helvetica").fontSize(8).text(t, x + 4, y + 3, { lineBreak: false });
    y += 13;
  };
  const kvRow = (a: string, b: string, c: string, d: string) => {
    const h = 13;
    doc.rect(x, y, w, h).lineWidth(0.4).stroke(LINEC);
    doc.rect(x, y, w * 0.2, h).fill(SAND);
    doc.rect(x + w * 0.62, y, w * 0.17, h).fill(SAND);
    doc.fillColor(INK).font("Helvetica").fontSize(7.5);
    doc.text(a, x + 3, y + 3.5, { width: w * 0.2 - 6, lineBreak: false });
    doc.text(clean(b), x + w * 0.2 + 3, y + 3.5, { width: w * 0.42 - 6, lineBreak: false });
    doc.text(c, x + w * 0.62 + 3, y + 3.5, { width: w * 0.17 - 6, lineBreak: false });
    doc.text(clean(d), x + w * 0.79 + 3, y + 3.5, { width: w * 0.21 - 6, lineBreak: false });
    y += h;
  };
  band("General Information");
  kvRow("Variation Order No.", no.replace(/^0+(\d)/, "$1"), "Date", v.date ? dmy(v.date) : "");
  kvRow("Project Name", [v.program_name, v.development_name].filter(Boolean).join(" - ") || String(v.project_name ?? ""), "Project Code", projectCode);
  kvRow("Contract Name", String(v.contract_title || v.project_name || ""), "Contract No.", String(v.contract_no ?? ""));
  kvRow("Works Package", String(v.works_package ?? ""), "Contractor/Consultant", String(v.contractor ?? ""));
  y += 8;
  band("Variation Title:");
  doc.fillColor(INK).font("Helvetica").fontSize(7.2).text(clean(v.title), x + 2, y + 5, { width: w - 4 });
  y = doc.y + 6;
  // instruction reference and description
  doc.rect(x, y, w, 13).fill(GOLD);
  doc.fillColor("#FFFFFF").font("Helvetica").fontSize(8).text("Instruction Reference", x + 4, y + 3, { lineBreak: false });
  doc.text("Description", x + w * 0.2 + 4, y + 3, { lineBreak: false });
  y += 13;
  const descText = voDescription(v);
  doc.font("Helvetica").fontSize(7.2);
  const descH = Math.max(120, doc.heightOfString(descText, { width: w * 0.8 - 10, lineGap: 1.5 }) + 16);
  doc.rect(x, y, w, descH).lineWidth(0.4).stroke(LINEC);
  doc.moveTo(x + w * 0.2, y).lineTo(x + w * 0.2, y + descH).stroke(LINEC);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text(`VO-${no}`, x + 4, y + descH / 2 - 4, { lineBreak: false });
  doc.font("Helvetica").fontSize(7.2).text(descText, x + w * 0.2 + 5, y + 8, { width: w * 0.8 - 10, lineGap: 1.5 });
  y += descH + 10;
  band("Time Impact (Contract Level)");
  doc.rect(x, y, w, 16).lineWidth(0.4).stroke(LINEC);
  doc.moveTo(x + w * 0.5, y).lineTo(x + w * 0.5, y + 16).stroke(LINEC);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.2).text("Estimated 'time impact' of this variation (Days)", x + 3, y + 5, { lineBreak: false });
  const impact = Math.round(num(v.time_impact));
  doc.font("Helvetica").fontSize(9).text(impact ? String(impact) : "TBA", x + w * 0.5 + 30, y + 4, { lineBreak: false });
  y += 26;
  band("Information Provided with this Variation Order");
  const cols = [0.2, 0.6, 0.1, 0.1];
  const hcells = ["Document Ref. No.", "Document Title", "Rev. No.", "Rev. Date"];
  const docsOf = lines(v.information_provided).map((l) => l.split(/\s+[–-]\s+/));
  const tableRows = docsOf.length ? docsOf : [["Appendix 01", v.title ? `Schedule to Variation Order No. ${no} – ${v.title}` : "", "0", v.date ? dmy(v.date) : ""]];
  while (tableRows.length < 5) tableRows.push(["", "", "", ""]);
  [hcells, ...tableRows].forEach((r, ri) => {
    const h = 12;
    if (ri === 0) doc.rect(x, y, w, h).fill(SAND);
    doc.rect(x, y, w, h).lineWidth(0.4).stroke(LINEC);
    let cx = x;
    r.forEach((c, i) => {
      doc.fillColor(INK).font("Helvetica").fontSize(6.8).text(clean(c ?? ""), cx + 3, y + 3, { width: cols[i] * w - 6, align: i >= 2 ? "center" : "left", lineBreak: false });
      cx += cols[i] * w;
    });
    y += h;
  });
  y += 10;
  const sign = (heading: string, who: string, name: string, position: string) => {
    doc.rect(x, y, w, 13).fill(GOLD);
    doc.fillColor("#FFFFFF").font("Helvetica").fontSize(8).text(heading + " ", x + 4, y + 3, { continued: true, lineBreak: false }).font("Helvetica-Oblique").text(who, { lineBreak: false });
    y += 13;
    const labels = ["Name", "Position", "Signature", "Date"];
    const cw = [0.26, 0.37, 0.22, 0.15];
    let cx = x + 10;
    cw.forEach((c, i) => {
      const width = c * w - 20;
      doc.moveTo(cx, y + 46).lineTo(cx + width, y + 46).lineWidth(0.5).stroke(LINEC);
      doc.fillColor(MUTED).font("Helvetica").fontSize(6).text(labels[i], cx, y + 49, { width, align: "center", lineBreak: false });
      if (i === 0 && name) doc.fillColor(INK).font("Helvetica").fontSize(7.5).text(clean(name), cx, y + 35, { width, align: "center", lineBreak: false });
      if (i === 1 && position) doc.fillColor(INK).font("Helvetica").fontSize(7.5).text(clean(position), cx, y + 35, { width, align: "center", lineBreak: false });
      cx += c * w;
    });
    y += 66;
  };
  sign("Approved and Issued by", "(Employer's Representative)", String(v.employer_rep ?? ""), String(v.employer_rep_position || "Employer's Representative"));
  sign("Received by", "(Consultant/Contractor's Representative)", String(v.contractor_rep ?? ""), String(v.contractor_rep_position || "Contractor's Representative"));
  doc.page.margins.bottom = 0;
  doc.fillColor(GOLD).font("Times-Roman").fontSize(7).text("Variation Order Form (RSG-CM-FRM-0010)", 18, H - 46, { lineBreak: false });
  doc.text("Revision 05, Rev. Date 02-Feb-2023", 18, H - 36, { lineBreak: false });
  doc.text("Page 1 of 1", W - 80, H - 36, { width: 62, align: "right", lineBreak: false });
  doc.end();
  return done;
}

export async function renderAppendix01(v: PackValues): Promise<Buffer> {
  const { doc, done } = newDoc("Appendix 01");
  const voNo = voNoOf(v);
  const its = items(v);
  const total = num(v.total_value) || its.reduce((a, b) => a + b.add - b.omit, 0);
  doc.rect(M, 48, TW, 22).fill(NAVY);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(11).text(`APPENDIX 01 TO VARIATION ORDER No. ${voNo}`, M, 54, { width: TW, align: "center" });
  doc.rect(M, 70, TW, 16).fill(PALE);
  doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(clean(v.title), M, 74, { width: TW, align: "center" });
  doc.fillColor(MUTED).fontSize(7).text(`${v.contract_no ? `Contract No. ${v.contract_no}` : ""}${v.works_package ? ` – ${v.works_package}` : ""}${v.project_name ? ` – ${v.project_name}` : ""}`, M, 90, { width: TW, align: "center" });
  doc.y = 110;
  const rows = (its.length ? its : [{ ref: "1", desc: String(v.title ?? ""), omit: total < 0 ? -total : 0, add: total > 0 ? total : 0 }]).map((it, i) => [it.ref || String(i + 1), it.desc, it.omit ? sar(-it.omit) : "-", it.add ? sar(it.add) : "-", sar(it.add - it.omit)]);
  table(doc, ["No.", "Description", "Omit (SAR)", "Add (SAR)", "Net (SAR)"], [...rows, ["", total < 0 ? "TOTAL RECOVERABLE FROM THE CONTRACTOR (SAR)" : "TOTAL VALUE OF THIS VARIATION ORDER (SAR)", "", "", sar(total)]], [0.07, 0.51, 0.14, 0.14, 0.14], { size: 8, align: ["center", "left", "right", "right", "right"], boldRows: [rows.length], shade: { [rows.length]: PALE } });
  h2(doc, "Notes:");
  const notes = [
    `1. Source: ${v.cost_subject ? `the cost proposal "${v.cost_subject}"` : "the cost proposal"} attached in Annexure 4 of PVO ${pvoNoOf(v)}${v.rfc_ref ? `, further to ${v.rfc_ref}` : ""}.`,
    `2. Amounts are in Saudi Riyals${total < 0 ? ", recovered from the Contractor by a reduction of the Contract Price" : ", excluding VAT"}.`,
    `3. The build-up and the supporting records are available to the Contractor on request.`,
  ];
  for (const t of notes) para(doc, t, { size: 8, gap: 3 });
  finish(doc, `Appendix 01 to Variation Order No. ${voNo}`, "CLASSIFICATION: INTERNAL & SENSITIVE");
  return done;
}

/* ------------------------------------------------------------------ */
/* Annexure 2 – the executive summary that opens the change assessment pack */

export async function renderExecutiveSummary(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  const { doc, done } = newDoc("Executive summary");
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(`Executive Summary – ${basisKind(String(v.rfc_ref ?? "")).label}`, M, 80, { width: TW, align: "center" });
  doc.y = 120;
  for (const p of n.executive_summary) para(doc, p, { size: 10.5, align: /^[•]/.test(p) || /:$/.test(p) ? "left" : "justify", gap: /^[•]/.test(p) ? 3 : 12, indent: /^[•]/.test(p) ? 14 : 0 });
  doc.end();
  return done;
}

/* ------------------------------------------------------------------ */
/* Annexure 3 – contractual basis                                      */

export async function renderContractualBasis(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  const { doc, done } = newDoc("Contractual basis");
  title(doc, "CONTRACTUAL BASIS FOR VARIATION ENTITLEMENT", `PVO ${pvoNoOf(v)} – ${v.title ?? ""}`);
  const price = num(v.original_contract) || num(v.contract_price);
  kv(doc, [
    ["Contract", `${v.contract_title ? `${v.contract_title} ` : ""}${v.contract_no ? `Contract Ref. No. ${v.contract_no}` : ""}${v.works_package ? ` – ${v.works_package}` : ""}${v.project_name ? ` for the ${v.project_name}` : ""}`],
    ["Parties", `AMAALA Company (the Employer) and ${v.contractor ?? "the Contractor"} (the Contractor)`],
    ["Contract Date", v.commencement_date ? longDate(v.commencement_date) : "As per the Contract"],
    ["Contract Price", price ? `SAR ${formatMoney(price)} (excluding VAT)` : "As per the Contract"],
  ], 0.22);
  table(doc, ["Sub-Clause", "Title", "Application to this PVO"], n.basis_rows.map((r) => [r.clause, r.title, r.application]), [0.14, 0.26, 0.6], { size: 8.5, align: ["center", "left", "left"] });
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(7.5).text("Note: The signed Contract pages (cover page and the Sub-Clauses listed above) are to be appended to this Annexure, with the relevant Sub-Clauses highlighted.", M, doc.y, { width: TW });
  finish(doc, "");
  return done;
}

/* ------------------------------------------------------------------ */
/* Annexure 4 – the Employer's assessment                               */

export async function renderAssessment(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  const { doc, done } = newDoc("Employer's assessment");
  const pvoNo = pvoNoOf(v);
  const voNo = voNoOf(v);
  title(doc, "PARTICULARS OF 'ESTIMATED COST & TIME IMPACT'", `Employer's Assessment – PVO ${pvoNo} / draft VO ${voNo}`, `${v.contract_no ? `Contract ${v.contract_no}` : ""}${v.contractor ? ` – ${v.contractor}` : ""}${v.works_package ? ` – ${v.works_package}` : ""}`);
  h2(doc, "1. Basis of assessment");
  para(doc, n.assessment_basis, { size: 8.5, align: "justify" });
  h2(doc, "2. Reconciliation of the value");
  const its = items(v);
  const total = num(v.total_value) || its.reduce((a, b) => a + b.add - b.omit, 0);
  const rom = num(v.rom_estimate);
  const rows: string[][] = (its.length ? its : [{ ref: "1", desc: String(v.title ?? ""), omit: total < 0 ? -total : 0, add: total > 0 ? total : 0 }]).map((it) => [it.desc, sar(it.add - it.omit), total < 0 ? "Recovered under this PVO" : "Included in this PVO"]);
  if (rom && Math.abs(rom - Math.abs(total)) > 0.5) rows.push([`Contractor's proposal / ROM as submitted`, sar(rom), `Assessed to ${sar(Math.abs(total))}${rom > Math.abs(total) ? ` – reduction of ${sar(rom - Math.abs(total))}` : ""}`]);
  rows.push([total < 0 ? "Recoverable under this PVO (SAR)" : "Value of this PVO (SAR)", sar(total), "PVO form, Section 2 b)"]);
  table(doc, ["Item", "Amount (SAR)", "Treatment in this PVO"], rows, [0.5, 0.18, 0.32], { size: 8, align: ["left", "right", "left"], boldRows: [rows.length - 1], shade: { [rows.length - 1]: PALE } });
  h2(doc, "3. Evidence");
  para(doc, n.assessment_evidence, { size: 8.5, align: "justify" });
  h2(doc, "4. Exclusions and time impact");
  for (const b of n.assessment_exclusions) para(doc, `• ${b}`, { size: 8.5, gap: 3 });
  finish(doc, `Annexure 4 – Employer's assessment (PVO ${pvoNo})`);
  return done;
}

/* ------------------------------------------------------------------ */
/* Annexure 5 – budget particulars                                     */

export async function renderBudgetParticularsNova(v: PackValues): Promise<Buffer> {
  const n = narrativeOf(v);
  const { doc, done } = newDoc("Budget particulars");
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text("BUDGET PARTICULARS", M, 70, { width: TW, align: "center" });
  doc.y = 110;
  doc.font("Helvetica-Bold").fontSize(10).text("SUBJECT", M, doc.y, { continued: true, underline: true }).font("Helvetica").text(`: ${clean(v.title)}`, { underline: false });
  doc.y += 14;
  doc.font("Helvetica-Bold").fontSize(10).text("BUDGET TREATMENT:", M, doc.y, { underline: true });
  doc.y += 2;
  para(doc, n.budget_treatment, { size: 10, align: "justify", gap: 14 });
  const total = num(v.total_value) || num(v.add) - num(v.omit);
  const budget = num(v.approved_contract) || num(v.original_contract);
  const current = num(v.acc_budget) || budget;
  const dvos = num(v.approved_dvos);
  const before = current - budget - dvos;
  const after = before - total;
  doc.font("Helvetica-Bold").fontSize(10).text(`PACKAGE BUDGET POSITION (SAR)${v.budget_to_line ? ` – ${v.budget_to_line}` : ""}:`, M, doc.y, { underline: true });
  doc.y += 6;
  table(doc, ["Description", "Amount (SAR)"], [
    [`Current approved budget in ACC${v.budget_to_line ? ` – ${v.budget_to_line}` : ""}`, sar(current)],
    ["Less: Approved contract (Original Contract Value)", sar(-budget)],
    ["Less: Approved DVOs to date", sar(-dvos)],
    ["Remaining budget before this PVO", sar(before)],
    [`${total < 0 ? "Add" : "Less"}: This PVO${total < 0 ? " – credit" : ""} (${clean(v.title).slice(0, 60)})`, sar(-total)],
    ["Remaining budget after this PVO", sar(after)],
  ], [0.72, 0.28], { size: 9, align: ["left", "right"], boldRows: [3, 5], shade: { 3: PALE, 5: PALE }, headFill: PALE, headColor: INK });
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(7.5).text(`Source: the package budget position on the PVO form, Section 3 b)${v.budget_line ? `; budget hold ${v.budget_line}${v.budget_available ? ` balance SAR ${formatMoney(num(v.budget_available))}` : ""}` : ""}. The ACC cost worksheet extract for the package is to be appended to this Annexure.`, M, doc.y, { width: TW });
  finish(doc, "");
  return done;
}

/* ------------------------------------------------------------------ */
/* Contract summary – the change log as a contract position             */

/**
 * The contract summary page of the PVO and DVO packs: every change on the contract with where it stands and its
 * Aconex approval, the agreed VOs (DVO approved), the un-agreed ones (PVO or VO approved, DVO still to come) and
 * this change, adding up to the potential revised contract value. Read from the change register, in a size that
 * reads on paper (9 pt).
 */
export async function renderContractSummary(v: PackValues, rows: ChangeLogRow[], kind: "PVO" | "DVO"): Promise<Buffer> {
  const { doc, done } = newDoc("Contract summary", true);
  const PTW = H - M * 2;
  const sar0 = (n: number | null) => (n === null || Math.abs(n) < 0.005 ? "" : sar(n));
  const original = num(v.original_contract) || num(v.contract_price);
  const thisValue = num(v.total_value) || num(v.dvo_value) || num(v.add) - num(v.omit);
  const no = kind === "PVO" ? pvoNoOf(v) : (String(v.dvo_no ?? "").replace(/\D/g, "") || pvoNoOf(v));
  const contractor = clean(v.contractor);
  const line1 = `Contract Summary – ${contractor || "Contract"}`;
  const line2 = [clean(v.project_name), clean(v.works_package || v.contract_title), v.contract_no ? `Contract Code ${clean(v.contract_no)}` : ""].filter(Boolean).join(" – ");
  doc.rect(M, 40, PTW, 22).fill(NAVY);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(11).text(line1, M + 8, 46, { width: PTW - 16, lineBreak: false });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`${line2}${line2 ? " – " : ""}change log – SAR excl. VAT`, M, 68, { width: PTW });
  doc.y = 90;
  const live = rows.filter((r) => !r.thisOne && !/^(cancelled|rejected|superseded)$/i.test(r.status ?? ""));
  let agreed = 0;
  let unagreed = 0;
  const body: string[][] = [["Contract", "Contract Price", "", "", sar(original), "", "", ""]];
  for (const r of live) {
    const isAgreed = r.status === "DVO approved";
    const value = isAgreed ? (r.dvoValue ?? r.pvoValue) : (r.pvoValue ?? r.dvoValue);
    if (isAgreed) agreed += value ?? 0;
    else unagreed += value ?? 0;
    body.push([r.pvo || r.itemNo || "", r.description, r.status ?? "", r.approvalRef ?? "", "", isAgreed ? sar0(value) : "", isAgreed ? "" : sar0(value), ""]);
  }
  body.push([`${kind} ${no}`, clean(v.title), `This ${kind} – for approval`, "", "", "", "", sar(thisValue)]);
  body.push(["", "Totals", "", "", sar(original), sar(agreed), sar(unagreed), sar(thisValue)]);
  body.push(["", `Potential Revised Contract Value (after this ${kind})`, "", "", sar(original + agreed + unagreed + thisValue), "", "", ""]);
  const shade: Record<number, string> = { [body.length - 1]: PALE, [body.length - 2]: PALE, [body.length - 3]: BEIGE };
  table(doc, ["Reference", "Description", "Current status", "Approval reference", "Contract value (SAR)", "Agreed VO (SAR)", "Unagreed VO (SAR)", `This ${kind} (SAR)`], body, [0.08, 0.3, 0.1, 0.14, 0.1, 0.095, 0.095, 0.09], { size: 9, align: ["left", "left", "left", "left", "right", "right", "right", "right"], boldRows: [body.length - 1, body.length - 2], shade, width: PTW });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Agreed VO: determined variation orders approved. Unagreed VO: PVOs and VOs approved whose determination is still to come. Approval references are the Aconex workflow approvals held on the change register. ${live.length} earlier change(s) on the contract.`, M, doc.y, { width: PTW });
  finish(doc, `${kind} ${no} – Contract summary`);
  return done;
}

/* Annexure 6 – change log                                             */

export async function renderChangeLogNova(v: PackValues, rows: ChangeLogRow[]): Promise<Buffer> {
  const { doc, done } = newDoc("Change log", true);
  const PW = H;
  const PTW = PW - M * 2;
  const CYAN = "#CCFFFF";
  const YELLOW = "#FFFF00";
  doc.rect(M, 40, PTW, 20).fill(CYAN).rect(M, 40, PTW, 20).lineWidth(0.5).stroke(INK);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text("CHANGE LOG", M, 45, { width: PTW, align: "center" });
  let y = 62;
  const head: [string, string][] = [["Contract No.", String(v.contract_no ?? v.contract_ref ?? "")], ["Contractor's Name", String(v.contractor ?? "")], ["Scope of Works", String(v.works_package ?? v.contract_title ?? "")], ["Contract Completion Date", dmy(v.original_completion)], ["Revised Completion Date", dmy(v.current_completion || v.revised_completion || v.original_completion)]];
  for (const [k, val] of head) {
    doc.rect(M, y, 130, 12).lineWidth(0.4).stroke(INK);
    doc.rect(M + 130, y, 230, 12).lineWidth(0.4).stroke(INK);
    doc.fillColor(INK).font("Helvetica").fontSize(7).text(k, M + 3, y + 3, { lineBreak: false });
    doc.text(clean(val), M + 133, y + 3, { width: 224, lineBreak: false });
    y += 12;
  }
  doc.y = y + 10;
  const original = num(v.original_contract) || num(v.contract_price);
  const thisValue = num(v.total_value) || num(v.add) - num(v.omit);
  // a cancelled, rejected or superseded change stays in the log with no value
  const dead = (r: ChangeLogRow) => /^(cancelled|rejected|superseded)$/i.test(r.status ?? "");
  const body = rows.filter((r) => !r.thisOne).map((r, i) => [String(i + 1), r.description, r.rfc || "-", r.pvo || "-", r.vo || "-", r.dvo || "-", "", dead(r) ? "Cancelled" : r.dvoValue === null && r.pvoValue !== null ? sar(r.pvoValue) : r.dvoValue === null ? "Cancelled" : "", dead(r) || r.dvoValue === null ? "" : sar(r.dvoValue), ""]);
  const totalPvo = rows.filter((r) => !r.thisOne && !dead(r) && r.dvoValue === null).reduce((t, r) => t + (r.pvoValue ?? 0), 0);
  const totalDvo = rows.filter((r) => !r.thisOne && !dead(r)).reduce((t, r) => t + (r.dvoValue ?? 0), 0);
  const all = [["", "Original Contract", "", "", "", "", sar(original), "", "", ""], ...body, ["", `This PVO (PVO-${pvoNoOf(v)} – ${clean(v.title)})`, "", "", "", "", "", "", "", sar(thisValue)], ["", "Total", "", "", "", "", sar(original), sar(totalPvo), sar(totalDvo), sar(thisValue)]];
  table(doc, ["Sr", "Description", "RFC", "PVO", "VO", "DVO", "Contract Value", "PVO", "DVO", "This PVO"], all, [0.04, 0.3, 0.07, 0.07, 0.07, 0.07, 0.1, 0.1, 0.09, 0.09], { size: 7, align: ["center", "left", "center", "center", "center", "center", "right", "right", "right", "right"], boldRows: [0, all.length - 2, all.length - 1], shade: { [all.length - 2]: YELLOW, [all.length - 1]: CYAN }, headFill: CYAN, headColor: INK, width: PTW });
  finish(doc, "Classification: Internal", "Classification: Internal");
  return done;
}
