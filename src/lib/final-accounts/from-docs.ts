import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { createRecord, listRecords, updateRecord } from "../registers/engine";
import type { RecordRow, UserInfo } from "../registers/types";
import { positioned } from "../packs/extract";
import type { PosPage } from "../packs/positioned";
import { convertToPdf, convertible } from "../packs/convert";
import { getAppContext } from "../context";
import { formatDate, formatMoney, parseDateInput, todayIso } from "../format";
import { ocrAvailable, ocrPdfPages } from "../ocr";
import { type Decisions, type FromDocsResult, type ReadValue } from "../from-docs-shared";
import { addDoc, type Reading } from "../library/store";
import { contractorKey } from "../bonds/name-key";
import { codeFrag } from "../workbook/claims-tracker";
import { computeContracts } from "../payments/compute";

/**
 * The final account of a contract, read from its own documents: the Financial Account Statement
 * form (AMA-CM-FRM-0020) with the final contract price and its build-up, the Aconex workflow
 * transmittal that records its acceptance up to the GCEO, and the transmittal that issued it to the
 * contractor. Together they close the contract on the Final Account Status (status, signed date,
 * statement reference, final contract price), close it in Payment Tracking with the final account
 * adjustment that brings the revised contract value to the agreed figure, file every document in
 * the Contract Library under the contract, and – through the registers themselves – release its
 * bonds and close its open changes.
 */
export interface DocFile {
  name: string;
  bytes: Buffer;
}

export interface FaRead {
  name: string;
  kind: "statement" | "approval" | "transmittal" | "unknown";
  text: string;
  programmeCode: string;
  /** the contract code fragment, 031C12 */
  acc: string;
  contractNo: string;
  contractName: string;
  contractor: string;
  employer: string;
  statementDate: string;
  completionDate: string;
  revisedCompletion: string;
  constructionPrice: number | null;
  optionalPrice: number | null;
  contractPrice: number | null;
  vos: number | null;
  omissions: number | null;
  claims: number | null;
  others: number | null;
  finalPrice: number | null;
  dvos: { ref: string; title: string; amount: number }[];
  signedContractor: string;
  signedEmployer: string;
  statementRef: string;
  mailNo: string;
  docNo: string;
  sentDate: string;
  subject: string;
  reason: string;
  steps: { step: string; who: string; outcome: string }[];
  accepted: boolean | null;
  reviewComments: string[];
  ocr: boolean;
  note: string;
}

