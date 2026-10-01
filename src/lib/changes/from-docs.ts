import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { createRecord, lookupOptions, updateRecord } from "../registers/engine";
import type { RecordRow, UserInfo } from "../registers/types";
import { classifyDoc, positioned, readEi, readEvoForChange, readReferenceDvo, readReferencePvo, readRfaForChange, readRfc, type Reading } from "../packs/extract";
import type { PosPage } from "../packs/positioned";
import { convertToPdf, convertible } from "../packs/convert";
import { matchAgainstRegisters } from "../library/read";
import { ensureOpenMonth } from "../periods";
import { getAppContext } from "../context";
import { formatDate, formatMoney, todayIso } from "../format";
import type { Decisions, Duplicate, FromDocsResult, Outcome, ReadValue } from "../from-docs-shared";

/**
 * A change entry made from its own documents. The RFC, the PVO, the EVO, the EI, the RFA or the DVO
 * – one of them or all together – are read, sorted into one change per RFC (or title), and written
 * into the change register as the next CH number of the project named in the documents. A change
 * already in the register (same RFC, PVO or DVO number, or the same title) is brought up to date
 * instead of being added twice. What the documents did not give is listed on the entry, for the
 * row to be edited by hand.
 */

export interface DocFile {
  name: string;
  bytes: Buffer;
}
interface DocRead {
  name: string;
  kind: string;
  values: Record<string, string>;
  text: string;
  programmeCode: string;
  rfcNo: number | null;
  no: number | null;
  /** an Aconex workflow transmittal: the document it approved, the outcome, the date and its own number */
  approval?: { docNo: string; stage: "rfc" | "pvo" | "vo" | "dvo" | "ei"; outcome: "Approved" | "Rejected" | "Pending"; date: string; mailNo: string; subject: string };
  note: string;
}

const KIND_LABEL: Record<string, string> = { rfc: "RFC", ei: "Employer's Instruction", rfa: "RFA", pvo: "PVO", evo: "EVO", dvo: "DVO", wtran: "Aconex approval", cost: "cost proposal", ear: "assessment report", unknown: "not recognised" };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "Sunday, September 13, 2026", "13 September 2026", "13-Sep-26" → ISO */
const isoOf = (s: string): string => {
  const a = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (a && MONTHS.findIndex((m) => m.startsWith(a[1].toLowerCase().slice(0, 3))) >= 0) return `${a[3]}-${String(MONTHS.findIndex((m) => m.startsWith(a[1].toLowerCase().slice(0, 3))) + 1).padStart(2, "0")}-${a[2].padStart(2, "0")}`;
  const b = s.match(/(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2,4})/);
  if (b && MONTHS.findIndex((m) => m.startsWith(b[2].toLowerCase().slice(0, 3))) >= 0) return `${b[3].length === 2 ? `20${b[3]}` : b[3]}-${String(MONTHS.findIndex((m) => m.startsWith(b[2].toLowerCase().slice(0, 3))) + 1).padStart(2, "0")}-${b[1].padStart(2, "0")}`;
  return s.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
};
/** which stage of a change an Aconex document number belongs to */
const stageOfDoc = (docNo: string): "rfc" | "pvo" | "vo" | "dvo" | "ei" | null => {
  const k = docNo.match(/-(RFA|RFC|CRF|PVO|EVO|VOR|VO|DVO|EMI|EI)-/i)?.[1]?.toUpperCase();
  return !k ? null : ["RFA", "RFC", "CRF"].includes(k) ? "rfc" : k === "PVO" ? "pvo" : ["EVO", "VOR", "VO"].includes(k) ? "vo" : k === "DVO" ? "dvo" : "ei";
};

const textOf = (pages: PosPage[]) => pages.map((p) => p.rows.map((r) => r.cells.map((c) => c.s).join(" ")).join("\n")).join("\n");
const lastNumber = (s: string | null | undefined): number | null => {
  const m = String(s ?? "").match(/(\d+)(?!.*\d)/);
  return m ? Number(m[1]) : null;
};
const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const money = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 100) / 100 : null;
};
const pad3 = (n: number) => String(n).padStart(3, "0");

