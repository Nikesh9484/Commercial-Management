import { getDb, getSetting } from "../db";
import { computeCostReport } from "../cost-report/compute";
import { nowIso } from "../format";
import type { UserInfo } from "../registers/types";
import { buildDocx, buildEarDocx, fillTemplate } from "./word";
import { buildCompiledPack, renderFormPdf, safeFileName, type FormMeta, type PackPart, type PartItem } from "./pdf";
import { renderBasisPage, renderBudgetParticulars, renderChangeLog, renderDraftVo, renderDvoForm, renderEarReport, renderIndexPage, renderPvoForm, renderRfaForm, type AccRow } from "./forms";
import { changeLogRows, type ChangeLogRow } from "./data";
import { caseValues, getTemplate, listDocs, readDocBytes, readTemplateBytes, type PackCase } from "./store";
import { defaultPackFileName, packType, REFERENCE_SLOT, slotsFor, type PackDoc, type PackType, type PackValues } from "./shared";

/** The three outputs of a pack: the Word document, the PDF document and the compiled PDF pack. */
export type OutputFormat = "docx" | "pdf" | "pack";

export function outputMeta(c: PackCase, user: UserInfo): FormMeta {
  const p = getDb().prepare("SELECT code, name FROM programmes WHERE id = ?").get(c.programme_id) as { code: string; name: string } | undefined;
  return { programme: { code: p?.code ?? "", name: p?.name ?? "" }, ref: c.ref, title: c.title, revision: c.revision, status: c.status, preparedBy: user.name, generatedAt: nowIso() };
}

export function outputFileBase(c: PackCase): string {
  const t = packType(c.pack_type)!;
  return c.file_name.trim() || defaultPackFileName(t, caseValues(c), c.ref, c.title);
}

