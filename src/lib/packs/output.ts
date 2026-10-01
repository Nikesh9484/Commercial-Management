import { getDb } from "../db";
import { nowIso } from "../format";
import type { UserInfo } from "../registers/types";
import { buildDocx, buildEarDocx, fillTemplate } from "./word";
import { fillExcelTemplate, isExcelTemplate } from "./excel";
import { buildCompiledPack, noticePdf, renderFormPdf, safeFileName, type FormMeta, type PackPart, type PartItem } from "./pdf";
import { appendix01Xlsx, assessmentDocx, basisDocx, budgetXlsx, changeLogXlsx, formXlsx, letterDocx, mimeOf, packDocuments, summaryDocx, voFormDocx, type DocFormat } from "./documents";
import { renderBudgetParticulars, renderEarReport, renderRfaForm } from "./forms";
import { renderAppendix01, renderAssessment, renderBudgetParticularsNova, renderChangeLogNova, renderContractualBasis, renderEmployerLetter, renderExecutiveSummary, renderVoForm, renderVoFormEmergency } from "./annexures";
import { withNarrative } from "./narrative";
import { changeLogRows, type ChangeLogRow } from "./data";
import { overlayDvo, overlayPvo, overlayRfa, overlayVoForm } from "./overlay";
import { packParts, pageSpec, positioned } from "./extract";
import { caseValues, getTemplate, listDocs, readDocBytes, readTemplateBytes, type PackCase } from "./store";
import { ValidationError } from "../registers/engine";
import { defaultPackFileName, packType, REFERENCE_SLOT, slotsFor, type PackDoc, type PackType, type PackValues } from "./shared";

/** The outputs of a pack: the Word document, the Excel form (when the template is a workbook), the PDF document and the compiled PDF pack. */
export type OutputFormat = "docx" | "xlsx" | "pdf" | "pack";

export function outputMeta(c: PackCase, user: UserInfo): FormMeta {
  const p = getDb().prepare("SELECT code, name FROM programmes WHERE id = ?").get(c.programme_id) as { code: string; name: string } | undefined;
  return { programme: { code: p?.code ?? "", name: p?.name ?? "" }, ref: c.ref, title: c.title, revision: c.revision, status: c.status, preparedBy: user.name, generatedAt: nowIso() };
}

export function outputFileBase(c: PackCase): string {
  const t = packType(c.pack_type)!;
  return c.file_name.trim() || defaultPackFileName(t, caseValues(c), c.ref, c.title);
}

