import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { createRecord, updateRecord } from "../registers/engine";
import type { RecordRow, UserInfo } from "../registers/types";
import { positioned } from "../packs/extract";
import type { PosPage } from "../packs/positioned";
import { convertToPdf, convertible } from "../packs/convert";
import { matchAgainstRegisters } from "../library/read";
import { getAppContext } from "../context";
import { formatDate, formatMoney, todayIso } from "../format";
import type { Decisions, Duplicate, FromDocsResult, Outcome, ReadValue } from "../from-docs-shared";

/**
 * The payment tracker from its own documents: the contractor's transmittal of an Interim Payment
 * Application, the Employer's Interim Payment Certificate letter (its own PDF or the Aconex mail that
 * carried it) and the payment certificate pack behind it. Each application of a contract is one row
 * of the IPC log: the transmittal fills the application side, the letter and the certificate the
 * certified side. A row already holding a different value for something the documents give is a
 * duplicate: nothing is written until the person says replace or keep. Payments are standalone –
 * written whatever reporting period is open or selected.
 */

export interface DocFile {
  name: string;
  bytes: Buffer;
}
interface DocRead {
  name: string;
  kind: "ipa" | "ipc" | "certificate" | "unknown";
  text: string;
  programmeCode: string;
  acc: string;
  accCandidates: string[];
  contractLine: string;
  mailNo: string;
  no: number | null;
  month: string;
  sentDate: string;
  letterDate: string;
  submittedOn: string;
  applicationRef: string;
  netCertified: number | null;
  amountDue: number | null;
  workDoneToDate: number | null;
  recommendationDate: string;
  /** the pack's Payment Certificate History table: every certificate issued so far */
  history: HistoryRow[];
  note: string;
}
interface HistoryRow {
  no: number;
  date: string;
  month: string;
  gross: number;
  net: number;
  cumulativeNet: number;
  /** running total of the gross amounts up to this certificate */
  cumulativeGross: number;
}
/**
 * "IPC 20 | Interim Payment Certificate 20 | 01-Sep-26 | September-26 | 25,000.00 | 0.00 | 0.00 | 0.00 | 0.00 | 25,000.00 | 83,063,340.06":
 * number, certificate date, valuation month, then gross, deductions, net under this certificate and the cumulative net.
 */
function readHistory(text: string): HistoryRow[] {
  const out: HistoryRow[] = [];
  const seen = new Set<number>();
  let running = 0;
  let runningNet = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:IPC|PC|IPA)[\s-]*(?:No\.?\s*)?0*(\d{1,3})\b(.*)$/i);
    if (!m) continue;
    const rest = m[2];
    const d = rest.match(/\b(\d{1,2}-[A-Za-z]{3}-\d{2,4})\b/);
    if (!d) continue;
    const money = [...rest.slice(rest.indexOf(d[1]) + d[1].length).matchAll(/\(?-?[\d,]+\.\d{2}\)?/g)].map((x) => (x[0].startsWith("(") ? -1 : 1) * num(x[0]));
    if (money.length < 3) continue;
    const no = Number(m[1]);
    if (seen.has(no)) continue;
    seen.add(no);
    const gross = money[0];
    const net = money[money.length - 2];
    running = Math.round((running + gross) * 100) / 100;
    runningNet = Math.round((runningNet + net) * 100) / 100;
    out.push({ no, date: dateOf(d[1]), month: monthLabel(rest.slice(rest.indexOf(d[1]) + d[1].length).match(/\b([A-Za-z]{3,9}-\d{2,4})\b/)?.[1] ?? ""), gross, net, cumulativeNet: runningNet, cumulativeGross: running });
  }
  return out;
}

const textOf = (pages: PosPage[]) => pages.map((p) => p.rows.map((r) => r.cells.map((c) => c.s).join(" ")).join("\n")).join("\n");
/** the text as the letter reads: ligature gaps closed ("Certi fi cate"), digits split by the layout re-joined ("(No. 0 1 9 )") */
const tidy = (t: string) =>
  t
    .replace(/\b([A-Za-z]+) (fi|fl|ff) ([a-z]+)\b/g, "$1$2$3")
    .replace(/\(No\.\s*((?:\d ?){1,4})\s*\)/g, (_, d: string) => `(No. ${d.replace(/\s/g, "")})`)
    .replace(/\b(\d) (\d) (\d)\b/g, "$1$2$3")
    .replace(/\b(20\d) (\d)\b/g, "$1$2")
    .replace(/\+9 66/g, "+966")
    .replace(/Octo ber/g, "October")
    .replace(/MAIL TYPE MAIL NUMBER REFERENCE NUMBER\n(Transmittal|Letter|Mail|General Correspondence|Correspondence)\s+(\S+)\s+(\S+)/g, "MAIL TYPE\n$1\nMAIL NUMBER\n$2\nREFERENCE NUMBER\n$3");