async function readOne(f: DocFile): Promise<DocRead | null> {
  const isPdf = f.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  let pdf = isPdf ? f.bytes : null;
  if (!pdf && convertible(f.name)) {
    try {
      pdf = (await convertToPdf(f.bytes, f.name))?.pdf ?? null;
    } catch (e) {
      console.error("conversion failed:", f.name, e);
    }
  }
  if (!pdf) return null;
  const pages = await positioned(pdf);
  const text = textOf(pages);
  const head = text.slice(0, 20_000);
  if (/Workflow Transmittal|Workflow Review History/i.test(head)) {
    // the Aconex approval: "The attached documents have completed the '…' workflow" – Doc No | Step | Participant | Review Outcome
    const tight = text.replace(/-\s*\n\s*/g, "-").replace(/-\s+(?=[A-Z0-9])/g, "-");
    // the Doc No cell wraps: "1TB01031-031C10-" … "AMA-RFA-CM-0005" with the step and outcome cells in between
    const whole = tight.match(/\b1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-(?:RFA|RFC|CRF|PVO|EVO|VOR|VO|DVO|EMI|EI)-[A-Z]{2}-\d{4}\b/i)?.[0];
    const split = text.match(/\b(1TB\d{5}-\d{3}[A-Z]\d{2}-)\s*[\s\S]{0,240}?\b([A-Z]{2,4}-(?:RFA|RFC|CRF|PVO|EVO|VOR|VO|DVO|EMI|EI)-[A-Z]{2}-\d{4})\b/i);
    const docNo = (whole ?? (split ? `${split[1]}${split[2]}` : "")).toUpperCase();
    const stage = stageOfDoc(docNo);
    const mailNo = text.match(/\b[A-Z]{2,6}\d{5}-WTRAN-\d{6}\b/)?.[0] ?? f.name.match(/\b[A-Z]{2,6}\d{5}-WTRAN-\d{6}\b/)?.[0] ?? "";
    const date = isoOf(text.match(/\bSent\s+([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4})/)?.[1] ?? "");
    const outcomes = [...text.matchAll(/\b(Accepted(?: with Comments)?|Approved|Rejected|Not Accepted|Declined)\b/gi)].map((m) => m[1].toLowerCase());
    const outcome: "Approved" | "Rejected" | "Pending" = outcomes.some((o) => /reject|not accepted|declined/.test(o)) ? "Rejected" : outcomes.some((o) => /accept|approv/.test(o)) ? "Approved" : "Pending";
    // the mail's subject (the lines between the mail numbers and "From"), else the workflow's name in the message
    const lines = text.split("\n");
    const start = lines.findIndex((l) => /Workflow Transmittal/i.test(l));
    const stop = lines.findIndex((l, i) => i > start && /^\s*From\b/i.test(l));
    const mailSubject = start >= 0 && stop > start ? lines.slice(start + 1, stop).join(" ").replace(/\s+/g, " ").replace(/^\s*Final\s*\(WF-\d+\)\s*/i, "").trim() : "";
    const workflow = mailSubject || (text.match(/completed the\s*"([^"]+)"\s*workflow/i)?.[1]?.replace(/\s+/g, " ") ?? "");
    let subject = workflow.match(/\bto (?:instruct|appoint|engage)\b[^]*?\bto ([^]*)$/i)?.[1] ?? workflow.replace(/^.*?\((?:RFA|RFC|PVO|VO|EVO|DVO|EI)\)\s*[-–]?\s*(?:to\s+)?/i, "");
    subject = subject.replace(/\s+/g, " ").trim();
    if (subject) subject = subject[0].toUpperCase() + subject.slice(1);
    const programmeCode = docNo.match(/\b(1TB\d{5})\b/)?.[1] ?? "";
    const rfcNo = stage === "rfc" ? lastNumber(docNo) : null;
    const v: Record<string, string> = {};
    if (stage === "rfc") v.rfc_ref = docNo;
    if (subject) v.title = subject;
    const note = stage && docNo ? `Aconex approval of ${docNo}: ${outcome}${date ? ` on ${formatDate(date)}` : ""}` : "not recognised as an approval of an RFA, RFC, PVO, VO, DVO or EI – kept out";
    return { name: f.name, kind: stage && docNo ? "wtran" : "unknown", values: v, text, programmeCode, rfcNo, no: stage && stage !== "rfc" ? lastNumber(docNo) : null, approval: stage && docNo ? { docNo, stage, outcome, date, mailNo, subject } : undefined, note };
  }
  let kind: string = classifyDoc(pages, "");
  if (/Emergency Variation Order Assessment/i.test(head)) kind = "evo";
  else if (/employer.?s instruction \(ei\)|rsg-cm-frm-0007/i.test(head)) kind = "ei";
  let r: Reading;
  if (kind === "rfc") r = readRfc(pages);
  else if (kind === "ei") r = readEi(pages);
  else if (kind === "rfa") r = readRfaForChange(pages);
  else if (kind === "pvo") r = readReferencePvo(pages);
  else if (kind === "evo") r = readEvoForChange(pages);
  else if (kind === "dvo") r = readReferenceDvo(pages);
  else {
    r = readRfc(pages);
    if (!r.values.title && !r.values.rfc_ref) kind = "unknown";
  }
  const v = r.values;
  const programmeCode = (v.rfc_ref ?? "").match(/\b(1TB\d{5})\b/)?.[1] ?? f.name.match(/\b(1TB\d{5})\b/)?.[1] ?? text.match(/\b(1TB\d{5})\b/)?.[1] ?? "";
  // "RFC 94", "RFA-005" or the full Aconex reference "1TB01031-031C12-AMA-RFA-CM-0005": the last number is the one
  const rfcNo = (/-(?:RFA|RFC|CRF)-/i.test(v.rfc_ref ?? "") ? lastNumber(v.rfc_ref) : null) ?? lastNumber((v.rfc_ref ?? "").match(/(?:RFC|CRF|VOR|RFA)[-\s]*(?:CM[-\s]*)?0*(\d+)/i)?.[0] ?? "") ?? lastNumber(f.name.match(/(?:RFC|CRF|RFA)[-_ ]*(?:CM[-_ ]*)?0*(\d+)/i)?.[0] ?? "");
  // the document's own number: PVO 011, PVO-CM-0008, EVO 007, DVO-008
  const numberIn = (s: string, kinds: string) => lastNumber(s.match(new RegExp(`\\b(?:${kinds})[-_ ]?(?:CM[-_ ]?)?(?:No\\.?\\s*)?0*(\\d{1,4})\\b`, "i"))?.[0] ?? "");
  let no: number | null = null;
  if (kind === "pvo") no = numberIn(f.name, "PVO") ?? numberIn(head, "PVO");
  if (kind === "evo") no = numberIn(f.name, "EVO|VO") ?? numberIn(head, "EVO");
  if (kind === "dvo") no = lastNumber(v.dvo_no) ?? numberIn(f.name, "DVO") ?? numberIn(head, "DVO");
  if (kind === "ei") no = lastNumber(v.ei_no) ?? numberIn(f.name, "EI|EMI");
  const note = kind === "unknown" ? "not recognised as an RFC, PVO, EVO, EI, RFA or DVO – kept out" : `${KIND_LABEL[kind] ?? kind}${rfcNo ? ` of RFC ${pad3(rfcNo)}` : ""}${no ? ` No ${pad3(no)}` : ""}`;
  return { name: f.name, kind, values: v, text, programmeCode, rfcNo, no, note };
}