/** The change log behind the pack: the earlier approved pack's log with this change as its last line; the register's log when there is none. */
function logRows(c: PackCase): ChangeLogRow[] {
  const values = caseValues(c);
  try {
    const rows = JSON.parse(values.change_log_rows || "[]") as ChangeLogRow[];
    if (rows.length) {
      const no = String(values.pvo_no ?? "").replace(/\D/g, "");
      const total = Number(String(values.total_value ?? values.dvo_value ?? "").replace(/[^0-9.\-]/g, "")) || null;
      const isDvo = c.pack_type === "dvo";
      const own = rows.map((r) => ({ ...r, thisOne: false }));
      // a DVO settles a PVO already in the log: that line becomes this one
      const idx = isDvo ? own.findIndex((r) => no && r.pvo.replace(/\D/g, "").replace(/^0+/, "") === no.replace(/^0+/, "")) : -1;
      if (idx >= 0) own[idx] = { ...own[idx], dvo: String(values.dvo_no ?? own[idx].dvo), dvoValue: total ?? own[idx].dvoValue, thisOne: true };
      else own.push({ description: c.title, rfc: String(values.rfc_ref ?? "").replace(/^Emergency VO.*$/i, ""), pvo: no ? `PVO-${no}` : "", vo: no ? `VO-${no}` : "", dvo: isDvo ? String(values.dvo_no ?? "") : "", pvoValue: isDvo ? Number(String(values.pvo_value ?? "").replace(/[^0-9.\-]/g, "")) || total : total, dvoValue: isDvo ? total : null, thisOne: true });
      return own;
    }
  } catch {
    /* the register's log below */
  }
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

/**
 * The approved documents whose pages can carry this pack: the one uploaded on the case first, then the
 * PDF set as the category's template. The first that holds the form pages is used.
 */
function referenceCandidates(c: PackCase, t: PackType): Buffer[] {
  return referenceCandidatesNamed(c, t).map((x) => x.bytes);
}
/** the candidates with the file each came from, for the message when none serves */
function referenceCandidatesNamed(c: PackCase, t: PackType): { name: string; bytes: Buffer }[] {
  const out: { name: string; bytes: Buffer }[] = [];
  const named = (name: string, b: Buffer | null) => {
    if (b) out.push({ name, bytes: b });
  };
  const docs = listDocs(c.id).filter((d) => /\.pdf$/i.test(d.name));
  const inSlot = docs.find((d) => d.slot === REFERENCE_SLOT) ?? (t.key === "dvo" ? undefined : docs.find((d) => d.slot === "pvo"));
  const d = inSlot ?? docs.find((d) => (t.key === "pvo" && /pvo/i.test(d.name) && !/dvo/i.test(d.name)) || (t.key === "dvo" && /dvo/i.test(d.name)) || (t.key === "rfa" && /rfa/i.test(d.name)));
  // every PDF in the template entry, the one picked first
  for (const x of [d, ...docs.filter((o) => o.slot === REFERENCE_SLOT && o !== d)]) if (x) named(x.name, readDocBytes(x));
  const tpl = getTemplate(t.key);
  if (tpl && /\.pdf$/i.test(tpl.name)) named(`category template ${tpl.name}`, readTemplateBytes(tpl));
  // then the approved packs uploaded on any other pack of the category – this project's first, the newest first
  const formKind = t.key === "pvo" || t.key === "vo" ? "pvo_form" : t.key === "dvo" ? "dvo_form" : "";
  if (formKind) {
    const rows = getDb()
      .prepare("SELECT d.* FROM pack_docs d JOIN pack_cases c ON c.id = d.case_id WHERE c.pack_type = ? AND d.case_id <> ? AND d.name LIKE '%.pdf' AND d.page_kinds LIKE ? ORDER BY (c.programme_id = ?) DESC, d.id DESC LIMIT 4")
      .all(c.pack_type, c.id, `%"${formKind}"%`, c.programme_id) as PackDoc[];
    for (const r of rows) named(`${r.name} (on another pack)`, readDocBytes(r));
  }
  return out;
}
function referenceBytes(c: PackCase, t: PackType): Buffer | null {
  return referenceCandidates(c, t)[0] ?? null;
}

/** The category of the cost line behind the pack (the ACC table row this PVO sits on). */
function lineCategory(c: PackCase): string {
  if (!c.source_id || c.source_table !== "changes") return "";
  try {
    const db = getDb();
    const r = db.prepare("SELECT l.category FROM changes ch JOIN cost_lines l ON l.id = ch.cost_line_id WHERE ch.id = ?").get(c.source_id) as { category: string | null } | undefined;
    return r?.category ?? "";
  } catch {
    return "";
  }
}

/**
 * The document itself. When the last approved document of the kind was uploaded as the template,
 * its own form pages are used and this pack's values written onto them; otherwise the form is drawn
 * by the dashboard in the RSG layout.
 */
export async function renderDocumentPdf(c: PackCase, t: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  if (t.key === "vo") values = await withNarrative(c, values);
  const tried: string[] = [];
  const candidates = ["pvo", "vo", "dvo", "rfa"].includes(t.key) ? referenceCandidatesNamed(c, t) : [];
  for (const ref of candidates) {
    try {
      const out =
        t.key === "pvo" || t.key === "vo"
          ? await overlayPvo(ref.bytes, values, { targetCategory: lineCategory(c) })
          : t.key === "dvo"
            ? await overlayDvo(ref.bytes, values)
            : await overlayRfa(
                ref.bytes,
                values,
                listDocs(c.id)
                  .filter((d) => d.slot !== REFERENCE_SLOT)
                  .map((d) => d.name.replace(/\.[a-z0-9]+$/i, "")),
              );
      if (out) return out;
      tried.push(`${ref.name}: no ${t.short} form pages found in it`);
    } catch (e) {
      console.error("pack overlay failed, trying the next template:", e);
      tried.push(`${ref.name}: ${e instanceof Error ? e.message.slice(0, 160) : "could not be used"}`);
    }
  }
  // the form pages of a PVO, EVO or DVO are always the approved pack's own: the dashboard draws none of its own
  if (t.key === "pvo" || t.key === "vo" || t.key === "dvo") {
    const why = tried.length ? ` Tried: ${tried.join("; ")}.` : " No PDF is in the template entry, set as the category's template, or uploaded on another pack of this category.";
    throw new ValidationError(`No approved ${t.short} pack to take the form pages from.${why} Upload the last approved ${t.short} pack (PDF, with its form pages) into the template entry of this pack, or set it as the ${t.short} category's template.`);
  }
  switch (t.key) {
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

/**
 * The cost proposal and the drawings of Annexure 4: the files uploaded for them, or – when nothing
 * was uploaded – the pages that carry them inside the RFC / RFA (for a DVO, the approved PVO pack).
 * A separate upload always supersedes what the change pack holds.
 */
async function costAndDrawings(docs: PackDoc[], carrierSlots: string[], carrierLabel: string): Promise<PartItem[]> {
  const cost = itemsOf(docs, "cost");
  const drawings = itemsOf(docs, "drawings");
  if (cost.length && drawings.length) return [...cost, ...drawings];
  const out: PartItem[] = [...cost];
  const carriers = docs.filter((d) => carrierSlots.includes(d.slot) && /\.pdf$/i.test(d.name));
  let fromCost: PartItem[] = [];
  let fromDrawings: PartItem[] = [];
  for (const d of carriers) {
    const bytes = readDocBytes(d);
    if (!bytes) continue;
    const parts = packParts(await positioned(bytes));
    if (parts.cost.length) fromCost.push({ name: `Cost proposal – pages ${pageSpec(parts.cost)} of ${d.name}`, bytes, pages: pageSpec(parts.cost), mime: d.mime, note: `taken from the ${carrierLabel}` });
    if (parts.drawings.length) fromDrawings.push({ name: `Drawings – pages ${pageSpec(parts.drawings)} of ${d.name}`, bytes, pages: pageSpec(parts.drawings), mime: d.mime, note: `taken from the ${carrierLabel}` });
  }
  if (!cost.length) out.push(...fromCost);
  else fromCost = [];
  if (drawings.length) {
    out.push(...drawings);
    fromDrawings = [];
  } else out.push(...fromDrawings);
  return out;
}
const gen = (name: string, bytes: Buffer): PartItem => ({ name, bytes, mime: "application/pdf" });

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 600);

/**
 * A page in the document's place when it could not be produced – the pack goes on, the page says
 * what to redo. Nothing in a pack stops the rest of it.
 */
async function orNotice(name: string, make: () => Promise<Buffer>): Promise<{ bytes: Buffer; problem: string | null }> {
  try {
    return { bytes: await make(), problem: null };
  } catch (e) {
    console.error(`${name} could not be produced:`, e);
    const why = reason(e);
    return { bytes: await noticePdf(`${name} – to be redone`, [`This page could not be produced: ${why}`, "Check the uploaded files and the values of the pack, then create the pack again."]), problem: why };
  }
}
const sg = async (name: string, make: () => Promise<Buffer>): Promise<PartItem> => gen(name, (await orNotice(name, make)).bytes);
const quiet = async <T,>(what: string, make: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await make();
  } catch (e) {
    console.error(`${what} could not be read:`, e);
    return fallback;
  }
};

/** The red line under the Annexure 2 divider: the approved instruction or request behind the change. */
function instructionNote(values: PackValues): string {
  const ref = String(values.instruction_ref || values.rfc_ref || "").trim();
  const ei = String(values.ei_no ?? "").replace(/\D/g, "");
  if (/VOR-CM|^Emergency VO/i.test(ref)) return `APPROVED Emergency Variation Order${ref.match(/\d{3,4}$/) ? ` No ${ref.match(/\d{3,4}$/)![0].replace(/^0+(\d\d)/, "$1")}` : ""} Ref: ${ref}`;
  if (/EMI|-EI-/i.test(ref) || ei) return `APPROVED Employer's Instruction (EI)${ei ? ` No ${ei.padStart(3, "0")}` : ""}${ref ? ` Ref: ${ref}` : ""}`;
  if (/RFA/i.test(ref)) return `APPROVED Request for Approval (RFA) Ref: ${ref}`;
  return ref ? `APPROVED Request for Change (RFC) Ref: ${ref}` : "";
}

interface Assembly {
  front: { name: string; bytes: Buffer }[];
  parts: PackPart[];
  index: { title: string } | null;
}

/** The pack of one category: what opens it and its annexures or parts, in the order the approved packs follow. */
async function assemble(c: PackCase, t: PackType, values: PackValues, meta: FormMeta, docs: PackDoc[], form: Buffer): Promise<Assembly> {
  const others: PackPart[] = slotsFor(t, Number(c.extra_slots ?? 0))
    .filter((s) => s.key.startsWith("other_"))
    .map((s) => ({ no: 0, label: s.label, hint: s.hint, style: "part" as const, items: itemsOf(docs, s.key) }))
    .filter((p) => p.items.length);
  const number = (parts: PackPart[], from: number) => parts.map((p, i) => ({ ...p, no: from + i }));
  if (t.key === "pvo") {
    const v = await quiet("narrative", () => withNarrative(c, values), values);
    const ann: PackPart[] = [
      {
        no: 1,
        label: "DRAFT VARIATION ORDER (VO) - To be signed by the ER upon approval of the PVO",
        hint: "The Employer's letter, the Variation Order form and its Appendix 01, drafted from this PVO",
        style: "annexure",
        items: [await sg("Employer's letter – Variation Order", () => renderEmployerLetter(v)), await sg("Variation Order (AMA-CM-FRM-0013)", () => renderVoForm(v)), await sg("Appendix 01 – particulars of the Variation", () => renderAppendix01(v))],
      },
      {
        no: 2,
        label: "CHANGE ASSESSMENT PACK",
        hint: "The executive summary, the approved instruction or request, and the revise-and-resubmit updates",
        style: "annexure",
        note: instructionNote(v),
        items: [await sg("Executive summary", () => renderExecutiveSummary(v)), ...itemsOf(docs, "rfc"), ...itemsOf(docs, "resubmit")],
      },
      { no: 3, label: "CONTRACTUAL BASIS FOR VARIATION ENTITLEMENT", hint: "The clauses relied on and how each applies", style: "annexure", items: [await sg("Contractual basis", () => renderContractualBasis(v))] },
      { no: 4, label: "PARTICULARS OF 'ESTIMATED COST & TIME IMPACT'", hint: "The Employer's assessment, the cost proposal and the drawings – uploaded, or the pages inside the RFC / RFA", style: "annexure", items: [await sg("Employer's assessment of cost and time", () => renderAssessment(v)), ...(await quiet("cost proposal and drawings", () => costAndDrawings(docs, ["rfc"], "RFC / RFA"), []))] },
      { no: 5, label: "BUDGET PARTICULARS / ACC COST WORKSHEET", hint: "Where the budget comes from and where it goes", style: "annexure", items: [await sg("Budget particulars", () => renderBudgetParticularsNova(v))] },
      { no: 6, label: "CHANGE LOG", hint: "Every change on the contract with its RFC, PVO, VO and DVO", style: "annexure", items: [await sg("Change log", () => renderChangeLogNova(v, logRows(c)))] },
    ];
    return { front: [{ name: "PVO form (RSG-CM-FRM-0013)", bytes: form }], parts: [...ann, ...number(others, 7)], index: { title: "PROPOSED VARIATION ORDER (PVO)" } };
  }
  if (t.key === "dvo") {
    const ann: PackPart[] = [
      { no: 1, label: "APPROVED PVO & VO – COVER PAGE + WF APPROVALS ONLY", hint: "The approved PVO with its workflow approvals, and the revise-and-resubmit updates", style: "annexure", items: [...itemsOf(docs, "pvo"), ...itemsOf(docs, "resubmit")] },
      { no: 2, label: "COST IMPACT – EMPLOYER'S ASSESSMENT AND DETERMINATION", hint: "The cost proposal and the drawings behind the determined value – uploaded, or the pages inside the approved PVO pack", style: "annexure", items: await quiet("cost proposal and drawings", () => costAndDrawings(docs, ["pvo"], "approved PVO pack"), []) },
      { no: 3, label: "BUDGET PARTICULARS", hint: "Where the budget comes from and where it goes", style: "annexure", items: [await sg("Budget particulars", () => renderBudgetParticulars(t, values, meta))] },
      { no: 4, label: "CHANGE LOG", hint: "Every change on the contract with its RFC, PVO, VO and DVO", style: "annexure", items: [await sg("Change log", () => renderChangeLogNova(values, logRows(c)))] },
    ];
    return { front: [{ name: "PVO to DVO movement summary, DVO form (RSG-CM-FRM-0014) and review & recommendation (RSG-CM-FRM-0027)", bytes: form }], parts: [...ann, ...number(others, 5)], index: { title: "DETERMINED VARIATION ORDER (DVO)" } };
  }
  if (t.key === "vo") {
    values = await quiet("narrative", () => withNarrative(c, values), values);
    // the issued EVO packs are one run: the assessment form, the ROM and what supports it, the Employer's letter, the Variation Order, the drawings
    let voPage: Buffer | null = null;
    for (const ref of referenceCandidates(c, t)) {
      try {
        voPage = await overlayVoForm(ref, values, { projectCode: meta.programme.code });
      } catch (e) {
        console.error("VO page overlay failed, trying the next template:", e);
      }
      if (voPage) break;
    }
    const parts: PackPart[] = [
      { no: 1, label: "ROM / cost proposal and supporting documents", hint: "", style: "part", plain: true, items: [...itemsOf(docs, "cost"), ...itemsOf(docs, "supporting")] },
      { no: 2, label: "Employer's letter", hint: "", style: "part", plain: true, items: [await sg("Employer's letter – Variation Order", () => renderEmployerLetter(values, { evo: true }))] },
      { no: 3, label: "Variation Order", hint: "", style: "part", plain: true, items: [voPage ? gen("Variation Order (RSG-CM-FRM-0034)", voPage) : await sg("Variation Order (RSG-CM-FRM-0034)", () => renderVoFormEmergency(values, meta.programme.code))] },
      { no: 4, label: "Drawings", hint: "", style: "part", plain: true, items: itemsOf(docs, "drawings") },
    ];
    return { front: [{ name: "Emergency Variation Order Assessment form", bytes: form }], parts: [...parts, ...number(others, 5).map((p) => ({ ...p, plain: true }))], index: null };
  }
  if (t.key === "rfa") {
    const parts: PackPart[] = [
      { no: 1, label: "Details of the RFA", hint: "The brief, the options and the background papers", style: "part", items: itemsOf(docs, "details") },
      { no: 2, label: "Cost details", hint: "The estimate, the funding agreement or the budget position", style: "part", items: itemsOf(docs, "cost") },
    ];
    return { front: [{ name: "RFA form (RSG-PR-FRM-0004)", bytes: form }], parts: [...parts, ...number(others, 3)], index: null };
  }
  if (t.key === "eot_ear" || t.key === "cost_ear") {
    const parts: PackPart[] = [
      { no: 1, label: "Contractor's claim submission", hint: "The claim narrative and its appendices", style: "part", items: itemsOf(docs, "submission") },
      { no: 2, label: "Previous assessments and awards", hint: "Earlier assessments or awards on this contract", style: "part", items: itemsOf(docs, "previous") },
      { no: 3, label: "Reference from another asset or package", hint: "A reference from another contract, for consistency", style: "part", items: itemsOf(docs, "other_asset") },
    ];
    return { front: [{ name: "Cover letter and Employer's Assessment Report", bytes: form }], parts: [...parts, ...number(others, 4)], index: null };
  }
  // RFC, VO, Stage 2: the form, then every slot as a numbered part
  const parts: PackPart[] = slotsFor(t, Number(c.extra_slots ?? 0))
    .filter((s) => s.key !== REFERENCE_SLOT)
    .map((s) => ({ no: s.no, label: s.label, hint: s.hint, style: "part" as const, items: itemsOf(docs, s.key) }));
  return { front: [{ name: `${t.short} form`, bytes: form }], parts, index: null };
}

export async function renderOutput(c: PackCase, format: OutputFormat, user: UserInfo): Promise<{ bytes: Buffer; fileName: string; mime: string; note: string }> {
  const t = packType(c.pack_type)!;
  const values = caseValues(c);
  const meta = outputMeta(c, user);
  const base = outputFileBase(c);
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const tpl = getTemplate(c.pack_type);
  const tplExcel = !!tpl && isExcelTemplate(tpl.name);
  if (format === "xlsx") {
    // the workbook written into: the earlier document's workbook uploaded on this pack first, else the category's Excel template
    const own = listDocs(c.id).filter((d) => isExcelTemplate(d.name)).sort((a, b) => (a.slot === REFERENCE_SLOT ? -1 : 0) - (b.slot === REFERENCE_SLOT ? -1 : 0));
    const ownBytes = own.length ? readDocBytes(own[0]) : null;
    const name = ownBytes ? own[0].name : tpl?.name ?? "";
    const bytes = ownBytes ?? (tpl && tplExcel ? readTemplateBytes(tpl) : null);
    if (!bytes) return { bytes: await formXlsx(t, values), fileName: safeFileName(base, "xlsx"), mime: mimeOf("xlsx"), note: "the form's values as a workbook (no RSG workbook uploaded to write into)" };
    const ext = name.match(/\.(xlsx|xlsm|xltx|xltm)$/i)?.[1].toLowerCase() ?? "xlsx";
    const mime = ext === "xlsm" || ext === "xltm" ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return { bytes: await fillExcelTemplate(bytes, t, values), fileName: safeFileName(base, ext === "xltx" ? "xlsx" : ext === "xltm" ? "xlsm" : ext), mime, note: `written into the RSG workbook ${name}` };
  }
  if (format === "docx") {
    const bytes = tpl && /\.(docx|dotx|docm)$/i.test(tpl.name) ? readTemplateBytes(tpl) : null;
    if (tpl && bytes) return { bytes: await fillTemplate(bytes, t, values), fileName: safeFileName(base, "docx"), mime: DOCX, note: `written into the RSG template ${tpl.name}` };
    if (t.key === "eot_ear" || t.key === "cost_ear") return { bytes: await buildEarDocx(t, values, meta), fileName: safeFileName(base, "docx"), mime: DOCX, note: "Employer's Assessment Report with its cover letter" };
    return { bytes: await buildDocx(t, values, meta), fileName: safeFileName(base, "docx"), mime: DOCX, note: "built-in layout (no template uploaded for this category)" };
  }
  // the form pages never stop the pack: when they cannot be produced, a page in their place says why
  const { bytes: form, problem } = await orNotice(`${t.short} form pages`, () => renderDocumentPdf(c, t, values, meta));
  const formNote = problem ? `the ${t.short} form pages could not be produced (${problem.slice(0, 200)}) – a page in their place says what to redo` : referenceBytes(c, t) ? "written onto the uploaded template's form pages" : "document drawn by the dashboard in the RSG layout";
  if (format === "pdf") return { bytes: form, fileName: safeFileName(base, "pdf"), mime: "application/pdf", note: formNote };
  const docs = listDocs(c.id).filter((d) => d.slot !== REFERENCE_SLOT);
  const { front, parts, index } = await assemble(c, t, values, meta, docs, form);
  const bytes = await buildCompiledPack({ type: t, values, meta, fileName: base, front, parts, index, references: referenceCandidates(c, t) });
  return { bytes, fileName: safeFileName(`${base} - Pack`, "pdf"), mime: "application/pdf", note: `${docs.length} supporting documents in ${parts.filter((p) => p.items.length).length} parts${problem ? `; ${formNote}` : ""}` };
}

/**
 * One document of the pack on its own, in the file type asked for: the letters and narrative pages
 * as PDF or Word, the schedules and figures as PDF or Excel, the form itself as PDF, Excel or Word.
 */
export async function renderPackDocument(c: PackCase, docId: string, format: DocFormat, user: UserInfo): Promise<{ bytes: Buffer; fileName: string; mime: string; note: string }> {
  const t = packType(c.pack_type)!;
  const doc = packDocuments(t).find((d) => d.id === docId);
  if (!doc) throw new ValidationError("That document is not part of this pack.");
  if (!doc.formats.includes(format)) throw new ValidationError(`${doc.label} does not come as ${format === "docx" ? "Word" : format === "xlsx" ? "Excel" : "PDF"}.`);
  if (doc.id === "form") return renderOutput(c, format, user);
  const values = caseValues(c);
  const meta = outputMeta(c, user);
  const evo = t.key === "vo";
  const v = t.key === "pvo" || evo ? await quiet("narrative", () => withNarrative(c, values), values) : values;
  const fin = (bytes: Buffer) => ({ bytes, fileName: safeFileName(`${outputFileBase(c)} - ${doc.label}`, format), mime: mimeOf(format), note: doc.label });
  if (format === "pdf") {
    switch (doc.id) {
      case "letter":
        return fin(await renderEmployerLetter(v, { evo }));
      case "vo_form": {
        if (evo) {
          for (const ref of referenceCandidates(c, t)) {
            try {
              const page = await overlayVoForm(ref, v, { projectCode: meta.programme.code });
              if (page) return fin(page);
            } catch (e) {
              console.error("VO page overlay failed, trying the next template:", e);
            }
          }
          return fin(await renderVoFormEmergency(v, meta.programme.code));
        }
        return fin(await renderVoForm(v));
      }
      case "appendix01":
        return fin(await renderAppendix01(v));
      case "summary":
        return fin(await renderExecutiveSummary(v));
      case "basis":
        return fin(await renderContractualBasis(v));
      case "assessment":
        return fin(await renderAssessment(v));
      case "budget":
        return fin(t.key === "dvo" ? await renderBudgetParticulars(t, values, meta) : await renderBudgetParticularsNova(v));
      case "change_log":
        return fin(await renderChangeLogNova(v, logRows(c)));
    }
  }
  if (format === "docx") {
    switch (doc.id) {
      case "letter":
        return fin(await letterDocx(v, evo));
      case "vo_form":
        return fin(await voFormDocx(v, evo, meta.programme.code));
      case "summary":
        return fin(await summaryDocx(v));
      case "basis":
        return fin(await basisDocx(v));
      case "assessment":
        return fin(await assessmentDocx(v));
    }
  }
  if (format === "xlsx") {
    switch (doc.id) {
      case "appendix01":
        return fin(await appendix01Xlsx(v));
      case "budget":
        return fin(await budgetXlsx(v, t.short));
      case "change_log":
        return fin(await changeLogXlsx(v, logRows(c)));
    }
  }
  throw new ValidationError(`${doc.label} does not come as ${format}.`);
}