/** The ACC budget table of the PVO form: the project's cost report by category, this PVO on its own category. */
function accRows(c: PackCase, values: PackValues): AccRow[] {
  try {
    const db = getDb();
    const periodId = getSetting(db, "current_period_id");
    const report = computeCostReport(c.programme_id, periodId ? Number(periodId) : null);
    const thisValue = Number(values.total_value || 0) || 0;
    const line = c.source_id ? (db.prepare("SELECT cost_line_id FROM changes WHERE id = ?").get(c.source_id) as { cost_line_id: number | null } | undefined) : undefined;
    const lineCat = line?.cost_line_id ? report.lines.find((l) => l.id === line.cost_line_id)?.category ?? "" : "";
    const by = new Map<string, AccRow>();
    for (const l of report.lines) {
      const r = by.get(l.category) ?? { category: l.category || "Other", budget: 0, contract: 0, dvos: 0, commitments: 0, pvos: 0, thisPvo: 0 };
      r.budget += l.G;
      r.dvos += l.H;
      r.commitments += l.I;
      r.contract += l.I - l.H;
      r.pvos += l.J;
      by.set(l.category, r);
    }
    const rows = [...by.values()].map((r) => ({ ...r, budget: r2(r.budget), contract: r2(r.contract), dvos: r2(r.dvos), commitments: r2(r.commitments), pvos: r2(r.pvos) }));
    const target = rows.find((r) => r.category === lineCat) ?? rows.find((r) => /construction/i.test(r.category)) ?? rows[0];
    if (target) target.thisPvo = thisValue;
    return rows;
  } catch {
    return [];
  }
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function logRows(c: PackCase): ChangeLogRow[] {
  if (!c.source_id) return [];
  const db = getDb();
  if (c.source_table === "changes") {
    const ch = db.prepare("SELECT cost_line_id, contractor_id FROM changes WHERE id = ?").get(c.source_id) as { cost_line_id: number | null; contractor_id: number | null } | undefined;
    return ch ? changeLogRows(c.programme_id, ch.cost_line_id, ch.contractor_id, c.source_id) : [];
  }
  if (c.source_table === "contracts") {
    const ct = db.prepare("SELECT cost_line_id, contractor_id FROM contracts WHERE id = ?").get(c.source_id) as { cost_line_id: number | null; contractor_id: number | null } | undefined;
    return ct ? changeLogRows(c.programme_id, ct.cost_line_id, ct.contractor_id, null) : [];
  }
  return [];
}

/** The document itself, laid out as the RSG document of that category. */
export async function renderDocumentPdf(c: PackCase, t: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  switch (t.key) {
    case "pvo":
      return renderPvoForm(t, values, meta, { acc: accRows(c, values), changeLog: logRows(c) });
    case "dvo":
      return renderDvoForm(t, values, meta);
    case "rfa":
      return renderRfaForm(t, values, meta);
    case "eot_ear":
    case "cost_ear":
      return renderEarReport(t, values, meta, { withLetter: true });
    default:
      return renderFormPdf(t, values, meta);
  }
}

const itemsOf = (docs: PackDoc[], slot: string): PartItem[] => docs.filter((d) => d.slot === slot).map((d) => ({ name: d.name, bytes: readDocBytes(d), pages: d.pages, mime: d.mime }));
const gen = (name: string, bytes: Buffer): PartItem => ({ name, bytes, mime: "application/pdf" });

/** The pack of one category: what opens it and its annexures or parts, in the order the approved packs follow. */
async function assemble(c: PackCase, t: PackType, values: PackValues, meta: FormMeta, docs: PackDoc[], form: Buffer): Promise<{ front: { name: string; bytes: Buffer }[]; parts: PackPart[] }> {
  const others: PackPart[] = slotsFor(t, Number(c.extra_slots ?? 0))
    .filter((s) => s.key.startsWith("other_"))
    .map((s) => ({ no: 0, label: s.label, hint: s.hint, style: "part" as const, items: itemsOf(docs, s.key) }))
    .filter((p) => p.items.length);
  const number = (parts: PackPart[], from: number) => parts.map((p, i) => ({ ...p, no: from + i }));
  if (t.key === "pvo") {
    const ann: PackPart[] = [
      { no: 1, label: "Draft Variation Order (VO) – to be signed by the ER upon approval of the PVO", hint: "The Employer's Instruction letter and the Variation Order form, drafted from this PVO", style: "annexure", items: [gen("Draft VO and Employer's Instruction letter", await renderDraftVo(t, values, meta))] },
      { no: 2, label: "Change assessment pack", hint: "The Request for Change and the revise-and-resubmit updates", style: "annexure", items: [...itemsOf(docs, "rfc"), ...itemsOf(docs, "resubmit")] },
      { no: 3, label: "Contractual basis for variation entitlement", hint: "The clause relied on, with the contract pages where attached", style: "annexure", items: [gen("Contractual basis", await renderBasisPage(t, values, meta))] },
      { no: 4, label: "Particulars of 'estimated cost & time impact'", hint: "The cost proposal and the drawings", style: "annexure", items: [...itemsOf(docs, "cost"), ...itemsOf(docs, "drawings")] },
      { no: 5, label: "Budget particulars / ACC cost worksheet", hint: "Where the budget comes from and where it goes", style: "annexure", items: [gen("Budget particulars", await renderBudgetParticulars(t, values, meta))] },
      { no: 6, label: "Change log", hint: "Every change on the contract with its RFC, PVO, VO and DVO", style: "annexure", items: [gen("Change log", await renderChangeLog(t, values, meta, logRows(c)))] },
    ];
    const index = await renderIndexPage(t, meta, ann.map((a) => ({ no: a.no, title: a.label, attached: a.items.length > 0 })), values);
    return { front: [{ name: "PVO form (RSG-CM-FRM-0013)", bytes: form }, { name: "Index of annexures", bytes: index }], parts: [...ann, ...number(others, 7)] };
  }
  if (t.key === "dvo") {
    const ann: PackPart[] = [
      { no: 1, label: "Approved PVO & VO – cover page + WF approvals only", hint: "The approved PVO with its workflow approvals, and the revise-and-resubmit updates", style: "annexure", items: [...itemsOf(docs, "pvo"), ...itemsOf(docs, "resubmit")] },
      { no: 2, label: "Cost impact – Employer's assessment and determination", hint: "The cost proposal and the drawings behind the determined value", style: "annexure", items: [...itemsOf(docs, "cost"), ...itemsOf(docs, "drawings")] },
      { no: 3, label: "Budget particulars", hint: "Where the budget comes from and where it goes", style: "annexure", items: [gen("Budget particulars", await renderBudgetParticulars(t, values, meta))] },
      { no: 4, label: "Change log", hint: "Every change on the contract with its RFC, PVO, VO and DVO", style: "annexure", items: [gen("Change log", await renderChangeLog(t, values, meta, logRows(c)))] },
    ];
    const index = await renderIndexPage(t, meta, ann.map((a) => ({ no: a.no, title: a.label, attached: a.items.length > 0 })), values);
    return { front: [{ name: "PVO to DVO movement summary, DVO form (RSG-CM-FRM-0014) and review & recommendation (RSG-CM-FRM-0027)", bytes: form }, { name: "Index of annexures", bytes: index }], parts: [...ann, ...number(others, 5)] };
  }
  if (t.key === "rfa") {
    const parts: PackPart[] = [
      { no: 1, label: "Details of the RFA", hint: "The brief, the options and the background papers", style: "part", items: itemsOf(docs, "details") },
      { no: 2, label: "Cost details", hint: "The estimate, the funding agreement or the budget position", style: "part", items: itemsOf(docs, "cost") },
    ];
    return { front: [{ name: "RFA form (RSG-PR-FRM-0004)", bytes: form }], parts: [...parts, ...number(others, 3)] };
  }
  if (t.key === "eot_ear" || t.key === "cost_ear") {
    const parts: PackPart[] = [
      { no: 1, label: "Contractor's claim submission", hint: "The claim narrative and its appendices", style: "part", items: itemsOf(docs, "submission") },
      { no: 2, label: "Previous assessments and awards", hint: "Earlier assessments or awards on this contract", style: "part", items: itemsOf(docs, "previous") },
      { no: 3, label: "Reference from another asset or package", hint: "A reference from another contract, for consistency", style: "part", items: itemsOf(docs, "other_asset") },
    ];
    return { front: [{ name: "Cover letter and Employer's Assessment Report", bytes: form }], parts: [...parts, ...number(others, 4)] };
  }
  // RFC, VO, Stage 2: the form, then every slot as a numbered part
  const parts: PackPart[] = slotsFor(t, Number(c.extra_slots ?? 0))
    .filter((s) => s.key !== REFERENCE_SLOT)
    .map((s) => ({ no: s.no, label: s.label, hint: s.hint, style: "part" as const, items: itemsOf(docs, s.key) }));
  return { front: [{ name: `${t.short} form`, bytes: form }], parts };
}

export async function renderOutput(c: PackCase, format: OutputFormat, user: UserInfo): Promise<{ bytes: Buffer; fileName: string; mime: string; note: string }> {
  const t = packType(c.pack_type)!;
  const values = caseValues(c);
  const meta = outputMeta(c, user);
  const base = outputFileBase(c);
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (format === "docx") {
    const tpl = getTemplate(c.pack_type);
    const bytes = tpl ? readTemplateBytes(tpl) : null;
    if (tpl && bytes) return { bytes: await fillTemplate(bytes, t, values), fileName: safeFileName(base, "docx"), mime: DOCX, note: `written into the RSG template ${tpl.name}` };
    if (t.key === "eot_ear" || t.key === "cost_ear") return { bytes: await buildEarDocx(t, values, meta), fileName: safeFileName(base, "docx"), mime: DOCX, note: "Employer's Assessment Report with its cover letter" };
    return { bytes: await buildDocx(t, values, meta), fileName: safeFileName(base, "docx"), mime: DOCX, note: "built-in layout (no template uploaded for this category)" };
  }
  const form = await renderDocumentPdf(c, t, values, meta);
  if (format === "pdf") return { bytes: form, fileName: safeFileName(base, "pdf"), mime: "application/pdf", note: "document drawn by the dashboard in the RSG layout" };
  const docs = listDocs(c.id).filter((d) => d.slot !== REFERENCE_SLOT);
  const { front, parts } = await assemble(c, t, values, meta, docs, form);
  const bytes = await buildCompiledPack({ type: t, values, meta, fileName: base, front, parts });
  return { bytes, fileName: safeFileName(`${base} - Pack`, "pdf"), mime: "application/pdf", note: `${docs.length} supporting documents in ${parts.filter((p) => p.items.length).length} parts` };
}
