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
  note: string;
}

const textOf = (pages: PosPage[]) => pages.map((p) => p.rows.map((r) => r.cells.map((c) => c.s).join(" ")).join("\n")).join("\n");
/** the text as the letter reads: ligature gaps closed ("Certi fi cate"), digits split by the layout re-joined ("(No. 0 1 9 )") */
const tidy = (t: string) =>
  t
    .replace(/\b([A-Za-z]+) (fi|fl|ff) ([a-z]+)\b/g, "$1$2$3")
    .replace(/\(No\.\s*((?:\d ?){1,4})\s*\)/g, (_, d: string) => `(No. ${d.replace(/\s/g, "")})`)
    .replace(/\b(\d) (\d) (\d)\b/g, "$1$2$3")
    .replace(/\+9 66/g, "+966")
    .replace(/Octo ber/g, "October")
    .replace(/MAIL TYPE MAIL NUMBER REFERENCE NUMBER\n(Transmittal|Letter|Mail)\s+(\S+)\s+(\S+)/g, "MAIL TYPE\n$1\nMAIL NUMBER\n$2\nREFERENCE NUMBER\n$3");
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
  const acc = (f.name.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1] ?? contractLine.match(/^(\d{3}[A-Z]\d{2})/)?.[1] ?? text.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1] ?? "").toUpperCase();
  const mailNo = text.match(/MAIL NUMBER\s*\n?\s*([A-Z0-9]{2,6}\d{5}-[A-Z]{3,8}-\d{6}|1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4}[A-Z0-9]*)/)?.[1] ?? text.match(/Our Ref:\s*\n?\s*(1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4}[A-Z0-9]*)/)?.[1] ?? f.name.match(/\b([A-Z]{2,6}\d{5}-[A-Z]{3,8}-\d{6}|1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-\d{4}[A-Z0-9]*)\b/)?.[1] ?? "";
  const subject = head.match(/^(?:Re:\s*|Subject:\s*)?((?:[^\n]*(?:Interim Payment|IPA|IPC|Payment Application|Payment Certificate)[^\n]*)(?:\n[^\n]{0,80}(?:\d{4}\)?|\d{3}\)?))?)/im)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const sentDate = dateOf(head.match(/\bSent\s*\n?\s*([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4})/)?.[1] ?? "");
  const letterDate = dateOf(head.match(/\bDate:?\s*\n?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/)?.[1] ?? "") || dateOf(head.match(/\n(\d{1,2} [A-Za-z]{3,9} \d{4})\s*\n/)?.[1] ?? "");
  const isIpc = /Interim Payment Certificate|Proposes to pay the Contractor|Payment Certificate No\.?\s*\d/i.test(head) && /Proposes to pay|Employer hereby notifies/i.test(text);
  const isCert = /PAYMENT CERTIFICATE NO\.|Recommendation No\.|CERTIFICATE SUMMARY|Amount due for this Recommendation/i.test(text) && !isIpc;
  const isMail = /MAIL TYPE/i.test(head.slice(0, 1500)) && /\bTransmittal\b/i.test(head.slice(0, 1500));
  const isIpa = isMail && /Interim Payment Application|\bIPA\b|Payment Application|Payment Certificate Submission/i.test(subject);
  const kind: DocRead["kind"] = isIpc ? "ipc" : isCert ? "certificate" : isIpa ? "ipa" : "unknown";
  const noFrom = (s: string) => {
    const m = s.match(/(?:Certificate|Application|IPA|IPC|Recommendation)\s*(?:No\.?|Number|#|-)?\s*\(?(?:No\.?\s*)?0*(\d{1,3})\b/i) ?? s.match(/\bIPA[\s-]*0*(\d{1,3})\b/i) ?? s.match(/\bIPC[\s-]*0*(\d{1,3})\b/i);
    return m ? Number(m[1]) : null;
  };
  let no = noFrom(subject) ?? noFrom(f.name);
  if (no === null && kind === "certificate") no = noFrom(text.match(/PAYMENT CERTIFICATE NO\.?\s*\d+/i)?.[0] ?? "") ?? (Number(text.match(/Recommendation No\.\s*\n?\s*(\d{1,3})\b/)?.[1] ?? NaN) || null);
  if (no === null && kind === "ipc") no = noFrom(text.match(/Interim Payment Certificate\s*\(?No\.?\s*\d+/i)?.[0] ?? "");
  const upTo = text.match(/completed works up to\s*\n?\s*(\d{1,2} [A-Za-z]+ \d{4})/i)?.[1] ?? "";
  const month = monthLabel(subject.match(/(?:Month of|for month of|for the month of)\s*([A-Za-z]+\.?\s*\d{4})/i)?.[1] ?? "") || monthLabel(subject.match(/-\s*([A-Za-z]+ \d{4})\s*$/)?.[1] ?? "") || monthLabel(text.match(/Valuation Month\s*\n?\s*([A-Za-z]{3}-\d{2}|[A-Za-z]+ \d{4})/i)?.[1] ?? "") || monthLabel(upTo);
  const submittedOn = dateOf(text.match(/submitted on\s*\n?\s*(\d{1,2} [A-Za-z]+(?: [A-Za-z]+)? \d{4})/i)?.[1] ?? "");
  const applicationRef = text.match(/(?:under Aconex mail reference|Your Ref:?|REFERENCE NUMBER)\s*\n?\s*([A-Z0-9]{2,6}\d{5}-[A-Z]{3,8}-\s*\n?\s*\d{6})/i)?.[1]?.replace(/\s+/g, "") ?? "";
  const netCertified = sar(text.match(/Proposes to pay the Contractor\s*SAR\s*[\d,]+(?:\.\d{2})?/i)?.[0]);
  const amountDue = (() => {
    const m = text.match(/Amount due for this Recommendation No\.?\s*\d*\s*\n?\s*([\d,]+\.\d{2})/i);
    return m ? num(m[1]) : null;
  })();
  // the certificate pack: its rows run Contract price | Previous | Current | To date; the "Total Work Done"
  // row is the largest one where previous + current = to date (the grand total after retention is smaller)
  const workDoneToDate = (() => {
    const money = (t: string) => [...t.matchAll(/\(?-?[\d,]{4,}\.\d{2}\)?/g)].map((m) => (m[0].startsWith("(") ? -1 : 1) * num(m[0]));
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
  return { name: f.name, kind, text, programmeCode, acc, contractLine, mailNo, no, month, sentDate, letterDate, submittedOn, applicationRef, netCertified, amountDue, workDoneToDate, recommendationDate, note };
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
    const byAcc = d.acc ? all.find((c) => c.acc_ref.toUpperCase().includes(d.acc)) ?? all.find((c) => ((db.prepare("SELECT code FROM cost_lines WHERE id = (SELECT cost_line_id FROM contracts WHERE id = ?)").get(c.id) as { code: string } | undefined)?.code ?? "").toUpperCase().includes(d.acc)) : undefined;
    if (byAcc) return byAcc;
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
    const programme = programmes.find((p) => p.code === d.programmeCode) ?? programmeByAcc(d.acc) ?? programmeByContractor(d) ?? app.programme;
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
    const ipa = g.docs.find((d) => d.kind === "ipa");
    const ipc = g.docs.find((d) => d.kind === "ipc");
    const cert = g.docs.find((d) => d.kind === "certificate");
    const no = ipa?.no ?? ipc?.no ?? cert?.no ?? null;
    const month = ipa?.month || ipc?.month || cert?.month || "";
    const rows = db.prepare("SELECT * FROM payment_applications WHERE contract_id = ? ORDER BY sr_no, id").all(g.contract.id) as RecordRow[];
    const lastNo = (s: unknown) => Number(String(s ?? "").match(/(\d+)(?!.*\d)/)?.[1] ?? NaN);
    const existing = rows.find((r) => no !== null && (lastNo(r.application_no) === no || lastNo(r.ipc_no) === no)) ?? rows.find((r) => ipa?.mailNo && String(r.application_aconex_ref ?? "").replace(/\s+/g, "") === ipa.mailNo) ?? rows.find((r) => month && String(r.month ?? "") === month) ?? null;
    const prev = rows.filter((r) => no !== null && (lastNo(r.application_no) < no || lastNo(r.ipc_no) < no)).sort((a, b) => lastNo(b.application_no) - lastNo(a.application_no))[0] ?? (existing ? null : rows[rows.length - 1]) ?? null;
    const sample = rows[rows.length - 1];
    const numbered = (pattern: unknown, fallback: string) => {
      const p = String(pattern ?? "");
      return no === null ? (p || fallback) : p && /\d/.test(p) ? p.replace(/(\d+)(?!.*\d)/, (m) => String(no).padStart(m.length, "0")) : fallback;
    };
    const read: ReadValue[] = [];
    const push = (label: string, value: string | number | null | undefined, from: string) => {
      if (value !== null && value !== undefined && value !== "") read.push({ label, value: String(value), from });
    };
    push("Contract", `${g.contract.title} (${g.contract.acc_ref || "–"}) – ${g.contract.contractor}`, "registers");
    const record: Record<string, unknown> = { programme_id: g.programme.id, contract_id: g.contract.id };
    if (no !== null) {
      record.sr_no = no;
      record.application_no = numbered(sample?.application_no, `IPA - ${String(no).padStart(2, "0")}`);
      record.ipc_no = numbered(sample?.ipc_no, String(no));
      push("Application no", String(record.application_no), ipa?.name ?? ipc?.name ?? cert!.name);
    }
    if (month) {
      record.month = month;
      push("Month", month, ipa?.name ?? ipc?.name ?? cert!.name);
    }
    if (ipa) {
      record.application_aconex_ref = ipa.mailNo;
      record.application_date = ipa.sentDate;
      push("Application Aconex ref", ipa.mailNo, ipa.name);
      push("Application date", ipa.sentDate, ipa.name);
    } else if (ipc?.applicationRef) {
      record.application_aconex_ref = ipc.applicationRef;
      if (ipc.submittedOn) record.application_date = ipc.submittedOn;
      push("Application Aconex ref", ipc.applicationRef, ipc.name);
      push("Application date (submitted on)", ipc.submittedOn, ipc.name);
    }
    if (cert?.workDoneToDate) {
      record.cumulative_claimed = cert.workDoneToDate;
      push("Cumulative work done (claimed)", cert.workDoneToDate, cert.name);
    }
    const adv = Number(g.contract.advance_recovery_pct ?? 0) / 100;
    const ret = Number(g.contract.retention_pct ?? 0) / 100;
    if (ipc) {
      record.ipc_aconex_ref = ipc.mailNo;
      record.ipc_date = ipc.letterDate || ipc.sentDate;
      push("IPC Aconex ref", ipc.mailNo, ipc.name);
      push("IPC date", String(record.ipc_date ?? ""), ipc.name);
      push("Net certified this IPC (SAR, excl. VAT)", ipc.netCertified, ipc.name);
    } else if (cert) {
      record.ipc_date = cert.recommendationDate;
      push("Certificate date", cert.recommendationDate, cert.name);
      push("Amount due this certificate (SAR)", cert.amountDue, cert.name);
    }
    if (cert?.workDoneToDate) {
      record.cumulative_certified = cert.workDoneToDate;
      push("Cumulative work done (certified)", cert.workDoneToDate, cert.name);
    } else if (ipc?.netCertified !== null && ipc?.netCertified !== undefined) {
      // the letter gives the net for this IPC: the gross behind it is carried on the previous cumulative
      const prevCum = Number((existing?.cumulative_certified as number | null) ?? prev?.cumulative_certified ?? 0) || Number(prev?.cumulative_certified ?? 0) || 0;
      const base = existing && existing.cumulative_certified ? 0 : prevCum;
      const factor = 1 - adv - ret;
      const gross = factor > 0 ? Math.round((ipc.netCertified / factor) * 100) / 100 : ipc.netCertified;
      if (!existing?.cumulative_certified) {
        record.cumulative_certified = Math.round((base + gross) * 100) / 100;
        push("Cumulative certified (previous + this IPC's gross)", record.cumulative_certified as number, ipc.name);
      }
    }
    if (!record.cumulative_claimed && record.cumulative_certified && !existing?.cumulative_claimed) record.cumulative_claimed = record.cumulative_certified;
    const stamp = `Added from documents on ${formatDate(todayIso())} (${g.docs.map((d) => d.name).join("; ")})${ipc?.netCertified ? ` – IPC net SAR ${formatMoney(ipc.netCertified)} excl. VAT` : ""}${cert?.amountDue ? ` – amount due SAR ${formatMoney(cert.amountDue)}` : ""}`;
    if (!existing && !record.application_date && (ipc?.submittedOn || ipc?.letterDate || cert?.recommendationDate)) record.application_date = ipc?.submittedOn || ipc?.letterDate || cert?.recommendationDate;
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
      if (!record.application_date) record.application_date = ipc?.submittedOn || ipc?.letterDate || cert?.recommendationDate || todayIso();
      record.comments = [stamp, missing.length ? `Not found in the documents – to be added by hand: ${missing.join(", ")}.` : ""].filter(Boolean).join("\n");
    }
    plans.push({ key, docs: g.docs, programme: g.programme, contract: g.contract, existing, record, patch, conflicts, read, missing, label: `${g.contract.contractor || g.contract.title} – ${String(record.application_no ?? existing?.application_no ?? month ?? "")}` });
  }

  const undecided = plans.filter((pl) => pl.existing && pl.conflicts.length && !decisions[pl.key]);
  if (undecided.length) {
    result.needsDecision = true;
    result.duplicates = undecided.map<Duplicate>((pl) => ({
      key: pl.key,
      existing: { id: Number(pl.existing!.id), label: `${pl.existing!.application_no ?? ""} (${pl.existing!.month ?? "–"})`, detail: `${pl.contract.contractor} – applied ${show(pl.existing!.cumulative_claimed)}, IPC ${pl.existing!.ipc_no ?? "–"} of ${pl.existing!.ipc_date ? formatDate(String(pl.existing!.ipc_date)) : "–"}, certified ${show(pl.existing!.cumulative_certified)}` },
      incoming: { label: pl.label, detail: pl.docs.map((d) => d.note).join("; ") },
      differences: pl.conflicts,
      files: pl.docs.map((d) => d.name),
    }));
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
  }
  return result;
}