const textOf = (pages: PosPage[]) => pages.map((p) => p.rows.map((r) => r.cells.map((c) => c.s).join(" ")).join("\n")).join("\n");
const squash = (s: string) => s.replace(/\s+/g, "");
const MONEY = "\\(?-?[\\d,]{1,15}\\.\\d{2}\\)?";
function money(s: string | undefined | null): number | null {
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s.trim()) || s.trim().startsWith("-");
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}
/** the money figure that follows a label, on the same line or the next */
function after(text: string, label: RegExp): number | null {
  const m = new RegExp(`${label.source}\\s*:?\\s*(${MONEY})`, "i").exec(text);
  return m ? money(m[1]) : null;
}
/** "31-May-25", "September 11, 2026", "Friday, September 11, 2026" → ISO */
function dateOf(s: string | undefined | null): string {
  if (!s) return "";
  const t = s.replace(/^\s*[A-Za-z]+day,\s*/, "").trim();
  const iso = parseDateInput(t);
  if (iso) return iso;
  const m = /([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return "";
}
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

const sameCompany = (a: unknown, b: unknown) => {
  const ka = contractorKey(a);
  const kb = contractorKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const w = (s: unknown) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3 && !["company", "limited", "contracting", "engineering", "construction", "general", "saudi", "arabia"].includes(x));
  const wa = w(a);
  const wb = w(b);
  return wa.length > 0 && wb.length > 0 && wa.filter((x) => wb.includes(x)).length >= Math.min(2, Math.min(wa.length, wb.length));
};

async function readOne(f: DocFile): Promise<FaRead | null> {
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
  let text = textOf(pages);
  let ocr = false;
  const blank = pages.map((p, i) => ({ i: i + 1, len: p.rows.reduce((a, r) => a + r.cells.reduce((b, c) => b + c.s.length, 0), 0) })).filter((p) => p.len < 40).map((p) => p.i).slice(0, 4);
  if (blank.length && blank.includes(1) && ocrAvailable()) {
    const read = await ocrPdfPages(pdf, blank);
    const extra = [...read.values()].filter((t) => t.trim().length > 20);
    if (extra.length) {
      text = `${extra.join("\n")}\n${text}`;
      ocr = true;
    }
  }
  const head = text.slice(0, 6000);
  const sqHead = squash(head);
  const isMail = /MAIL\s*TYPE/i.test(head.slice(0, 1500));
  const subjectRaw = isMail ? (head.match(/REFERENCE\s*NUMBER\s*\n[^\n]*\n([\s\S]{5,400}?)\n\s*From\b/i)?.[1] ?? head.slice(0, 600)) : "";
  const subject = tidy(subjectRaw);
  const isFaMail = isMail && /Final\s*Account/i.test(subject);
  const isWorkflow = isFaMail && (/Workflow\s*Transmittal/i.test(head.slice(0, 1500)) || /Workflow\s*Review\s*History/i.test(head));
  const isStatement = !isMail && /Financial\s*Account\s*Statement|Final\s*Account\s*Statement|Statement\s*of\s*Final\s*Account/i.test(head.slice(0, 2500));
  const kind: FaRead["kind"] = isStatement ? "statement" : isWorkflow ? "approval" : isFaMail ? "transmittal" : "unknown";
  const programmeCode = (`${f.name}\n${head}`.match(/\b(1TB\d{5})\b/)?.[1] ?? (sqHead.match(/1\.?TB\.?(\d{2})\.?(\d{3})/i) ? `1TB${sqHead.match(/1\.?TB\.?(\d{2})\.?(\d{3})/i)![1]}${sqHead.match(/1\.?TB\.?(\d{2})\.?(\d{3})/i)![2]}` : "")).toUpperCase();
  const accFrom = (s: string) => (s.match(/(?<![A-Z0-9])(\d{3}[A-Z]\d{2})(?![A-Z0-9])/i)?.[1] ?? "").toUpperCase();
  const acc = accFrom(subject ? squash(subject) : "") || accFrom(f.name) || accFrom(sqHead);
  const statementRef = `${f.name}\n${sqHead}`.match(/\b(1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-SFA-[A-Z]{2,4}-\d{4})/i)?.[1]?.toUpperCase() ?? "";
  const base: FaRead = {
    name: f.name, kind, text, programmeCode, acc, contractNo: "", contractName: "", contractor: "", employer: "", statementDate: "", completionDate: "", revisedCompletion: "", constructionPrice: null, optionalPrice: null, contractPrice: null, vos: null, omissions: null, claims: null, others: null, finalPrice: null, dvos: [], signedContractor: "", signedEmployer: "", statementRef, mailNo: "", docNo: "", sentDate: "", subject, reason: "", steps: [], accepted: null, reviewComments: [], ocr, note: "",
  };
  if (kind === "unknown") return { ...base, note: "not recognised as a final account statement or its transmittal – kept out" };

  if (kind === "statement") {
    const form = text.slice(0, 4000);
    base.contractNo = tidy(squash(form.match(/Contract\s*No\.?\s*(1TB\d{2}-?\s*\d{3}[A-Z]\d{2}(?:-\s*\d{2,5})?)/i)?.[1] ?? ""));
    base.contractName = tidy(text.match(/Scope\s*of\s*Works\s+([^\n]{5,160})/i)?.[1] ?? form.match(/Contract\s*Name\s+([\s\S]{5,200}?)\s+Contract\s*No\.?/i)?.[1] ?? "");
    base.completionDate = dateOf(text.match(/Contract\s*Completion\s*Date\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i)?.[1]);
    base.revisedCompletion = dateOf(text.match(/Revised\s*Completion\s*Date\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i)?.[1]);
    base.employer = tidy(form.match(/Employer.?s\s+(.{3,80}?)\s+Date\s/i)?.[1] ?? "");
    base.statementDate = dateOf(form.match(/Employer.?s[^\n]*?\s+Date\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i)?.[1] ?? form.match(/\bDate\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/)?.[1]);
    base.constructionPrice = after(form, /Construction\s*Works?\s*Price/);
    base.optionalPrice = after(form, /Optional\s*(?:Marine\s*)?Works?\s*Price/);
    base.vos = after(form, /Carried\s*from\s*Variation\s*Orders?/);
    base.omissions = after(form, /Carried\s*from\s*Omissions?/);
    base.claims = after(form, /Carried\s*from\s*Claims?/);
    base.others = after(form, /\bOthers?\b/);
    base.finalPrice = after(form, /Final\s*Contract\s*Price/) ?? after(text, /Grand\s*Total\s*Final\s*Contract[^\n]*?/);
    base.contractPrice = after(text, /Contract\s*\(A\s*\+\s*B\)/) ?? (base.constructionPrice !== null && base.optionalPrice !== null ? Math.round((base.constructionPrice + base.optionalPrice) * 100) / 100 : base.constructionPrice);
    // the signatures block of the form
    base.signedContractor = tidy(form.match(/Contractor\s*Representative\s*\n([^\n]{3,80})\n\s*Name\s/i)?.[1] ?? "");
    base.signedEmployer = tidy(form.match(/Final\s*Approval\s*by\s*the\s*Employer[^\n]*\n([^\n]{3,80})\n\s*Name\s/i)?.[1] ?? "");
    // the annexure names the contractor and lists the approved variation orders
    base.contractor = tidy(text.match(/ANNEXURE-?\s*\d*\s*:\s*([A-Z][A-Z &.,'-]{4,80}?)\s+FINAL\s*ACCOUNT/i)?.[1] ?? text.match(/Contractor.?s\s*Name\s*\n?\s*([^\n]{4,80})/i)?.[1] ?? "");
    const rowRe = new RegExp(`^\\s*D\\.\\d+\\s+(?:(.*?)\\s+)?(DVO-?\\d{1,3})\\s+(${MONEY})`, "i");
    const isRow = (l: string) => /^\s*(?:[A-E](?:\.\d+)?\s|Approved\s*Variation|Sr\s+Description|\*\s*Note)/i.test(l);
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      const m = rowRe.exec(l);
      if (!m) return;
      const amount = money(m[3]);
      if (amount === null) return;
      let title = tidy(m[1] ?? "");
      if (!title) title = tidy([i > 0 && !isRow(lines[i - 1]) ? lines[i - 1] : "", i + 1 < lines.length && !isRow(lines[i + 1]) ? lines[i + 1] : ""].join(" "));
      base.dvos.push({ ref: m[2].toUpperCase(), title, amount });
    });
    const parts = [base.contractPrice !== null ? `contract ${formatMoney(base.contractPrice)}` : "", base.vos ? `variation orders ${formatMoney(base.vos)}` : "", base.omissions ? `omissions ${formatMoney(base.omissions)}` : "", base.claims ? `claims ${formatMoney(base.claims)}` : ""].filter(Boolean).join(", ");
    base.note = `final account statement${base.acc ? ` for ${base.acc}` : ""}${base.contractor ? ` – ${base.contractor}` : ""}${base.finalPrice !== null ? `: final contract price SAR ${formatMoney(base.finalPrice)}` : ""}${parts ? ` (${parts})` : ""}${base.statementDate ? `, dated ${formatDate(base.statementDate)}` : ""}${ocr ? " (scanned pages read by OCR)" : ""}`;
    return base;
  }

  // Aconex mails: the workflow approval or the transmittal to the contractor
  base.mailNo = head.match(/\b([A-Z]{2,5}\d{3,6}-[A-Z]{3,10}-\d{4,7})\b/)?.[1]?.toUpperCase() ?? "";
  base.sentDate = dateOf(head.match(/\bSent\s+([A-Za-z]+,?\s*[A-Za-z]+\s+\d{1,2},?\s+\d{4})/)?.[1] ?? head.match(/\bSent\s+([^\n]{6,40})/)?.[1]);
  base.reason = tidy(head.match(/\bReason\s+([^\n]{3,60})/)?.[1] ?? "");
  base.docNo = squash(text).match(/\b(1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4}(?:C\d)?)/i)?.[1]?.toUpperCase() ?? "";
  if (!base.statementRef && /-SFA-/i.test(base.docNo)) base.statementRef = base.docNo;
  // "… Final Account Statement - Al Saad General Contracting Company - Construction of …"
  const sm = subject.match(/Final\s*Account\s*Statement\s*[-–]\s*([^-–]{4,80}?)\s*(?:[-–]\s*([^\n]{3,160}))?$/i);
  base.contractor = tidy(sm?.[1] ?? "");
  base.contractName = tidy(sm?.[2] ?? "");
  if (kind === "approval") {
    const at = text.search(/Workflow\s*Review\s*History/i);
    const history = text.slice(at >= 0 ? at : 0);
    const OUTCOME = /\b(Accepted\s+with\s+Comments|Accepted\s+with|Accepted|Rejected|Not\s+Accepted|Review\s+Not\s+Required|Returned|Cancelled)\b/i;
    // a step row: a workflow step name (Lead_Commercial_Package, GCEO), the participant's initial and surname, then the outcome or a slice of a comment
    const stepRe = /^\s*([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+|[A-Z]{3,8})\s+([A-Z]\.?\s[A-Za-z'’-]+)\s*(.*)$/;
    const skip = /^(Doc\s*No\b|Step\s+Participant|Workflow\s*Review\s*History|This\s*transmittal|The\s*attached|Company\s*-|Page\s*\d|https?:|\d{1,2}\/\d{1,2}\/\d{2,4}|-+\s*\d+\s*of|=====)/i;
    const lines = history.split("\n").map(tidy).filter(Boolean);
    const comments: string[] = [];
    lines.forEach((l, i) => {
      if (skip.test(l)) return;
      if (/^(1TB\d{5}-|[A-Z]{2,4}-SFA-|[A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4})/.test(l) || /^(Accepted\s+with|Comments)$/i.test(l)) return;
      const m = stepRe.exec(l);
      if (m) {
        const rest = tidy(m[3]);
        const o = OUTCOME.exec(rest);
        let outcome = o ? tidy(o[1]) : "";
        if (!outcome || /^Accepted\s+with$/i.test(outcome)) {
          const near = [lines[i - 1] ?? "", lines[i + 1] ?? ""].join(" ");
          outcome = /Accepted\s+with|Comments/i.test(near) || /^Accepted\s+with$/i.test(outcome) ? "Accepted with Comments" : outcome || "Reviewed";
        }
        base.steps.push({ step: m[1], who: tidy(m[2]), outcome });
        const comment = o ? tidy(rest.replace(OUTCOME, "")) : rest;
        if (comment) comments.push(comment);
        return;
      }
      comments.push(l);
    });
    const outcomes = base.steps.map((x) => x.outcome.toLowerCase());
    base.accepted = outcomes.length ? outcomes.every((o) => o.startsWith("accepted") || o.startsWith("review not required") || o === "reviewed") && outcomes.some((o) => o.startsWith("accepted")) : /\bAccepted\b/.test(history) && !/\bRejected\b|Not\s*Accepted/i.test(history);
    base.reviewComments = comments.length ? [tidy(comments.join(" "))] : [];
    base.note = `final account statement ${base.accepted ? "accepted" : base.accepted === false ? "not accepted" : "reviewed"} in Aconex workflow ${base.mailNo || ""}${base.sentDate ? ` on ${formatDate(base.sentDate)}` : ""}${base.steps.length ? ` – ${base.steps.map((s) => `${s.who}: ${s.outcome}`).join(", ")}` : ""}`;
    return base;
  }
  base.note = `final account statement issued to the contractor${base.reason ? ` (${base.reason.toLowerCase()})` : ""} – ${base.mailNo || "transmittal"}${base.sentDate ? ` on ${formatDate(base.sentDate)}` : ""}`;
  return base;
}

export async function addFinalAccountsFromDocuments(files: DocFile[], user: UserInfo, _decisions: Decisions = {}): Promise<FromDocsResult> {
  void _decisions;
  const db = getDb();
  const faDef = getRegisterDef("final_accounts")!;
  const ctDef = getRegisterDef("contracts")!;
  const app = getAppContext();
  const result: FromDocsResult = { entries: [], duplicates: [], needsDecision: false, files: [], periods: [], warnings: [] };
  const reads: FaRead[] = [];
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
  if (!reads.length) return result;
  const programmes = db.prepare("SELECT id, code, name FROM programmes").all() as { id: number; code: string; name: string }[];
  const contractors = db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string }[];
  const programmeOf = (r: FaRead) => programmes.find((p) => r.programmeCode && String(p.code ?? "").toUpperCase().startsWith(r.programmeCode)) ?? app.programme ?? programmes[0];

  // one plan per contract: its statement, its approval and its transmittal read together
  type Group = { acc: string; programme: { id: number; name: string }; statement?: FaRead; approval?: FaRead; transmittal?: FaRead; names: string[] };
  const groups = new Map<string, Group>();
  for (const r of reads) {
    const programme = programmeOf(r);
    const key = `${programme.id}:${r.acc || r.contractor || r.name}`;
    const g = groups.get(key) ?? { acc: r.acc, programme, names: [] };
    if (r.kind === "statement") g.statement = r;
    else if (r.kind === "approval") g.approval = r;
    else g.transmittal = r;
    g.names.push(r.name);
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const p = g.programme;
    if (app.programme && p.id !== app.programme.id) result.warnings.push(`${g.names.join(", ")}: ${g.acc || "this contract"} belongs to ${p.name} – its final account is updated under ${p.name}, not ${app.programme.name}. Switch the project in the top bar to see it.`);
    const contractorName = g.statement?.contractor || g.approval?.contractor || g.transmittal?.contractor || "";
    const lines = db.prepare("SELECT id, code, name, contractor_id, package_id FROM cost_lines WHERE programme_id = ?").all(p.id) as RecordRow[];
    const faRows = listRecords(faDef, { allScopes: true }).filter((r) => Number(r.programme_id) === p.id);
    const ctRows = listRecords(ctDef, { allScopes: true }).filter((r) => Number(r.programme_id) === p.id);
    const fragOf = (s: unknown) => codeFrag(String(s ?? ""));
    const line = g.acc ? lines.find((l) => fragOf(l.code) === g.acc) ?? null : null;
    const contract = (g.acc ? ctRows.find((c) => fragOf(c.acc_ref) === g.acc || (c.cost_line_id && fragOf(lines.find((l) => l.id === c.cost_line_id)?.code) === g.acc)) : undefined) ?? (contractorName ? ctRows.find((c) => sameCompany(c.contractor_id__label, contractorName)) : undefined) ?? null;
    const fa = (g.acc ? faRows.find((r) => fragOf(r.acc_ref) === g.acc || (r.cost_line_id && fragOf(lines.find((l) => l.id === r.cost_line_id)?.code) === g.acc)) : undefined) ?? (contract ? faRows.find((r) => Number(r.contract_id) === Number(contract.id) || (r.cost_line_id && Number(r.cost_line_id) === Number(contract.cost_line_id))) : undefined) ?? null;
    const contractor = contractors.find((c) => contractorName && sameCompany(c.name, contractorName)) ?? (contract?.contractor_id ? contractors.find((c) => c.id === Number(contract.contractor_id)) : undefined) ?? (line?.contractor_id ? contractors.find((c) => c.id === Number(line.contractor_id)) : undefined) ?? (fa?.contractor_id ? contractors.find((c) => c.id === Number(fa.contractor_id)) : undefined) ?? null;
    const costLineId = fa?.cost_line_id ? Number(fa.cost_line_id) : line?.id ? Number(line.id) : contract?.cost_line_id ? Number(contract.cost_line_id) : null;

    const readValues: ReadValue[] = [];
    const push = (label: string, value: unknown, from: string) => {
      if (value !== null && value !== undefined && value !== "") readValues.push({ label, value: typeof value === "number" ? formatMoney(value) : String(value), from });
    };
    const s = g.statement;
    if (s) {
      push("Contract", `${s.contractNo || g.acc}${s.contractName ? ` – ${s.contractName}` : ""}`, s.name);
      push("Contractor", s.contractor, s.name);
      push("Statement date", s.statementDate ? formatDate(s.statementDate) : "", s.name);
      push("Contract completion date", s.completionDate ? formatDate(s.completionDate) : "", s.name);
      push("Revised completion date", s.revisedCompletion ? formatDate(s.revisedCompletion) : "", s.name);
      push("Contract price (A+B)", s.contractPrice, s.name);
      push("Carried from variation orders", s.vos, s.name);
      push("Carried from omissions", s.omissions, s.name);
      push("Carried from claims", s.claims, s.name);
      push("Final contract price", s.finalPrice, s.name);
      if (s.dvos.length) push("Approved variation orders", s.dvos.map((d) => `${d.ref} ${formatMoney(d.amount)}`).join("; "), s.name);
      push("Agreed for the contractor", s.signedContractor, s.name);
      push("Approved for the employer", s.signedEmployer, s.name);
    }
    const a = g.approval;
    if (a) {
      push("Workflow", `${a.mailNo}${a.sentDate ? ` – completed ${formatDate(a.sentDate)}` : ""}`, a.name);
      push("Statement document", a.docNo, a.name);
      push("Review outcome", a.accepted ? "Accepted" : a.accepted === false ? "Not accepted" : "Reviewed", a.name);
      if (a.steps.length) push("Reviewers", a.steps.map((x) => `${x.who} (${x.step}): ${x.outcome}`).join("; "), a.name);
      if (a.reviewComments.length) push("Reviewers' comments", a.reviewComments.join(" "), a.name);
    }
    const t = g.transmittal;
    if (t) push("Issued to the contractor", `${t.mailNo}${t.sentDate ? ` on ${formatDate(t.sentDate)}` : ""}${t.reason ? ` – ${t.reason}` : ""}`, t.name);
    if (contractor) readValues.push({ label: "Contractor record", value: contractor.name, from: "registers" });
    if (line) readValues.push({ label: "Cost report line", value: `${line.code} ${line.name ?? ""}`.trim(), from: "registers" });
    if (contract) readValues.push({ label: "Payment Tracking contract", value: String(contract.title ?? contract.acc_ref ?? contract.id), from: "registers" });

    // what closes the account: the statement itself, or its acceptance through the workflow
    const closes = !!s || (!!a && a.accepted !== false);
    const closedDate = (a?.accepted !== false ? a?.sentDate : "") || s?.statementDate || "";
    const statementRef = a?.docNo || s?.statementRef || t?.docNo || "";
    const finalPrice = s?.finalPrice ?? null;
    const today = formatDate(todayIso());
    const notes: string[] = [];
    if (s) notes.push(`Final account statement${s.statementDate ? ` dated ${formatDate(s.statementDate)}` : ""}: final contract price SAR ${s.finalPrice !== null ? formatMoney(s.finalPrice) : "–"}${s.contractPrice !== null ? ` (contract ${formatMoney(s.contractPrice)}${s.vos ? ` + variation orders ${formatMoney(s.vos)}` : ""}${s.omissions ? ` ${s.omissions < 0 ? "−" : "+"} omissions ${formatMoney(Math.abs(s.omissions))}` : ""}${s.claims ? ` + claims ${formatMoney(s.claims)}` : ""})` : ""}${s.signedEmployer ? `; approved for the Employer by ${s.signedEmployer}` : ""}${s.signedContractor ? `, agreed for the Contractor by ${s.signedContractor}` : ""} – from ${s.name}, ${today}.`);
    if (a) notes.push(`${a.accepted === false ? "Not accepted" : "Accepted"} in Aconex workflow ${a.mailNo}${a.sentDate ? ` on ${formatDate(a.sentDate)}` : ""}${a.steps.length ? ` (${a.steps.map((x) => `${x.who} ${x.outcome.toLowerCase()}`).join(", ")})` : ""}${a.reviewComments.length ? `. Reviewers' comments: ${a.reviewComments.join(" ")}` : ""} – from ${a.name}, ${today}.`);
    if (t) notes.push(`Final account statement issued to the contractor${t.reason ? ` ${t.reason.toLowerCase()}` : ""} – ${t.mailNo}${t.sentDate ? ` on ${formatDate(t.sentDate)}` : ""} – from ${t.name}, ${today}.`);

    const missing: string[] = [];
    if (!g.acc) missing.push("Contract code");
    if (!contractor) missing.push("Contractor record");
    if (s && s.finalPrice === null) missing.push("Final contract price");
    if (closes && !closedDate) missing.push("Signed / closed date");

    // 1. the Final Account Status row
    let faRow: RecordRow | null = fa;
    const label = `${g.acc || contractorName || "contract"}${contract?.title ? ` – ${contract.title}` : line?.name ? ` – ${line.name}` : ""}`;
    const files = g.names;
    try {
      if (fa) {
        const patch: Record<string, unknown> = {};
        if (closes && fa.status !== "Closed") patch.status = "Closed";
        if (closes && closedDate && (!fa.closed_date || String(fa.closed_date) < closedDate)) patch.closed_date = closedDate;
        if (statementRef && String(fa.fa_statement_ref ?? "") !== statementRef) patch.fa_statement_ref = statementRef;
        if (finalPrice !== null && Number(fa.final_contract_price ?? 0) !== finalPrice) patch.final_contract_price = finalPrice;
        if (!fa.contractor_id && contractor) patch.contractor_id = contractor.id;
        if (!fa.contract_id && contract) patch.contract_id = contract.id;
        if (!fa.cost_line_id && costLineId) patch.cost_line_id = costLineId;
        const existingNotes = String(fa.comments ?? "").trim();
        const fresh = notes.filter((n) => !existingNotes.includes(n.replace(/ – from .*$/, "")));
        if (fresh.length) patch.comments = [existingNotes, ...fresh].filter(Boolean).join("\n");
        if (Object.keys(patch).length) faRow = updateRecord(faDef, Number(fa.id), patch, user, "import", { bypassRoles: true });
        result.entries.push({ action: Object.keys(patch).length ? "updated" : "kept", id: Number(fa.id), label: `Final account ${fa.acc_ref}`, description: `${label}: ${closes ? `closed${closedDate ? ` ${formatDate(closedDate)}` : ""}` : "noted"}${finalPrice !== null ? `, final contract price ${formatMoney(finalPrice)}` : ""}`, programme: p.name, files, read: readValues, missing });
      } else if (costLineId) {
        const record: Record<string, unknown> = {
          programme_id: p.id,
          acc_ref: line?.code ? String(line.code) : `CN.${g.acc}`,
          description: s?.contractName || contract?.title || line?.name || contractorName || g.acc,
          contractor_id: contractor?.id ?? null,
          type: "Contractor",
          cost_line_id: costLineId,
          contract_id: contract?.id ?? null,
          status: closes ? "Closed" : "Open",
          closed_date: closes ? closedDate || null : null,
          fa_statement_ref: statementRef || null,
          final_contract_price: finalPrice,
          comments: [`Added from ${files.join(", ")} on ${today}.`, ...notes].join("\n"),
        };
        faRow = createRecord(faDef, record, user, "import", { bypassRoles: true });
        result.entries.push({ action: "created", id: Number(faRow.id), label: `Final account ${record.acc_ref}`, description: `${label}: ${closes ? `closed${closedDate ? ` ${formatDate(closedDate)}` : ""}` : "open"}${finalPrice !== null ? `, final contract price ${formatMoney(finalPrice)}` : ""}`, programme: p.name, files, read: readValues, missing });
      } else {
        result.warnings.push(`${files.join(", ")}: no Final Account Status row or cost report line was found for ${g.acc || contractorName || "this contract"} – add the row by hand, then upload the documents again.`);
      }
    } catch (e) {
      result.warnings.push(`${files.join(", ")}: the Final Account Status could not be updated (${e instanceof Error ? e.message.slice(0, 160) : String(e)}).`);
    }

    // 2. Payment Tracking: the contract closes, and the final account adjustment brings its revised value to the agreed figure
    if (contract && closes) {
      try {
        const comp = computeContracts(db, p.id).contracts.get(Number(contract.id));
        const patch: Record<string, unknown> = {};
        if (contract.current_status !== "Closed") patch.current_status = "Closed";
        let original = Number(contract.original_contract ?? 0);
        if (!original && s?.contractPrice) {
          original = s.contractPrice;
          patch.original_contract = original;
        }
        if (finalPrice !== null && comp) {
          const adjustment = Math.round((finalPrice - original - comp.approved_vos - comp.approved_claims) * 100) / 100;
          if (Math.abs(adjustment - Number(contract.final_account_adjustment ?? 0)) > 0.005) patch.final_account_adjustment = adjustment;
          readValues.push({ label: "Final account adjustment", value: `${formatMoney(adjustment)} (final ${formatMoney(finalPrice)} − original ${formatMoney(original)} − approved VOs ${formatMoney(comp.approved_vos)} − approved claims ${formatMoney(comp.approved_claims)})`, from: "registers" });
        }
        if (!contract.original_completion_date && s?.completionDate) patch.original_completion_date = s.completionDate;
        const existingNotes = String(contract.notes ?? "").trim();
        const line1 = `Final account ${closedDate ? `closed ${formatDate(closedDate)}` : "closed"}${finalPrice !== null ? ` at SAR ${formatMoney(finalPrice)}` : ""}${statementRef ? ` (${statementRef})` : ""} – from ${files.join(", ")}, ${today}.`;
        if (!existingNotes.includes(line1.replace(/ – from .*$/, ""))) patch.notes = [existingNotes, line1].filter(Boolean).join("\n");
        if (Object.keys(patch).length) {
          updateRecord(ctDef, Number(contract.id), patch, user, "import", { bypassRoles: true });
          result.entries.push({ action: "updated", id: Number(contract.id), label: `Contract ${contract.title ?? contract.acc_ref}`, description: `Payment Tracking: closed${patch.final_account_adjustment !== undefined ? `, final account adjustment ${formatMoney(Number(patch.final_account_adjustment))} so the revised contract value is ${formatMoney(finalPrice!)}` : ""}`, programme: p.name, files, read: [], missing: [] });
        }
      } catch (e) {
        result.warnings.push(`${files.join(", ")}: Payment Tracking could not be updated (${e instanceof Error ? e.message.slice(0, 160) : String(e)}).`);
      }
    }

    // 3. every document into the Contract Library under the contract
    for (const r of [s, a, t].filter((x): x is FaRead => !!x)) {
      const bytes = filesBytes(r.name);
      if (!bytes) continue;
      const kindLabel = r.kind === "statement" ? "Final Account Statement" : "Final Account Correspondence";
      const reading: Reading = {
        contractor_id: contractor?.id ?? null,
        contract_id: contract ? Number(contract.id) : null,
        contract_code: g.acc || null,
        po_no: contract?.reef_po_no ? String(contract.reef_po_no) : null,
        doc_type: kindLabel,
        title: r.kind === "statement" ? `Final Account Statement – ${r.contractName || label}` : r.kind === "approval" ? `Final account statement approval ${r.mailNo} – ${label}` : `Final account statement issued to the contractor ${r.mailNo} – ${label}`,
        reference: r.kind === "statement" ? r.statementRef || r.contractNo : r.mailNo,
        doc_date: (r.kind === "statement" ? r.statementDate : r.sentDate) || null,
        claim_ref: "",
        eot_days_claimed: null,
        eot_days_assessed: null,
        cost_claimed: null,
        cost_assessed: r.kind === "statement" ? r.finalPrice : null,
        summary: r.note + (faRow ? ` (Final Account Status row #${faRow.id})` : ""),
        key_points: r.kind === "statement" ? r.dvos.map((d) => `${d.ref}: ${d.title} – SAR ${formatMoney(d.amount)}`) : r.kind === "approval" ? [...r.steps.map((x) => `${x.step} ${x.who}: ${x.outcome}`), ...r.reviewComments] : [],
        matched_by: "final account documents",
        confidence: contractor && g.acc ? "High" : "Low",
        read_status: "Read",
      };
      try {
        const doc = addDoc(p.id, "contract", { name: r.name, relPath: `Final accounts/${g.acc || "unmatched"}/${r.name}`, bytes, mime: "application/pdf" }, { kind: "pdf", text: r.text.slice(0, 600_000), note: null }, reading, user);
        if (faRow && r.kind === "statement") faRow = updateRecord(faDef, Number(faRow.id), { library_doc_id: doc.id }, user, "import", { bypassRoles: true });
      } catch (e) {
        result.warnings.push(`${r.name}: read, but could not be kept in the Contract Library (${e instanceof Error ? e.message.slice(0, 120) : String(e)}).`);
      }
    }
  }
  return result;

  function filesBytes(name: string): Buffer | null {
    return files.find((x) => x.name === name)?.bytes ?? null;
  }
}