/** One change per RFC number; documents without one go by title; a document with neither stands alone. */
function group(docs: DocRead[]): DocRead[][] {
  const groups = new Map<string, DocRead[]>();
  const byTitle = new Map<string, string>();
  for (const d of docs) {
    const title = normTitle(d.values.title ?? "");
    let key = d.rfcNo ? `rfc:${d.programmeCode}:${d.rfcNo}` : "";
    if (!key && d.approval && d.no) {
      // a PVO / VO / DVO / EI approval joins the group whose document of that stage carries the number
      const host = [...groups.entries()].find(([, docs]) => docs.some((x) => x.kind === (d.approval!.stage === "vo" ? "evo" : d.approval!.stage) && x.no === d.no));
      if (host) key = host[0];
    }
    if (!key && title) key = byTitle.get(title) ?? `title:${d.programmeCode}:${title}`;
    if (!key) key = `file:${d.name}`;
    if (title) byTitle.set(title, key);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  // a titled document joins the RFC group that carries the same title
  const out = [...groups.values()];
  for (let i = out.length - 1; i >= 0; i--) {
    const g = out[i];
    if (g.some((d) => d.rfcNo)) continue;
    const t = normTitle(g[0].values.title ?? "");
    if (!t) continue;
    const host = out.find((h, j) => j !== i && h.some((d) => d.rfcNo) && h.some((d) => normTitle(d.values.title ?? "") === t));
    if (host) {
      host.push(...g);
      out.splice(i, 1);
    }
  }
  return out;
}

interface Lookups {
  status: (name: string) => number | null;
  category: (name: string) => number | null;
  initiator: (name: string) => number | null;
  stage: (name: string) => number | null;
  statusName: (id: number) => string;
}
function lookups(): Lookups {
  const db = getDb();
  const find = (key: string) => {
    const opts = lookupOptions(db, key, true);
    return (name: string) => opts.find((o) => o.label.toLowerCase() === name.toLowerCase())?.id ?? opts.find((o) => o.label.toLowerCase().startsWith(name.toLowerCase()))?.id ?? null;
  };
  const statuses = lookupOptions(db, "approval_statuses", true);
  return { status: find("approval_statuses"), category: find("change_categories"), initiator: find("change_initiators"), stage: find("project_stages"), statusName: (id: number) => statuses.find((o) => o.id === id)?.label ?? "–" };
}

const first = (docs: DocRead[], kinds: string[], key: string): { value: string; from: string } | null => {
  for (const k of kinds) for (const d of docs) if (d.kind === k && d.values[key]) return { value: d.values[key], from: `${KIND_LABEL[k]} ${d.name}` };
  return null;
};

export async function addChangesFromDocuments(files: DocFile[], user: UserInfo, decisionsIn: Decisions = {}): Promise<FromDocsResult> {
  let decisions: Decisions = { ...decisionsIn };
  const db = getDb();
  const def = getRegisterDef("changes")!;
  const app = getAppContext();
  const result: FromDocsResult = { entries: [], duplicates: [], needsDecision: false, files: [], periods: [], warnings: [] };
  const reads: DocRead[] = [];
  for (const f of files) {
    try {
      const r = await readOne(f);
      if (!r) {
        result.files.push({ name: f.name, kind: "other", note: "not a document that can be read (a picture or an unsupported file) – kept out" });
        continue;
      }
      result.files.push({ name: f.name, kind: r.kind, note: r.note });
      if (r.kind !== "unknown") reads.push(r);
    } catch (e) {
      console.error("document could not be read:", f.name, e);
      result.files.push({ name: f.name, kind: "error", note: `could not be read: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` });
    }
  }
  const L = lookups();
  const programmes = db.prepare("SELECT id, code, name FROM programmes").all() as { id: number; code: string; name: string }[];
  const plans: { key: string; docs: DocRead[]; programme: { id: number; code: string; name: string }; existing: RecordRow | null; record: Record<string, unknown>; patch: Record<string, unknown>; read: ReadValue[]; missing: string[]; title: string; itemNo: string; entry?: Outcome }[] = [];
  for (const docs of group(reads)) {
    const code = docs.map((d) => d.programmeCode).find(Boolean) ?? "";
    const programme = programmes.find((p) => p.code === code) ?? app.programme;
    if (!programme) {
      result.warnings.push(`${docs.map((d) => d.name).join(", ")}: no project could be told from the documents and none is selected in the top bar.`);
      continue;
    }
    const read: ReadValue[] = [];
    const missing: string[] = [];
    const take = (label: string, kinds: string[], key: string) => {
      const hit = first(docs, kinds, key);
      if (hit) read.push({ label, value: hit.value, from: hit.from });
      return hit?.value ?? "";
    };
    const HEAD = ["rfc", "ei", "rfa", "pvo", "evo", "dvo", "wtran"];
    // the subject: the Aconex approval's subject whenever there is one, else the documents' own titles
    const title = take("Description", ["wtran", "rfc", "ei", "rfa", "pvo", "evo", "dvo"], "title");
    const scope = take("Scope", HEAD, "scope");
    const reason = take("Reason / benefits", HEAD, "reason");
    const rootCause = take("Root cause", HEAD, "root_cause");
    const dateRaised = take("Date raised", ["rfc", "ei", "rfa"], "date");
    const contractTitle = take("Contract", ["rfc", "ei", "pvo", "evo", "dvo"], "contract_title") || take("Contract", ["dvo"], "contract_ref");
    const projectName = take("Project", HEAD, "project_name");
    const initiator = take("Initiated by", ["rfc", "pvo", "evo"], "initiated_by");
    const initiatorName = take("Amaala rep", ["rfc"], "initiated_by_name");
    const ewRefRaw = take("EWN / Risk ID", ["rfc"], "ew_ref");
    const ewRef = /^(n\/?a|none|nil|-)$/i.test(ewRefRaw) ? "" : ewRefRaw;
    const rom = take("ROM (SAR)", ["rfc", "rfa", "evo"], "rom_estimate");
    const timeImpact = take("Time impact (days)", ["rfc", "pvo", "evo", "dvo"], "time_impact");
    const pvoValue = take("PVO value (SAR)", ["pvo"], "total_value");
    const dvoValue = take("DVO value (SAR)", ["dvo"], "dvo_value");
    const rfcRefFull = take("RFC reference", ["rfc", "ei", "rfa", "evo", "pvo", "wtran"], "rfc_ref");
    const rfcNo = docs.map((d) => d.rfcNo).find(Boolean) ?? lastNumber(rfcRefFull);
    const pvoDoc = docs.find((d) => d.kind === "pvo");
    const evoDoc = docs.find((d) => d.kind === "evo");
    const dvoDoc = docs.find((d) => d.kind === "dvo");
    const eiDoc = docs.find((d) => d.kind === "ei");
    const rfcDoc = docs.find((d) => d.kind === "rfc");
    const rfaDoc = docs.find((d) => d.kind === "rfa");
    const approvals = docs.filter((d) => d.kind === "wtran" && d.approval).map((d) => d.approval!);

    // where the change sits: asset, contract, cost report line, contractor, package
    const assets = db.prepare("SELECT id, code, name FROM assets WHERE programme_id = ? ORDER BY code").all(programme.id) as { id: number; code: string; name: string }[];
    const pn = projectName.toLowerCase();
    const asset = assets.find((a) => pn && (pn.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(pn))) ?? (assets.length === 1 ? assets[0] : assets.find((a) => /project wide/i.test(a.name)) ?? assets[0]);
    const match = matchAgainstRegisters(db, programme.id, `${contractTitle}\n${docs.map((d) => d.text.slice(0, 20_000)).join("\n")}`, docs.map((d) => d.name).join(" "), { code: contractTitle });
    const contract = match.contract_id ? (db.prepare("SELECT id, cost_line_id, contractor_id, package_id FROM contracts WHERE id = ?").get(match.contract_id) as { id: number; cost_line_id: number | null; contractor_id: number | null; package_id: number | null } | undefined) : undefined;
    const line = contract?.cost_line_id ? (db.prepare("SELECT id, package_id, contractor_id FROM cost_lines WHERE id = ?").get(contract.cost_line_id) as { id: number; package_id: number | null; contractor_id: number | null } | undefined) : undefined;
    const contractorId = contract?.contractor_id ?? line?.contractor_id ?? match.contractor_id ?? null;
    const packageId = line?.package_id ?? contract?.package_id ?? (contractorId ? ((db.prepare("SELECT package_id FROM contractors WHERE id = ?").get(contractorId) as { package_id: number | null } | undefined)?.package_id ?? null) : null);
    if (contract || contractorId) read.push({ label: "Matched to", value: match.matched_by, from: "registers" });

    // an entry already in the register for this change?
    const rows = db.prepare("SELECT * FROM changes WHERE programme_id = ?").all(programme.id) as RecordRow[];
    const approvedNo = (stage: string) => approvals.find((a) => a.stage === stage)?.docNo;
    const requestKind = rfcDoc || /-(RFC|CRF)-/i.test(rfcRefFull) ? "rfc" : rfaDoc || /-RFA-/i.test(rfcRefFull) ? "rfa" : "rfc";
    const sameKind = (r: RecordRow) => (requestKind === "rfa" ? /rfa/i.test(String(r.rfc_ref ?? "")) || /-RFA-/i.test(String(r.rfc_aconex_ref ?? "")) : /(rfc|crf)/i.test(String(r.rfc_ref ?? "")) || /-(RFC|CRF)-/i.test(String(r.rfc_aconex_ref ?? "")) || (!/rfa/i.test(String(r.rfc_ref ?? "")) && /^\d+$/.test(String(r.rfc_ref ?? "").trim())));
    const existing =
      rows.find((r) => rfcNo && sameKind(r) && (lastNumber(String(r.rfc_aconex_ref ?? "")) === rfcNo || lastNumber(String(r.rfc_ref ?? "")) === rfcNo)) ??
      rows.find((r) => approvedNo("pvo") && lastNumber(String(r.pvo_ref ?? "")) === lastNumber(approvedNo("pvo"))) ??
      rows.find((r) => approvedNo("dvo") && lastNumber(String(r.dvo_ref ?? "")) === lastNumber(approvedNo("dvo"))) ??
      rows.find((r) => approvedNo("vo") && lastNumber(String(r.vo_ref ?? "")) === lastNumber(approvedNo("vo"))) ??
      rows.find((r) => pvoDoc?.no && lastNumber(String(r.pvo_ref ?? "")) === pvoDoc.no) ??
      rows.find((r) => dvoDoc?.no && lastNumber(String(r.dvo_ref ?? "")) === dvoDoc.no) ??
      rows.find((r) => title && normTitle(String(r.description ?? "")) === normTitle(title));

    if (!existing && docs.every((d) => d.kind === "wtran")) {
      result.warnings.push(`${docs.map((d) => d.name).join(", ")}: an approval of ${approvals[0]?.docNo ?? "a document"} that is not in the register yet – upload the RFA / RFC / PVO / DVO with it.`);
      continue;
    }
    const pending = L.status("Pending");
    const approved = L.status("Approved");
    const stage: Record<string, unknown> = {};
    // the statuses follow what was fed: an RFC alone leaves the PVO and the DVO pending; a PVO or VO
    // means the RFC and the PVO are approved and the DVO still pending; a DVO closes the change
    const hasVo = !!pvoDoc || !!evoDoc;
    stage.rfc_status_id = hasVo || dvoDoc ? approved : pending;
    stage.pvo_status_id = hasVo || dvoDoc ? approved : pending;
    if (evoDoc) stage.vo_status_id = approved;
    stage.dvo_status_id = dvoDoc ? approved : pending;
    if (rfaDoc && !rfcDoc) {
      // a Request for Approval stands where the RFC would: its reference, date and value
      stage.rfc_ref = rfcNo ? `RFA-${pad3(rfcNo)}` : rfcRefFull;
      if (/\b1TB\d{5}-/.test(rfcRefFull)) stage.rfc_aconex_ref = rfcRefFull;
      if (dateRaised) stage.rfc_date = dateRaised;
      if (money(rom)) stage.rfc_tracker_amount = money(rom);
    }
    if (rfcDoc) {
      stage.rfc_ref = rfcNo ? `RFC-${pad3(rfcNo)}` : rfcRefFull;
      stage.rfc_aconex_ref = /\b1TB\d{5}-/.test(rfcRefFull) ? rfcRefFull : rfcDoc.values.rfc_ref ?? "";
      if (dateRaised) stage.rfc_date = dateRaised;
      if (timeImpact) stage.rfc_time_impact = Number(timeImpact) || null;
      if (money(rom)) stage.rfc_tracker_amount = money(rom);
    } else if (rfcRefFull && !rfaDoc && !existing?.rfc_ref) stage.rfc_ref = rfcNo ? `RFC-${pad3(rfcNo)}` : rfcRefFull;
    if (eiDoc) {
      stage.ei_ref = eiDoc.values.ei_no || eiDoc.values.instruction_ref || (eiDoc.no ? `EI-${pad3(eiDoc.no)}` : "");
      if (eiDoc.values.instruction_ref) stage.ei_aconex_ref = eiDoc.values.instruction_ref;
      if (eiDoc.values.date) stage.ei_date = eiDoc.values.date;
      stage.ei_status_id = approved;
    }
    if (pvoDoc) {
      stage.pvo_ref = pvoDoc.no ? `PVO ${pad3(pvoDoc.no)}` : (existing?.pvo_ref as string) || "PVO";
      if (money(pvoValue)) {
        stage.pvo_tracker_amount = money(pvoValue);
        stage.pvo_cr_amount = money(pvoValue);
      }
      if (pvoDoc.values.time_impact) stage.pvo_time_impact = Number(pvoDoc.values.time_impact) || null;
      if (pvoDoc.values.date) stage.pvo_date = pvoDoc.values.date;
    }
    if (evoDoc) {
      stage.vo_ref = evoDoc.no ? `EVO ${pad3(evoDoc.no)}` : (existing?.vo_ref as string) || "EVO";
      if (money(evoDoc.values.total_value)) {
        stage.vo_tracker_amount = money(evoDoc.values.total_value);
        stage.vo_cr_amount = money(evoDoc.values.total_value);
      }
    }
    if (dvoDoc) {
      stage.dvo_ref = dvoDoc.no ? `DVO-${pad3(dvoDoc.no)}` : (existing?.dvo_ref as string) || "DVO";
      if (money(dvoValue)) {
        stage.dvo_tracker_amount = money(dvoValue);
        stage.dvo_cr_amount = money(dvoValue);
        stage.dvo_actual_value = money(dvoValue);
      }
      const planned = money(pvoValue) ?? money(String(existing?.pvo_tracker_amount ?? ""));
      if (planned) stage.dvo_planned_value = planned;
      if (dvoDoc.values.time_impact) stage.dvo_time_impact = Number(dvoDoc.values.time_impact) || null;
    }
    // the Aconex approvals: the stage's status, its date and the workflow reference
    for (const ap of approvals) {
      const id = ap.outcome === "Approved" ? approved : ap.outcome === "Rejected" ? L.status("Rejected") ?? pending : pending;
      stage[`${ap.stage}_status_id`] = id;
      if (ap.date) stage[`${ap.stage}_date`] = ap.date;
      if (ap.mailNo) stage[`${ap.stage}_aconex_ref`] = ap.mailNo;
      if (ap.stage === "rfc" && !stage.rfc_ref) stage.rfc_ref = /RFA/i.test(ap.docNo) ? `RFA-${pad3(lastNumber(ap.docNo) ?? 0)}` : `RFC-${pad3(lastNumber(ap.docNo) ?? 0)}`;
      if (ap.stage === "pvo" && !stage.pvo_ref) stage.pvo_ref = `PVO ${pad3(lastNumber(ap.docNo) ?? 0)}`;
      if (ap.stage === "vo" && !stage.vo_ref) stage.vo_ref = `${/EVO/i.test(ap.docNo) ? "EVO" : "VO"} ${pad3(lastNumber(ap.docNo) ?? 0)}`;
      if (ap.stage === "dvo" && !stage.dvo_ref) stage.dvo_ref = `DVO-${pad3(lastNumber(ap.docNo) ?? 0)}`;
      read.push({ label: `${ap.stage.toUpperCase()} approval`, value: `${ap.outcome}${ap.date ? ` on ${formatDate(ap.date)}` : ""} (${ap.mailNo || ap.docNo})`, from: `Aconex workflow ${ap.mailNo}` });
    }
    // the cost report carries the furthest stage only
    if (money(pvoValue) || money(dvoValue) || existing?.pvo_cr_amount) stage.rfc_cr_amount = 0;
    else if (rfcDoc && money(rom)) stage.rfc_cr_amount = money(rom);

    if (!title) missing.push("Description / title");
    if (!dateRaised) missing.push("Date raised");
    if (!rom && !pvoValue && !dvoValue) missing.push("Cost (ROM / PVO / DVO value)");
    if (!timeImpact) missing.push("Time impact (days)");
    if (!contract && !contractorId) missing.push("Contract / contractor / package");
    if (!contract?.cost_line_id) missing.push("Cost report line");
    if (!rootCause) missing.push("Root cause");
    if (!scope && !reason) missing.push("Scope / reason");

    const stamp = `Added from documents on ${formatDate(todayIso())} (${docs.map((d) => d.name).join("; ")})`;
    const extras = [ewRef && `EWN / Risk ID ${ewRef}`, rfcDoc?.values.delivered_by && `Delivered by: ${rfcDoc.values.delivered_by}`, rfcDoc?.values.change_type && `Change type: ${rfcDoc.values.change_type}`, rom && `ROM ${formatMoney(Number(rom))} SAR`].filter(Boolean).join(" · ");
    const missingNote = missing.length ? `Not found in the documents – to be added by hand: ${missing.join(", ")}.` : "";
    const summary = [scope && `Scope: ${scope}`, reason && `Reason: ${reason}`].filter(Boolean).join("\n");

    if (dvoDoc) stage.overall_status_id = approved;
    const patch: Record<string, unknown> = { ...stage };
    if (existing) {
      const fill = (key: string, value: unknown) => {
        if (value !== "" && value !== null && value !== undefined && (existing[key] === null || existing[key] === undefined || existing[key] === "")) patch[key] = value;
      };
      fill("description", title);
      fill("date_raised", dateRaised);
      fill("asset_id", asset?.id ?? null);
      fill("package_id", packageId);
      fill("contractor_id", contractorId);
      fill("cost_line_id", contract?.cost_line_id ?? null);
      fill("amaala_rep", initiatorName);
      fill("ew_ref", ewRef);
      patch.notes = [String(existing.notes ?? "").trim(), `${stamp}. ${extras}`.trim(), missingNote].filter(Boolean).join("\n");
    }
    // the next number in the register's own pattern: CH-146 (one series), or CH-006C72-17 (a series per package)
    const perPackage = rows.some((r) => /^CH-\d{3}[A-Z]\d{2}-/i.test(String(r.item_no ?? "")));
    const acc = (contract ? (db.prepare("SELECT acc_ref FROM contracts WHERE id = ?").get(contract.id) as { acc_ref: string | null } | undefined)?.acc_ref ?? "" : "").match(/\d{3}[A-Z]\d{2}/i)?.[0]?.toUpperCase() ?? contractTitle.match(/\d{3}[A-Z]\d{2}/i)?.[0]?.toUpperCase() ?? "";
    const queued = plans.filter((pl) => pl.programme.id === programme.id && !pl.existing);
    let itemNo: string;
    // the first free number: a number freed by a deleted entry is used again, so the series keeps no gap
    const firstFree = (used: Set<number>, from = 1) => {
      let n = from;
      while (used.has(n)) n++;
      return n;
    };
    const typedMax = (nums: number[]) => nums.reduce((a, b) => Math.max(a, b), 0);
    if (perPackage && acc) {
      const used = new Set(rows.map((r) => Number(String(r.item_no ?? "").match(new RegExp(`^CH-${acc}-(\\d+)$`, "i"))?.[1] ?? 0)).filter(Boolean));
      for (const pl of queued) {
        const n = Number(pl.itemNo.match(new RegExp(`^CH-${acc}-(\\d+)$`, "i"))?.[1] ?? 0);
        if (n) used.add(n);
      }
      itemNo = `CH-${acc}-${firstFree(used, Math.max(1, typedMax(rows.filter((r) => !/Added from documents/.test(String(r.notes ?? ""))).map((r) => Number(String(r.item_no ?? "").match(new RegExp(`^CH-${acc}-(\\d+)$`, "i"))?.[1] ?? 0))) + 1))}`;
    } else {
      const used = new Set(rows.map((r) => Number(String(r.item_no ?? "").match(/^CH-(\d+)$/i)?.[1] ?? 0)).filter(Boolean));
      for (const pl of queued) {
        const n = Number(pl.itemNo.match(/^CH-(\d+)$/i)?.[1] ?? 0);
        if (n) used.add(n);
      }
      const typed = typedMax(rows.filter((r) => !/Added from documents/.test(String(r.notes ?? ""))).map((r) => Number(String(r.item_no ?? "").match(/^CH-(\d+)$/i)?.[1] ?? 0)));
      itemNo = `CH-${pad3(firstFree(used, typed + 1))}`;
    }
    const record: Record<string, unknown> = {
      programme_id: programme.id,
      item_no: itemNo,
      description: title || docs[0].name.replace(/\.[a-z0-9]+$/i, ""),
      overall_status_id: pending,
      date_raised: dateRaised || todayIso(),
      asset_id: asset?.id ?? null,
      package_id: packageId,
      contractor_id: contractorId,
      cost_line_id: contract?.cost_line_id ?? null,
      project_stage_id: L.stage("Post-Contract Variation"),
      // the register's own convention: a change raised by RSG / the Employer is an "Amaala" change
      change_category_id: /rsg|employer|amaala|owner/i.test(initiator) || !initiator ? L.category("Amaala") : (L.category(/design/i.test(rootCause) ? "Design Dev" : /authority/i.test(rootCause) ? "Authority" : /scope/i.test(rootCause) ? "Scope Gap" : "Amaala") ?? L.category("Amaala")),
      initiated_by_id: L.initiator(/contractor/i.test(initiator) ? "Contractor" : /consultant/i.test(initiator) ? "Consultant" : "Employer"),
      amaala_rep: initiatorName,
      action_pending_by: "Commercial Team",
      ew_ref: ewRef,
      ...stage,
      notes: [summary, `${stamp}. ${extras}`.trim(), missingNote].filter(Boolean).join("\n"),
    };
    plans.push({ key: `change:${programme.id}:${rfcNo ?? normTitle(title)}`, docs, programme, existing: existing ?? null, record, patch, read, missing, title: title || docs[0].name, itemNo });
  }

  // a duplicate waits for a decision: nothing is written until every one has it
  const undecided = plans.filter((pl) => pl.existing && !decisions[pl.key]);
  if (undecided.length) {
    const statusName = (id: unknown) => L.statusName(Number(id));
    const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "number" ? formatMoney(v) : String(v));
    result.duplicates = undecided.map<Duplicate>((pl) => {
      const ex = pl.existing!;
      const diffs: { label: string; old: string; new: string }[] = [];
      const cmp = (label: string, key: string, fmt: (v: unknown) => string = show) => {
        const n = pl.patch[key];
        if (n !== undefined && fmt(ex[key]) !== fmt(n)) diffs.push({ label, old: fmt(ex[key]), new: fmt(n) });
      };
      cmp("RFC reference", "rfc_ref");
      cmp("RFC date", "rfc_date");
      cmp("RFC status", "rfc_status_id", statusName);
      cmp("RFC amount", "rfc_tracker_amount");
      cmp("PVO reference", "pvo_ref");
      cmp("PVO status", "pvo_status_id", statusName);
      cmp("PVO amount", "pvo_tracker_amount");
      cmp("VO reference", "vo_ref");
      cmp("EI reference", "ei_ref");
      cmp("DVO reference", "dvo_ref");
      cmp("DVO status", "dvo_status_id", statusName);
      cmp("DVO amount", "dvo_tracker_amount");
      return {
        key: pl.key,
        existing: { id: Number(ex.id), label: String(ex.item_no ?? ""), detail: `${String(ex.description ?? "")} – RFC ${ex.rfc_ref ?? "–"}, PVO ${ex.pvo_ref ?? "–"}, DVO ${ex.dvo_ref ?? "–"}` },
        incoming: { label: `next ${pl.itemNo}`, detail: `${pl.title} – ${pl.docs.map((d) => KIND_LABEL[d.kind] ?? d.kind).join(", ")}` },
        differences: diffs,
        files: pl.docs.map((d) => d.name),
      };
    });
    // the same documents again with nothing new in them: nothing to decide, the row is simply kept
    for (const d of result.duplicates.filter((d) => !d.differences.length)) decisions = { ...decisions, [d.key]: "keep" };
    result.duplicates = result.duplicates.filter((d) => d.differences.length);
    if (result.duplicates.length) {
      result.needsDecision = true;
      return result;
    }
  }

  // every new entry goes under the current month's report
  const rolled = new Set<number>();
  for (const pl of plans) {
    if (pl.existing && decisions[pl.key] === "keep") {
      result.entries.push({ action: "kept", id: Number(pl.existing.id), label: String(pl.existing.item_no ?? ""), description: String(pl.existing.description ?? ""), programme: pl.programme.name, files: pl.docs.map((d) => d.name), read: pl.read, missing: pl.missing });
      continue;
    }
    if (!rolled.has(pl.programme.id)) {
      rolled.add(pl.programme.id);
      try {
        const p = ensureOpenMonth(pl.programme.id, user);
        result.periods.push({ programme: pl.programme.name, ...p });
      } catch (e) {
        result.warnings.push(`${pl.programme.name}: the month's report could not be opened – ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (pl.existing) {
      const row = updateRecord(def, Number(pl.existing.id), pl.patch, user, "import", { bypassRoles: user.role === "admin" });
      pl.entry = { action: "updated", id: row.id, label: String(row.item_no ?? ""), description: String(row.description ?? ""), programme: pl.programme.name, files: pl.docs.map((d) => d.name), read: pl.read, missing: pl.missing };
      result.entries.push(pl.entry);
    } else {
      const row = createRecord(def, pl.record, user, "import");
      pl.entry = { action: "created", id: row.id, label: pl.itemNo, description: String(row.description ?? ""), programme: pl.programme.name, files: pl.docs.map((d) => d.name), read: pl.read, missing: pl.missing };
      result.entries.push(pl.entry);
    }
  }
  // entries added from documents keep an unbroken series: one deleted and added again leaves no gap behind
  for (const programmeId of new Set(result.entries.map((e) => plans.find((pl) => pl.entry === e)?.programme.id ?? 0).filter(Boolean))) closeGaps(programmeId, user, result);
  return result;
}

/** Renumbers the document-added entries of a project so the CH series has no gap (entries typed by hand keep their numbers). */
export function closeGaps(programmeId: number, user: UserInfo, result: FromDocsResult = { entries: [], duplicates: [], needsDecision: false, files: [], periods: [], warnings: [] }) {
  const db = getDb();
  const def = getRegisterDef("changes")!;
  const rows = db.prepare("SELECT id, item_no, notes FROM changes WHERE programme_id = ? ORDER BY id").all(programmeId) as { id: number; item_no: string; notes: string | null }[];
  if (rows.some((r) => /^CH-\d{3}[A-Z]\d{2}-/i.test(r.item_no))) return; // a series per package is left as it is
  const fixed = new Set(rows.filter((r) => !/Added from documents/.test(r.notes ?? "")).map((r) => Number(r.item_no.match(/^CH-(\d+)$/i)?.[1] ?? 0)).filter(Boolean));
  const movable = rows.filter((r) => /Added from documents/.test(r.notes ?? "") && /^CH-\d+$/i.test(r.item_no)).sort((a, b) => Number(a.item_no.slice(3)) - Number(b.item_no.slice(3)));
  let n = [...fixed].reduce((a, b) => Math.max(a, b), 0) + 1;
  for (const r of movable) {
    while (fixed.has(n)) n++;
    const want = `CH-${pad3(n)}`;
    fixed.add(n);
    if (r.item_no !== want) {
      try {
        updateRecord(def, r.id, { item_no: want }, user, "import", { bypassRoles: true });
        for (const e of result.entries) if (e.id === r.id) e.label = want;
        result.warnings.push(`${r.item_no} renumbered to ${want} so the series has no gap.`);
      } catch (e) {
        console.error("renumbering failed:", e);
      }
    }
  }
}