const num = (s: string) => Number(String(s).replace(/[^\d.-]/g, ""));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (s: string) => MONTHS.indexOf(s.toLowerCase().slice(0, 3));
/** "16 August 2026", "Monday, September 28, 2026", "25-Jun-26", "16/09/2026" → ISO */
function dateOf(s: string): string {
  const a = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[\s\-,]+(\d{4}|\d{2})\b/);
  if (a && monthIndex(a[2]) >= 0) return `${a[3].length === 2 ? `20${a[3]}` : a[3]}-${String(monthIndex(a[2]) + 1).padStart(2, "0")}-${a[1].padStart(2, "0")}`;
  const b = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (b && monthIndex(b[1]) >= 0) return `${b[3]}-${String(monthIndex(b[1]) + 1).padStart(2, "0")}-${b[2].padStart(2, "0")}`;
  const c = s.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/);
  if (c) return `${c[3]}-${c[2].padStart(2, "0")}-${c[1].padStart(2, "0")}`;
  const d = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return d ? d[0] : "";
}
/** "Aug'26" from "Month of August 2026", "June 2026", "Jun-26", a date */
function monthLabel(s: string): string {
  const m = s.match(/\b([A-Za-z]{3,9})[\s\-',.]+(\d{4}|\d{2})\b/);
  if (m && monthIndex(m[1]) >= 0) return `${m[1].slice(0, 3).replace(/^./, (c) => c.toUpperCase())}'${m[2].slice(-2)}`;
  const iso = dateOf(s);
  if (iso) return `${MONTHS[Number(iso.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())}'${iso.slice(2, 4)}`;
  return "";
}
const sar = (s: string | undefined) => {
  const m = String(s ?? "").match(/SAR\s*([\d,]+(?:\.\d{2})?)/i);
  return m ? num(m[1]) : null;
};

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
  const text = tidy(textOf(pages));
  const head = text.slice(0, 12_000);
  const programmeCode = `${f.name}\n${text}`.match(/\b(1TB\d{5})\b/)?.[1] ?? "";
  const contractLine = text.match(/\bContract\s*:?\s*\n?\s*(\d{3}[A-Z]\d{2}\s+[^\n]+)/)?.[1]?.trim() ?? "";
  // the contract code, best source first: the Employer's letter reference (1TB01031-031D06-AMA-LTR-0006), the
  // "Contract No" the pack states, the file name, then anything in the text – a pack copied from another
  // contract's template can carry the wrong "Contract No", so every candidate is kept and the first one
  // the Contracts register knows is used
  const accCandidates = [...new Set([text.match(/(?:Letter Ref|Our Ref|MAIL NUMBER)\.?:?\s*\n?\s*1TB\d{5}-(\d{3}[A-Z]\d{2})-/i)?.[1], contractLine.match(/^(\d{3}[A-Z]\d{2})/)?.[1], text.match(/Contract (?:No|Ref)\.?:?\s*\n?\s*(?:1?TB0?1?-?)?(\d{3}[A-Z]\d{2})\b/i)?.[1], f.name.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1], text.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1]].filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const acc = accCandidates[0] ?? "";
  const mailNo = text.match(/MAIL NUMBER\s*\n?\s*([A-Z]{2,8}(?:\d{5})?-[A-Z]{2,10}-\d{6}|1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4}[A-Z0-9]*)/)?.[1] ?? text.match(/(?:Our Ref|Letter Ref)\.?:?\s*\n?\s*(1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4})/)?.[1] ?? f.name.match(/\b([A-Z]{2,8}(?:\d{5})?-[A-Z]{2,10}-\d{6}|1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4})/)?.[1] ?? "";
  const subject = head.match(/^(?:Re:\s*|Subject:\s*)?((?:[^\n]*(?:Interim Payment|IPA|IPC|Payment Application|Payment Certificate)[^\n]*)(?:\n[^\n]{0,80}(?:\d{4}\)?|\d{3}\)?))?)/im)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const sentDate = dateOf(head.match(/\bSent\s*\n?\s*([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4})/)?.[1] ?? "");
  const letterDate = dateOf(head.match(/\bDate:?\s*\n?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/)?.[1] ?? "") || dateOf(head.match(/\n(\d{1,2} [A-Za-z]{3,9} \d{4})\s*\n/)?.[1] ?? "");
  const isIpc = /Interim Payment Certificate|Proposes to pay the Contractor|Payment Certificate No\.?\s*\d/i.test(head) && /Proposes to pay|Employer hereby notifies/i.test(text);
  const isCert = /PAYMENT CERTIFICATE NO\.|Recommendation No\.|CERTIFICATE SUMMARY|Amount due for this Recommendation/i.test(text) && !isIpc;
  // the contractor's Aconex mail carrying the application: a transmittal, a general correspondence or a letter
  const isMail = /MAIL TYPE/i.test(head.slice(0, 1500)) && /\b(?:Transmittal|General Correspondence|Letter|Correspondence)\b/i.test(head.slice(0, 1500));
  const isIpa = isMail && /Interim Payment Application|\bIPA\b|Payment Application|Payment Certificate Submission/i.test(subject);
  const kind: DocRead["kind"] = isIpc ? "ipc" : isCert ? "certificate" : isIpa ? "ipa" : "unknown";
  const noFrom = (s: string) => {
    const m = s.match(/(?:Certificate|Application|IPA|IPC|Recommendation)\s*(?:No\.?|Number|#|-)?\s*\(?(?:No\.?\s*)?0*(\d{1,3})\b/i) ?? s.match(/\bIPA[\s-]*0*(\d{1,3})\b/i) ?? s.match(/\bIPC[\s-]*0*(\d{1,3})\b/i);
    return m ? Number(m[1]) : null;
  };
  let no = noFrom(subject) ?? noFrom(f.name.replace(/[_]+/g, " "));
  if (no === null && kind === "certificate") no = noFrom(text.match(/PAYMENT CERTIFICATE NO\.?\s*\d+/i)?.[0] ?? "") ?? (Number(text.match(/Recommendation No\.\s*\n?\s*(\d{1,3})\b/)?.[1] ?? NaN) || null) ?? noFrom(text.match(/\bIPA[\s_-]*0*\d{1,3}\b/i)?.[0] ?? "");
  if (no === null && kind === "ipc") no = noFrom(text.match(/Interim Payment Certificate\s*\(?No\.?\s*\d+/i)?.[0] ?? "");
  const upTo = text.match(/completed works up to\s*\n?\s*(\d{1,2} [A-Za-z]+ \d{4})/i)?.[1] ?? "";
  const month = monthLabel(subject.match(/(?:Month of|for month of|for the month of)\s*([A-Za-z]+\.?\s*\d{4})/i)?.[1] ?? "") || monthLabel(subject.match(/-\s*([A-Za-z]+ \d{4})\s*$/)?.[1] ?? "") || monthLabel(upTo) || monthLabel(text.match(/Valuation Month\s*\n?\s*(?:\d{1,2}[-\s])?([A-Za-z]{3,9}[-\s]\d{2,4})/i)?.[1] ?? "") || monthLabel(text.match(/Work Completed at:?\s*\n?\s*\d{1,2}[-\s]([A-Za-z]{3,9}[-\s]\d{2,4})/i)?.[1] ?? "");
  const submittedOn = dateOf(text.match(/submitted on\s*\n?\s*(\d{1,2} [A-Za-z]+(?: [A-Za-z]+)? \d{4})/i)?.[1] ?? "");
  const applicationRef = text.match(/(?:under Aconex mail reference|Your Ref:?|REFERENCE NUMBER)\s*\n?\s*([A-Z]{2,8}(?:\d{5})?-[A-Z]{2,10}-\s*\n?\s*\d{6})/i)?.[1]?.replace(/\s+/g, "") ?? "";
  const proposes = text.match(/Proposes to pay the Contractor\s*SAR\s*[\d,]+(?:\.\d{2})?(\s*Incl\.?\s*(?:WHT|VAT))?/i);
  // the pack's "Amount due for this Recommendation" line before tax (the one marked INCL. WHT/VAT is after it)
  const amountDue = (() => {
    for (const line of text.split("\n")) {
      if (!/Amount due for this (?:Recommendation|Certificate|Application)/i.test(line) || /INCL/i.test(line)) continue;
      const m = line.match(/([\d,]+\.\d{2})\s*$/);
      if (m) return num(m[1]);
    }
    return null;
  })();
  // the letter's figure is net of this certificate; when it says "Incl. WHT/VAT" the pack's pre-tax amount is the net
  const netCertified = proposes ? (proposes[1] && amountDue !== null ? amountDue : sar(proposes[0])) : null;
  // the certificate pack: its rows run Contract price | Previous | Current | To date; the "Total Work Done"
  // row is the largest one where previous + current = to date (the grand total after retention is smaller)
  const workDoneToDate = (() => {
    const money = (t: string) => [...t.matchAll(/\(?-?[\d,]{4,}\.\d{2}\)?/g)].map((m) => (m[0].startsWith("(") ? -1 : 1) * num(m[0]));
    // the "Total Work Done" row itself when the pack has one: contract price | previous | current | to date
    for (const line of text.split("\n")) {
      if (!/^\s*Total Work Done\b/i.test(line)) continue;
      const nums = money(line);
      if (nums.length >= 3) return nums[nums.length - 1];
    }
    let best: number | null = null;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // a row may be split over lines by the layout: look at this line and the next three together
      const nums = money(lines.slice(i, i + 4).join(" ")).slice(0, 4);
      if (nums.length < 4) continue;
      const [, prev, cur, toDate] = nums;
      if (prev <= 0 || toDate <= 0 || Math.abs(prev + cur - toDate) > 1) continue;
      if (best === null || toDate > best) best = toDate;
    }
    return best;
  })();
  const recommendationDate = dateOf(text.match(/Recommendation Date\s*\n?\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i)?.[1] ?? "") || dateOf(text.match(/Payment Certificate Date:?\s*\n?\s*(\d{1,2}[-\/][A-Za-z0-9]{2,3}[-\/]\d{2,4})/i)?.[1] ?? "");
  const label = kind === "ipa" ? "payment application (transmittal)" : kind === "ipc" ? "Interim Payment Certificate letter" : kind === "certificate" ? "payment certificate pack" : "";
  const note = kind === "unknown" ? "not recognised as a payment application, certificate letter or payment certificate – kept out" : `${label}${no ? ` No ${String(no).padStart(3, "0")}` : ""}${month ? ` – ${month}` : ""}${netCertified ? ` – SAR ${formatMoney(netCertified)}` : amountDue ? ` – SAR ${formatMoney(amountDue)}` : ""}`;
  const history = kind === "unknown" ? [] : readHistory(text);
  // the pack's own history ends with this certificate: its number is the one (a subject like "Final Payment
  // Application" carries none, and boilerplate can quote another certificate's number)
  const last = history[history.length - 1];
  if (last && (kind === "ipc" || kind === "certificate") && (no === null || no !== last.no) && [netCertified, amountDue].some((v) => v !== null && Math.abs(v - last.net) < 0.5)) no = last.no;
  return { name: f.name, kind, text, programmeCode, acc, accCandidates, contractLine, mailNo, no, month, sentDate, letterDate, submittedOn, applicationRef, netCertified, amountDue, workDoneToDate, recommendationDate, history, note: history.length ? `${note} – history of ${history.length} certificates` : note };
}

interface Plan {
  key: string;
  docs: DocRead[];
  programme: { id: number; code: string; name: string };
  contract: { id: number; title: string; acc_ref: string; contractor: string; retention_pct: number | null; advance_recovery_pct: number | null };
  existing: RecordRow | null;
  record: Record<string, unknown>;
  patch: Record<string, unknown>;
  conflicts: { label: string; old: string; new: string }[];
  read: ReadValue[];
  missing: string[];
  label: string;
  /** earlier certificates from the pack's history table: rows to add or whose blanks to fill */
  history: { no: number; key: string; existing: RecordRow | null; record: Record<string, unknown>; patch: Record<string, unknown>; conflicts: Plan["conflicts"] }[];
}

export async function addPaymentsFromDocuments(files: DocFile[], user: UserInfo, decisions: Decisions = {}): Promise<FromDocsResult> {
  const db = getDb();
  const def = getRegisterDef("payment_applications")!;
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
  const programmes = db.prepare("SELECT id, code, name FROM programmes").all() as { id: number; code: string; name: string }[];
  type Contract = Plan["contract"] & { programme_id: number };
  const contractOf = (d: DocRead, programmeId: number): Contract | null => {
    const all = db.prepare("SELECT c.id, c.title, COALESCE(c.acc_ref,'') AS acc_ref, c.programme_id, c.retention_pct, c.advance_recovery_pct, COALESCE((SELECT name FROM contractors WHERE id = c.contractor_id),'') AS contractor FROM contracts c WHERE c.programme_id = ?").all(programmeId) as Contract[];
    for (const acc of d.accCandidates) {
      const byAcc = all.find((c) => c.acc_ref.toUpperCase().includes(acc)) ?? all.find((c) => ((db.prepare("SELECT code FROM cost_lines WHERE id = (SELECT cost_line_id FROM contracts WHERE id = ?)").get(c.id) as { code: string } | undefined)?.code ?? "").toUpperCase().includes(acc));
      if (byAcc) return byAcc;
    }
    const m = matchAgainstRegisters(db, programmeId, `${d.contractLine}\n${d.text.slice(0, 20_000)}`, d.name, { code: d.acc });
    return m.contract_id ? (all.find((c) => c.id === m.contract_id) ?? null) : null;
  };

  // one row per contract and application number (the month when no number is known)
  const groups = new Map<string, { docs: DocRead[]; programme: (typeof programmes)[number]; contract: Contract }>();
  const programmeByAcc = (acc: string) => {
    if (!acc) return null;
    const hit = db.prepare("SELECT programme_id FROM contracts WHERE UPPER(COALESCE(acc_ref,'')) LIKE ? UNION SELECT programme_id FROM cost_lines WHERE UPPER(code) LIKE ? LIMIT 1").get(`%${acc}%`, `%${acc}%`) as { programme_id: number } | undefined;
    return hit ? programmes.find((p) => p.id === hit.programme_id) ?? null : null;
  };
  // a document naming no project: the project whose registers know its contractor
  const programmeByContractor = (d: DocRead) => {
    for (const p of programmes) {
      const m = matchAgainstRegisters(db, p.id, `${d.contractLine}\n${d.text.slice(0, 20_000)}`, d.name, { code: d.acc });
      if (m.contract_id && (m.confidence === "High" || m.confidence === "Medium")) return p;
    }
    return null;
  };
  for (const d of reads) {
    const programme = programmes.find((p) => p.code === d.programmeCode) ?? d.accCandidates.map(programmeByAcc).find(Boolean) ?? programmeByContractor(d) ?? app.programme;
    if (!programme) {
      result.warnings.push(`${d.name}: no project could be told from the document and none is selected in the top bar.`);
      continue;
    }
    const contract = contractOf(d, programme.id);
    if (!contract) {
      result.warnings.push(`${d.name}: the contract (${d.acc || d.contractLine || "not named"}) is not in the Contracts register of ${programme.name} – add it under Invoices & Payments first.`);
      continue;
    }
    // a letter names the application it answers: join them by that reference too
    const twin = [...groups.entries()].find(([, g]) => g.contract.id === contract.id && g.docs.some((x) => (d.applicationRef && x.mailNo === d.applicationRef) || (x.applicationRef && x.applicationRef === d.mailNo) || (d.no !== null && x.no === d.no) || (d.month && x.month === d.month && (d.no === null || x.no === null || x.no === d.no))));
    const key = twin?.[0] ?? `pay:${programme.id}:${contract.id}:${d.no ?? d.month ?? d.name}`;
    const g = groups.get(key) ?? { docs: [], programme, contract };
    g.docs.push(d);
    groups.set(key, g);
  }

  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "number" ? formatMoney(v) : String(v));
  const plans: Plan[] = [];
  for (const [key, g] of groups) {
    // the letter that carries the certificate pack (its own PDF) over the bare Aconex mail print
    const fullest = (kind: DocRead["kind"]) => g.docs.filter((d) => d.kind === kind).sort((a, b) => Number(Boolean(b.workDoneToDate)) - Number(Boolean(a.workDoneToDate)))[0];
    const ipa = fullest("ipa");
    const ipc = fullest("ipc");
    const cert = fullest("certificate");
    const no = ipa?.no ?? ipc?.no ?? cert?.no ?? null;
    const month = ipa?.month || ipc?.month || cert?.month || g.docs.map((d) => d.month).find(Boolean) || "";
    const rows = db.prepare("SELECT * FROM payment_applications WHERE contract_id = ? ORDER BY sr_no, id").all(g.contract.id) as RecordRow[];
    const lastNo = (s: unknown) => Number(String(s ?? "").match(/(\d+)(?!.*\d)/)?.[1] ?? NaN);
    const existing = rows.find((r) => no !== null && (lastNo(r.application_no) === no || lastNo(r.ipc_no) === no)) ?? rows.find((r) => ipa?.mailNo && String(r.application_aconex_ref ?? "").replace(/\s+/g, "") === ipa.mailNo) ?? rows.find((r) => month && String(r.month ?? "") === month) ?? null;
    const prev = rows.filter((r) => no !== null && (lastNo(r.application_no) < no || lastNo(r.ipc_no) < no)).sort((a, b) => lastNo(b.application_no) - lastNo(a.application_no))[0] ?? (existing ? null : rows[rows.length - 1]) ?? null;
    // the number written the way this contract's log writes it: the last row that has one
    const sample = { application_no: rows.filter((r) => r.application_no).at(-1)?.application_no, ipc_no: rows.filter((r) => r.ipc_no).at(-1)?.ipc_no };
    const numberedAs = (pattern: unknown, n: number, fallback: string) => {
      const p = String(pattern ?? "");
      return p && /\d/.test(p) ? p.replace(/(\d+)(?!.*\d)/, (m) => String(n).padStart(m.length, "0")) : fallback;
    };
    const numbered = (pattern: unknown, fallback: string) => (no === null ? String(pattern ?? "") || fallback : numberedAs(pattern, no, fallback));
    const read: ReadValue[] = [];
    const push = (label: string, value: string | number | null | undefined, from: string) => {
      if (value !== null && value !== undefined && value !== "") read.push({ label, value: String(value), from });
    };
    push("Contract", `${g.contract.title} (${g.contract.acc_ref || "–"}) – ${g.contract.contractor}`, "registers");
    const record: Record<string, unknown> = { programme_id: g.programme.id, contract_id: g.contract.id };
    // Two entries per application, as the IPC log reads: the contractor's transmittal and the pack behind it
    // fill the application (green) columns; the Employer's Interim Payment Certificate letter – with the
    // certificate pack it carries – fills the certified (orange) columns. The payment issued is the
    // certificate's net, so the payment columns follow the certified ones on their own.
    const claimFrom = ipa ?? cert ?? null;
    if (no !== null) {
      record.sr_no = no;
      record.application_no = numbered(sample?.application_no, `IPA - ${String(no).padStart(2, "0")}`);
      if (ipc) record.ipc_no = numbered(sample?.ipc_no, String(no));
      push("Application no", String(record.application_no), claimFrom?.name ?? ipc!.name);
    }
    if (month) {
      record.month = month;
      push("Month", month, claimFrom?.name ?? ipc!.name);
    }
    if (ipa) {
      record.application_aconex_ref = ipa.mailNo;
      record.application_date = ipa.sentDate;
      push("Application Aconex ref", ipa.mailNo, ipa.name);
      push("Application date", ipa.sentDate, ipa.name);
    } else if (cert?.recommendationDate && !existing?.application_date) {
      record.application_date = cert.recommendationDate;
      push("Application date (certificate date in the pack)", cert.recommendationDate, cert.name);
    } else if (!claimFrom && ipc?.applicationRef) {
      record.application_aconex_ref = ipc.applicationRef;
      if (ipc.submittedOn) record.application_date = ipc.submittedOn;
      push("Application Aconex ref", ipc.applicationRef, ipc.name);
      push("Application date (submitted on)", ipc.submittedOn, ipc.name);
    }
    const claimedToDate = cert?.workDoneToDate ?? (claimFrom ? null : ipc?.workDoneToDate ?? null);
    if (claimedToDate) {
      record.cumulative_claimed = claimedToDate;
      push("Cumulative work done (claimed)", claimedToDate, cert?.name ?? ipc!.name);
      if (cert?.amountDue) push("Amount due this application (SAR)", cert.amountDue, cert.name);
    }
    const adv = Number(g.contract.advance_recovery_pct ?? 0) / 100;
    const ret = Number(g.contract.retention_pct ?? 0) / 100;
    if (ipc) {
      record.ipc_aconex_ref = ipc.mailNo;
      record.ipc_date = ipc.sentDate || ipc.letterDate;
      push("IPC Aconex ref", ipc.mailNo, ipc.name);
      push("IPC date", String(record.ipc_date ?? ""), ipc.name);
      push("Net certified this IPC (SAR, excl. VAT)", ipc.netCertified, ipc.name);
      if (ipc.workDoneToDate) {
        record.cumulative_certified = ipc.workDoneToDate;
        push("Cumulative work done (certified)", ipc.workDoneToDate, ipc.name);
      } else if (ipc.netCertified !== null) {
        // the letter alone gives the net for this IPC: the gross behind it is carried on the previous cumulative
        const prevCum = Number(prev?.cumulative_certified ?? 0) || Number(prev?.cumulative_claimed ?? 0) || 0;
        const factor = 1 - adv - ret;
        const gross = factor > 0 ? Math.round((ipc.netCertified / factor) * 100) / 100 : ipc.netCertified;
        if (!existing?.cumulative_certified) {
          record.cumulative_certified = Math.round((prevCum + gross) * 100) / 100;
          push("Cumulative certified (previous + this IPC's gross)", record.cumulative_certified as number, ipc.name);
        }
      }
    }
    if (!record.cumulative_claimed && record.cumulative_certified && !existing?.cumulative_claimed) record.cumulative_claimed = record.cumulative_certified;
    const stamp = `Added from documents on ${formatDate(todayIso())} (${g.docs.map((d) => d.name).join("; ")})${ipc?.netCertified ? ` – IPC net SAR ${formatMoney(ipc.netCertified)} excl. VAT` : ""}${cert?.amountDue ? ` – amount due SAR ${formatMoney(cert.amountDue)}` : ""}`;
    if (!existing && !record.application_date && (ipc?.submittedOn || cert?.recommendationDate || ipc?.letterDate)) record.application_date = ipc?.submittedOn || cert?.recommendationDate || ipc?.letterDate;
    const missing: string[] = [];
    if (no === null) missing.push("Application / IPC number");
    if (!record.application_date && !existing?.application_date) missing.push("Application date");
    if (!record.cumulative_claimed && !existing?.cumulative_claimed) missing.push("Cumulative claimed");
    if (ipc && !record.cumulative_certified && !existing?.cumulative_certified) missing.push("Cumulative certified");
    // a row already there: fill its blanks; a filled field that differs is a conflict to decide
    const patch: Record<string, unknown> = {};
    const conflicts: Plan["conflicts"] = [];
    if (existing) {
      for (const [k, v] of Object.entries(record)) {
        if (k === "programme_id" || k === "contract_id" || v === null || v === undefined || v === "") continue;
        const old = existing[k];
        if (old === null || old === undefined || old === "") patch[k] = v;
        else if (show(old) !== show(v) && !(typeof v === "number" && Math.abs(Number(old) - v) < 0.5)) {
          conflicts.push({ label: def.fields.find((f) => f.key === k)?.label ?? k, old: show(old), new: show(v) });
          patch[k] = v;
        }
      }
      patch.comments = [String(existing.comments ?? "").trim(), stamp].filter(Boolean).join("\n");
    } else {
      if (!record.application_no) record.application_no = month ? `IPA – ${month}` : `IPA – ${g.docs[0].name.replace(/\.[a-z0-9]+$/i, "")}`;
      if (!record.application_date) record.application_date = ipc?.submittedOn || cert?.recommendationDate || ipc?.letterDate || todayIso();
      record.comments = [stamp, missing.length ? `Not found in the documents – to be added by hand: ${missing.join(", ")}.` : ""].filter(Boolean).join("\n");
    }
    // the certificate history in the pack: every earlier IPC not yet in the log is added, and the blanks
    // of those already there are filled – nothing already recorded is changed
    // (a contract with no retention or advance: the cumulative net of the table is the cumulative certified;
    // otherwise the running total of the gross amounts is)
    const history: Plan["history"] = [];
    const table = (ipc ?? cert)?.history ?? [];
    for (const h of table) {
      if (no !== null && h.no >= no) continue;
      const row = rows.find((r) => lastNo(r.application_no) === h.no || lastNo(r.ipc_no) === h.no) ?? null;
      const cumulative = adv + ret > 0 ? h.cumulativeGross : h.cumulativeNet;
      const want: Record<string, unknown> = { month: h.month || null, ipc_date: h.date || null, cumulative_certified: cumulative, ipc_no: numberedAs(sample?.ipc_no, h.no, String(h.no)) };
      const hkey = `${key}:ipc:${h.no}`;
      if (row) {
        const fill: Record<string, unknown> = {};
        const conflicts: Plan["conflicts"] = [];
        for (const [k, v] of Object.entries(want)) {
          if (v === null || v === "") continue;
          const old = row[k];
          if (old === null || old === undefined || old === "") fill[k] = v;
          // every earlier certificate is checked against the pack: a cumulative figure that differs is put to the
          // person (replace or keep); dates and months in the log are the Aconex letter's and only have blanks filled
          else if (k === "cumulative_certified" && typeof v === "number" && Math.abs(Number(old) - v) >= 0.5) {
            conflicts.push({ label: def.fields.find((f) => f.key === k)?.label ?? k, old: show(old), new: show(v) });
            fill[k] = v;
          }
        }
        if (Object.keys(fill).length) history.push({ no: h.no, key: hkey, existing: row, record: {}, patch: fill, conflicts });
      } else {
        history.push({ no: h.no, key: hkey, existing: null, record: { programme_id: g.programme.id, contract_id: g.contract.id, sr_no: h.no, application_no: numberedAs(sample?.application_no, h.no, `IPA - ${String(h.no).padStart(2, "0")}`), application_date: h.date, cumulative_claimed: cumulative, ...want, comments: `Added from the certificate history in ${(ipc ?? cert)!.name} on ${formatDate(todayIso())} – application date and Aconex references to be added by hand.` }, patch: {}, conflicts: [] });
      }
    }
    if (table.length) {
      const matched = table.filter((h) => (no === null || h.no < no) && rows.some((r) => (lastNo(r.application_no) === h.no || lastNo(r.ipc_no) === h.no) && Math.abs(Number(r.cumulative_certified ?? NaN) - (adv + ret > 0 ? h.cumulativeGross : h.cumulativeNet)) < 0.5)).length;
      const earlier = table.filter((h) => no === null || h.no < no).length;
      push("Certificate history vs IPC log", `${earlier} earlier certificate(s) in the pack: ${matched} agree with the log, ${history.filter((h) => h.conflicts.length).length} differ, ${history.filter((h) => !h.existing).length} missing from the log`, (ipc ?? cert)!.name);
      const last = table[table.length - 1];
      const acc = db.prepare("SELECT incurred_to_date, tracker_date FROM aconex_control_accounts WHERE programme_id = ? AND (cost_line_id = ? OR UPPER(code) LIKE ?) ORDER BY tracker_date DESC LIMIT 1").get(g.programme.id, g.contract.id ? ((db.prepare("SELECT cost_line_id FROM contracts WHERE id = ?").get(g.contract.id) as { cost_line_id: number | null } | undefined)?.cost_line_id ?? -1) : -1, `%${(g.contract.acc_ref || "§").toUpperCase()}%`) as { incurred_to_date: number | null; tracker_date: string | null } | undefined;
      if (acc && acc.incurred_to_date !== null) {
        const packTotal = (ipc ?? cert)?.workDoneToDate ?? last.cumulativeNet;
        const diff = Math.round((Number(acc.incurred_to_date) - packTotal) * 100) / 100;
        push("Aconex control account – incurred to date", `SAR ${formatMoney(Number(acc.incurred_to_date))} (export of ${acc.tracker_date ? formatDate(acc.tracker_date) : "–"}) vs certified to date in the pack SAR ${formatMoney(packTotal)}${Math.abs(diff) < 0.5 ? " – they agree" : ` – differ by SAR ${formatMoney(diff)}`}`, "Aconex control account export");
      }
      const dupNos = [...new Set(rows.map((r) => lastNo(r.application_no)).filter((n) => !Number.isNaN(n) && rows.filter((r) => lastNo(r.application_no) === n).length > 1))];
      if (dupNos.length) result.warnings.push(`${g.contract.contractor || g.contract.title}: the IPC log holds more than one row numbered ${dupNos.join(", ")} – delete the spare row(s) under Invoices & Payments.`);
    }
    if (history.length) push("Earlier certificates in the pack's history", `${history.filter((h) => !h.existing).length} to add, ${history.filter((h) => h.existing && !h.conflicts.length).length} to complete, ${history.filter((h) => h.conflicts.length).length} to correct`, (ipc ?? cert)!.name);
    plans.push({ key, docs: g.docs, programme: g.programme, contract: g.contract, existing, record, patch, conflicts, read, missing, history, label: `${g.contract.contractor || g.contract.title} – ${String(record.application_no ?? existing?.application_no ?? month ?? "")}` });
  }

  const undecided = plans.filter((pl) => pl.existing && pl.conflicts.length && !decisions[pl.key]);
  const undecidedHistory = plans.flatMap((pl) => pl.history.filter((h) => h.conflicts.length && !decisions[h.key]).map((h) => ({ pl, h })));
  if (undecided.length || undecidedHistory.length) {
    result.needsDecision = true;
    const existingOf = (pl: Plan, row: RecordRow) => ({ id: Number(row.id), label: `${row.application_no ?? ""} (${row.month ?? "–"})`, detail: `${pl.contract.contractor} – applied ${show(row.cumulative_claimed)}, IPC ${row.ipc_no ?? "–"} of ${row.ipc_date ? formatDate(String(row.ipc_date)) : "–"}, certified ${show(row.cumulative_certified)}` });
    result.duplicates = [
      ...undecided.map<Duplicate>((pl) => ({
        key: pl.key,
        existing: existingOf(pl, pl.existing!),
        incoming: { label: pl.label, detail: pl.docs.map((d) => d.note).join("; ") },
        differences: pl.conflicts,
        files: pl.docs.map((d) => d.name),
      })),
      ...undecidedHistory.map<Duplicate>(({ pl, h }) => ({
        key: h.key,
        existing: existingOf(pl, h.existing!),
        incoming: { label: `${pl.contract.contractor || pl.contract.title} – IPC ${h.no} (certificate history)`, detail: `Earlier certificate listed in the Payment Certificate History of ${pl.docs.map((d) => d.name).join("; ")}` },
        differences: h.conflicts,
        files: pl.docs.map((d) => d.name),
      })),
    ];
    return result;
  }
  for (const pl of plans) {
    const outcome = (action: Outcome["action"], row: RecordRow): Outcome => ({ action, id: Number(row.id), label: String(row.application_no ?? row.id), description: `${pl.contract.contractor || pl.contract.title} – ${row.month ?? ""}${row.ipc_no ? `, IPC ${row.ipc_no}` : ""}`, programme: pl.programme.name, files: pl.docs.map((d) => d.name), read: pl.read, missing: pl.missing });
    if (pl.existing) {
      if (pl.conflicts.length && decisions[pl.key] === "keep") {
        // keep the old values: only the blanks are filled
        for (const c of pl.conflicts) {
          const k = def.fields.find((f) => f.label === c.label)?.key ?? c.label;
          delete pl.patch[k];
        }
      }
      const row = updateRecord(def, Number(pl.existing.id), pl.patch, user, "import", { bypassRoles: true });
      result.entries.push(outcome(pl.conflicts.length && decisions[pl.key] === "keep" ? "kept" : "updated", row));
    } else {
      const row = createRecord(def, pl.record, user, "import", { bypassRoles: true });
      result.entries.push(outcome("created", row));
    }
    for (const h of pl.history.sort((a, b) => a.no - b.no)) {
      try {
        const keep = h.conflicts.length > 0 && decisions[h.key] === "keep";
        if (keep) for (const c of h.conflicts) delete h.patch[def.fields.find((f) => f.label === c.label)?.key ?? c.label];
        if (h.existing && !Object.keys(h.patch).length) continue;
        const row = h.existing ? updateRecord(def, Number(h.existing.id), h.patch, user, "import", { bypassRoles: true }) : createRecord(def, h.record, user, "import", { bypassRoles: true });
        result.entries.push({ action: h.existing ? (keep ? "kept" : "updated") : "created", id: Number(row.id), label: String(row.application_no ?? row.id), description: `${pl.contract.contractor || pl.contract.title} – ${row.month ?? ""}${row.ipc_no ? `, IPC ${row.ipc_no}` : ""} (from the certificate history)`, programme: pl.programme.name, files: pl.docs.map((d) => d.name), read: Object.entries(h.existing ? h.patch : h.record).filter(([k]) => !["programme_id", "contract_id", "comments"].includes(k)).map(([k, v]) => ({ label: def.fields.find((f) => f.key === k)?.label ?? k, value: String(v), from: "certificate history" })), missing: h.existing ? [] : ["Application date", "Application Aconex ref", "IPC Aconex ref"] });
      } catch (e) {
        result.warnings.push(`IPC ${h.no} from the certificate history could not be written: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}
