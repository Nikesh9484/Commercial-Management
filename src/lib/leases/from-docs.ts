import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { createRecord, listRecords, updateRecord } from "../registers/engine";
import type { RecordRow, UserInfo } from "../registers/types";
import { positioned } from "../packs/extract";
import type { PosPage } from "../packs/positioned";
import { convertToPdf, convertible } from "../packs/convert";
import { getAppContext } from "../context";
import { formatDate, formatMoney, todayIso } from "../format";
import { ocrAvailable, ocrPdfPages } from "../ocr";
import { decide, type Decisions, type Duplicate, type FromDocsResult, type Outcome, type ReadValue } from "../from-docs-shared";
import { addDoc, type Reading } from "../library/store";
import { contractorKey } from "../bonds/name-key";
import { addMonths } from "./summary";

/**
 * A Labour Accommodation Lease Agreement, or an amendment to one, read from its own PDF: the
 * agreement number and date, the tenant (our contractor), the works agreement it serves, the term,
 * the commencement date, the lease fee, the security deposit, the room rates and the monthly fee
 * histogram. An agreement becomes a row on the lease tracker; an amendment is matched to its
 * agreement (contractor and works contract, else agreement number), logged, and moves the current
 * fee and expiry on. Every document is filed in the Contract Library under the contractor and
 * contract code, as a Lease Agreement or a Lease Amendment.
 */
export interface DocFile {
  name: string;
  bytes: Buffer;
}
interface LeaseRead {
  name: string;
  kind: "agreement" | "amendment" | "unknown";
  text: string;
  programmeCode: string;
  acc: string;
  agreementNo: string;
  agreementDate: string;
  tenant: string;
  works: string;
  termMonths: number | null;
  commencement: string;
  expiry: string;
  leaseFee: number | null;
  deposit: number | null;
  rates: { worker: number | null; junior: number | null; senior: number | null; executive: number | null };
  personNights: number | null;
  histogram: { month: string; amount: number }[];
  amendmentNo: number | null;
  amendmentDate: string;
  newFee: number | null;
  newTermMonths: number | null;
  /** the term before the amendment, as it recites it ("instead of 12 months") – fills an agreement whose term sheet left it blank */
  oldTermMonths: number | null;
  newExpiry: string;
  changes: string[];
  aconex: string[];
  ocr: boolean;
  note: string;
}

const textOf = (pages: PosPage[]) => pages.map((p) => p.rows.map((r) => r.cells.map((c) => c.s).join(" ")).join("\n")).join("\n");
/** the positioned text splits words ("Decem ber", "0 1 Jun e") – comparisons are made with every space removed */
const squash = (s: string) => s.replace(/\s+/g, "");
const money = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNo = (name: string) => {
  const i = MONTHS.indexOf(name.toLowerCase().slice(0, 3));
  return i < 0 ? null : i + 1;
};
/** "19December2024" / "1stJanuary2025" / "01June2025" → ISO */
function dateFromSquashed(s: string | undefined): string {
  if (!s) return "";
  const m = /(\d{1,2})(?:st|nd|rd|th)?([A-Za-z]{3,9})(\d{4})/.exec(s);
  if (!m) return "";
  const mo = monthNo(m[2]);
  if (!mo) return "";
  return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
/** "Jan-25" → 2025-01 */
const monthKey = (s: string) => {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(s.trim());
  const mo = m ? monthNo(m[1]) : null;
  return m && mo ? `20${m[2]}-${String(mo).padStart(2, "0")}` : "";
};

function readRates(text: string): LeaseRead["rates"] {
  const pick = (re: RegExp) => {
    const line = text.split("\n").find((l) => re.test(l));
    if (!line) return null;
    const nums = line.match(/\d+\.\d{2}/g);
    return nums ? money(nums[nums.length - 1]) : null;
  };
  return {
    worker: pick(/^\s*1\s+Worker\b/i),
    junior: pick(/^\s*2\s+Junior\b/i),
    senior: pick(/^\s*3\s+Senior\b/i),
    executive: pick(/^\s*4\s+Executive\b/i),
  };
}

/** The Tenant's Services Usage Histogram: the months line and the Total Cost line, paired by position. */
function readHistogram(text: string): { month: string; amount: number }[] {
  const lines = text.split("\n");
  const mi = lines.findIndex((l) => /^\s*Month\s+[A-Za-z]{3}-\d{2}/.test(l));
  if (mi < 0) return [];
  const months = (lines[mi].match(/[A-Za-z]{3}-\d{2}/g) ?? []).map(monthKey).filter(Boolean);
  const total = lines.slice(mi).find((l) => /^\s*Total\s*Cost\b/i.test(l));
  if (!total || !months.length) return [];
  const cells = total.replace(/^\s*Total\s*Cost\s*/i, "").trim().split(/\s{2,}|\s+(?=[-\d])/).map((c) => c.trim()).filter(Boolean);
  // the last cell is the grand total; the ones before line up with the months
  const values = cells.slice(0, -1).slice(0, months.length);
  return months.map((month, i) => ({ month, amount: money(values[i] ?? "") ?? 0 })).filter((h) => h.amount > 0);
}

/** Person-nights contracted: the Total row of the histogram (its last column is Total Man-nights), else Table 3's TOTALS. */
function readPersonNights(text: string): number | null {
  const lines = text.split("\n");
  const mi = lines.findIndex((l) => /^\s*Month\s+[A-Za-z]{3}-\d{2}/.test(l));
  if (mi >= 0) {
    const total = lines.slice(mi, mi + 12).find((l) => /^\s*Total\s+[-\d]/.test(l) && !/Cost|Man/i.test(l));
    // the last column (Total Man-nights) follows the month columns, which end in ".00" or "-"
    const tail = total?.match(/(?:\d+\.\d{2}|-)\s+([\d,\s]+)$/)?.[1];
    const n = tail ? Number(tail.replace(/[,\s]/g, "")) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const t = lines.find((l) => /^\s*TOTALS\b/i.test(l));
  const nums = t?.replace(/^\s*TOTALS\s*(N\/A)?/i, "").replace(/\s+/g, "").match(/[\d,]+(?:\.\d{2})?/g);
  if (nums && nums.length >= 2) return Math.round(Number(nums[0].replace(/,/g, ""))) || null;
  return null;
}

async function readOne(f: DocFile): Promise<LeaseRead | null> {
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
  const blank = pages.map((p, i) => ({ i: i + 1, len: p.rows.reduce((a, r) => a + r.cells.reduce((b, c) => b + c.s.length, 0), 0) })).filter((p) => p.len < 40).map((p) => p.i).slice(0, 8);
  if (blank.length && ocrAvailable()) {
    const read = await ocrPdfPages(pdf, blank);
    const extra = [...read.values()].filter((t) => t.trim().length > 20);
    if (extra.length) {
      text = `${extra.join("\n")}\n${text}`;
      ocr = true;
    }
  }
  const head = text.slice(0, 5000);
  const sq = squash(text);
  const sqHead = squash(head);
  const isAmendment = /AMENDMENT\s*No\.?\s*\d+/i.test(head) && /Lease\s*Agreement/i.test(head);
  const isLease = /LABOUR\s*ACCOMMODATION\s*LEASE\s*AGREEMENT|ACCOMMODATION\s*LEASE\s*AGREEMENT/i.test(head);
  const kind: LeaseRead["kind"] = isAmendment ? "amendment" : isLease ? "agreement" : "unknown";
  const aconex = [...new Set(`${f.name}\n${head}`.match(/\b1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{2}-\d{4}(?:C\d)?\b/g) ?? [])];
  const programmeCode = `${f.name}\n${head}`.match(/\b(1TB\d{5})\b/)?.[1] ?? "";
  const acc = (`${f.name}\n${sqHead}`.match(/(?<![A-Z0-9])(\d{3}[A-Z]\d{2})(?![A-Z0-9])/)?.[1] ?? "").toUpperCase();
  const base: LeaseRead = { name: f.name, kind, text, programmeCode, acc, agreementNo: "", agreementDate: "", tenant: "", works: "", termMonths: null, commencement: "", expiry: "", leaseFee: null, deposit: null, rates: { worker: null, junior: null, senior: null, executive: null }, personNights: null, histogram: [], amendmentNo: null, amendmentDate: "", newFee: null, newTermMonths: null, oldTermMonths: null, newExpiry: "", changes: [], aconex, ocr, note: "" };
  if (kind === "unknown") return { ...base, note: "not recognised as a lease agreement or an amendment – kept out" };

  if (kind === "agreement") {
    base.agreementNo = sqHead.match(/AgreementNo\.?:?(1TB\d{5}[A-Z]\d{2,3})/i)?.[1]?.toUpperCase() ?? "";
    base.agreementDate = dateFromSquashed(sqHead.match(/AgreementDate:?(\d{1,2}[A-Za-z]{3,9}\d{4})/i)?.[1]);
    // "2. Name: <tenant> Entity Type: <type>" with the name's second line before "Registered in"
    const lines = head.split("\n");
    const ni = lines.findIndex((l) => /^\s*2\.\s*Name:/i.test(l) || /^\s*Name:/i.test(l));
    if (ni >= 0) {
      let name = lines[ni].replace(/^\s*2\.\s*/, "").replace(/^Name:\s*/i, "").replace(/Entity\s*Type:.*$/i, "").trim();
      for (let j = ni + 1; j < Math.min(ni + 3, lines.length); j++) {
        if (/Registered\s*in|C\.R\.|Address/i.test(lines[j])) break;
        name = `${name} ${lines[j].trim()}`;
      }
      base.tenant = name.replace(/\s+/g, " ").trim();
    }
    base.works = (head.match(/in\s+respect\s+of\s+([\s\S]{5,220}?)\s+detailing/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
    base.termMonths = Number(sq.match(/LeaseTerm\[?(\d{1,2})\]?Months/i)?.[1] ?? "") || null;
    base.commencement = dateFromSquashed(sq.match(/Commencement(?:Date)?:?\[?(\d{1,2}(?:st|nd|rd|th)?[A-Za-z]{3,9}\d{4})/i)?.[1]);
    base.leaseFee = money(sq.match(/LeaseFee:?SAR\[?([\d,]{4,}(?:\.\d{2})?)/i)?.[1]);
    base.deposit = money(sq.match(/SecurityDeposit:?SAR\[?([\d,]{4,}(?:\.\d{2})?)/i)?.[1]) ?? money(sq.match(/SecurityDeposit.{0,80}?\(SAR([\d,]{4,}(?:\.\d{2})?)\)/i)?.[1]);
    base.rates = readRates(text);
    base.histogram = readHistogram(text);
    base.personNights = readPersonNights(text);
    if (base.commencement && base.termMonths) base.expiry = addMonths(base.commencement, base.termMonths) ?? "";
    base.note = `lease agreement ${base.agreementNo || "(number not read)"}${base.tenant ? ` – ${base.tenant}` : ""}${base.leaseFee ? `, lease fee ${formatMoney(base.leaseFee)} SAR` : ""}${base.commencement ? `, from ${formatDate(base.commencement)}` : ""}${base.expiry ? ` to ${formatDate(base.expiry)}` : ""}${ocr ? " (scanned pages read by OCR)" : ""}`;
    return base;
  }

  // an amendment: which agreement, and what it changes
  base.amendmentNo = Number(head.match(/AMENDMENT\s*No\.?\s*(\d+)/i)?.[1] ?? "") || null;
  base.amendmentDate = dateFromSquashed(sqHead.match(/ismadeon(\d{1,2}(?:st|nd|rd|th)?[A-Za-z]{3,9}\d{4})/i)?.[1]);
  base.agreementNo = (sqHead.match(/(?:Contract|Agreement)No\.?:?(1TB\d{5}[A-Z]\d{2,3})/i)?.[1] ?? "").toUpperCase();
  base.tenant = (head.match(/\(2\)\s+([^,\n]{3,80}?)\s*,\s*a\s+company/i)?.[1] ?? head.match(/Lease\s*Agreement\s+([^.\n(]{3,60}?)\s*\.?\s*\(/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  base.works = (head.match(/in\s+respect\s+of\s+(?:the\s+)?([\s\S]{5,200}?)(?:\s*\/\s*1TB|\s*\(|\s+Accommodation\s+Contract)/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  base.newFee = money(sq.match(/amount(?:de|in)creased[^0-9]{0,60}?toSAR([\d,]+(?:\.\d{2})?)/i)?.[1]) ?? money(sq.match(/LeaseFee(?:is|be)?(?:amended|revised|changed)?toSAR([\d,]+(?:\.\d{2})?)/i)?.[1]);
  base.newTermMonths = Number(sq.match(/periodto(\d{1,3})Months/i)?.[1] ?? "") || null;
  base.oldTermMonths = Number(sq.match(/insteadof(\d{1,3})months/i)?.[1] ?? "") || null;
  base.newExpiry = dateFromSquashed(sq.match(/till(\d{1,2}(?:st|nd|rd|th)?[A-Za-z]{3,9}\d{4})/i)?.[1] ?? sq.match(/until(\d{1,2}(?:st|nd|rd|th)?[A-Za-z]{3,9}\d{4})/i)?.[1]);
  base.commencement = dateFromSquashed(sq.match(/commencementdate(\d{1,2}(?:st|nd|rd|th)?[A-Za-z]{3,9}\d{4})/i)?.[1]);
  if (!base.newExpiry && base.commencement && base.newTermMonths) base.newExpiry = addMonths(base.commencement, base.newTermMonths) ?? "";
  base.histogram = readHistogram(text);
  base.rates = readRates(text);
  // the "(B) The Parties wish to amend ... i. ... ii. ..." list
  const list = head.match(/wish\s+to\s+amend[\s\S]{0,40}?following:?([\s\S]{0,1200}?)IT\s+IS\s+AGREED/i)?.[1] ?? "";
  base.changes = list
    .split(/\n(?=\s*(?:i{1,3}v?|iv|v|vi{0,3}|[a-z]|\d+)[.)]\s)/i)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter((c) => c.length > 8);
  base.note = `amendment No ${base.amendmentNo ?? "?"} to lease agreement ${base.agreementNo || "(number not read)"}${base.tenant ? ` – ${base.tenant}` : ""}${base.newFee ? `, lease fee now ${formatMoney(base.newFee)} SAR` : ""}${base.newExpiry ? `, term now to ${formatDate(base.newExpiry)}` : ""}${ocr ? " (scanned pages read by OCR)" : ""}`;
  return base;
}

const sameCompany = (a: unknown, b: unknown) => {
  const ka = contractorKey(a);
  const kb = contractorKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const w = (s: unknown) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3 && !["company", "limited", "contracting", "engineering", "construction", "partners", "saudi", "arabia", "additives"].includes(x));
  const wa = w(a);
  const wb = w(b);
  return wa.length > 0 && wa.filter((x) => wb.includes(x)).length >= Math.min(2, wa.length);
};

const histogramText = (h: { month: string; amount: number }[]) => h.map((x) => `${x.month}: ${formatMoney(x.amount)}`).join("; ");

export async function addLeasesFromDocuments(files: DocFile[], user: UserInfo, decisions: Decisions = {}): Promise<FromDocsResult> {
  const db = getDb();
  const def = getRegisterDef("lease_agreements")!;
  const amendDef = getRegisterDef("lease_amendments")!;
  const app = getAppContext();
  const result: FromDocsResult = { entries: [], duplicates: [], needsDecision: false, files: [], periods: [], warnings: [] };
  const reads: LeaseRead[] = [];
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
  const contractors = db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string }[];
  const programmeOf = (r: LeaseRead) => programmes.find((p) => r.programmeCode && String(p.code ?? "").toUpperCase().startsWith(r.programmeCode.toUpperCase())) ?? app.programme ?? programmes[0];
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "number" ? formatMoney(v) : String(v));

  type Plan = { read: LeaseRead; programme: { id: number; name: string }; record: Record<string, unknown>; existing: RecordRow | null; key: string; label: string; readValues: ReadValue[]; missing: string[]; differences: { label: string; old: string; new: string }[]; contractorId: number | null; contractLine: RecordRow | null };
  const plans: Plan[] = [];
  const amendments: { read: LeaseRead; programme: { id: number; name: string }; contractorId: number | null }[] = [];
  // agreements first, so an amendment uploaded with its agreement finds it
  for (const p of reads.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "agreement" ? -1 : 1))) {
    const programme = programmeOf(p);
    const rows = listRecords(def, { allScopes: true }).filter((r) => Number(r.programme_id) === programme.id);
    const contractor = contractors.find((c) => sameCompany(c.name, p.tenant)) ?? null;
    const lines = db.prepare("SELECT id, code, name, contractor_id FROM cost_lines WHERE programme_id = ?").all(programme.id) as RecordRow[];
    const contractLine = (p.acc ? lines.find((l) => String(l.code ?? "").toUpperCase().includes(p.acc)) : null) ?? (contractor ? lines.find((l) => Number(l.contractor_id) === contractor.id) ?? null : null);
    const contractorId = contractor?.id ?? (contractLine?.contractor_id ? Number(contractLine.contractor_id) : null);
    if (p.kind === "amendment") {
      amendments.push({ read: p, programme, contractorId });
      continue;
    }
    const existing = rows.find((r) => p.agreementNo && String(r.agreement_no ?? "").toUpperCase() === p.agreementNo) ?? rows.find((r) => contractorId && Number(r.contractor_id) === contractorId && (!p.acc || String(r.contract_code ?? "").toUpperCase() === p.acc)) ?? null;
    const readValues: ReadValue[] = [];
    const push = (label: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== "") readValues.push({ label, value: String(value), from: p.name });
    };
    push("Agreement no", p.agreementNo);
    push("Agreement date", p.agreementDate ? formatDate(p.agreementDate) : "");
    push("Tenant", p.tenant);
    if (contractor) readValues.push({ label: "Contractor record", value: contractor.name, from: "registers" });
    push("Works agreement", p.works);
    push("Works contract code", p.acc);
    push("Commencement", p.commencement ? formatDate(p.commencement) : "");
    push("Term (months)", p.termMonths);
    push("Expiry", p.expiry ? formatDate(p.expiry) : "");
    push("Lease fee (SAR)", p.leaseFee);
    push("Security deposit (SAR)", p.deposit);
    push("Room rates", [p.rates.worker && `worker ${p.rates.worker}`, p.rates.junior && `junior ${p.rates.junior}`, p.rates.senior && `senior ${p.rates.senior}`, p.rates.executive && `executive ${p.rates.executive}`].filter(Boolean).join(", "));
    push("Person-nights", p.personNights);
    if (p.histogram.length) push("Monthly fee histogram", histogramText(p.histogram));
    const missing: string[] = [];
    if (!p.agreementNo) missing.push("Agreement no");
    if (!contractorId) missing.push("Tenant (contractor record)");
    if (!p.commencement) missing.push("Commencement date");
    if (!p.termMonths && !p.expiry) missing.push("Term / expiry");
    if (!p.leaseFee) missing.push("Lease fee");
    const stamp = `Added from ${p.name} on ${formatDate(todayIso())}${p.ocr ? " – scanned pages read by OCR, please check the figures" : ""}.${missing.length ? ` Not found in the document – to be added by hand: ${missing.join(", ")}.` : ""}`;
    const record: Record<string, unknown> = {
      programme_id: programme.id,
      agreement_no: p.agreementNo || `${p.acc || "LEASE"}-${p.tenant.split(" ")[0] || "new"}`,
      contractor_id: contractorId,
      contract_code: p.acc || null,
      cost_line_id: contractLine?.id ?? null,
      works_description: p.works || null,
      agreement_date: p.agreementDate || null,
      billing_basis: "Deducted from the tendered price",
      aconex_ref: p.aconex.join(" ") || null,
      commencement_date: p.commencement || null,
      term_months: p.termMonths,
      expiry_date: p.expiry || null,
      lease_fee: p.leaseFee,
      security_deposit: p.deposit,
      deposit_received: false,
      person_nights: p.personNights,
      rate_worker: p.rates.worker,
      rate_junior: p.rates.junior,
      rate_senior: p.rates.senior,
      rate_executive: p.rates.executive,
      histogram: p.histogram.length ? histogramText(p.histogram) : null,
      current_fee: p.leaseFee,
      current_expiry: p.expiry || null,
      amendments_count: 0,
      status: "Active",
      comments: stamp,
    };
    const differences = existing
      ? ([
          ["Agreement no", existing.agreement_no, record.agreement_no],
          ["Commencement", existing.commencement_date, p.commencement],
          ["Term (months)", existing.term_months, p.termMonths],
          ["Original lease fee", existing.lease_fee, p.leaseFee],
          ["Security deposit", existing.security_deposit, p.deposit],
        ] as [string, unknown, unknown][])
          .filter(([, o, n]) => n !== null && n !== "" && show(o) !== show(n))
          .map(([label, o, n]) => ({ label, old: show(o), new: show(n) }))
      : [];
    plans.push({ read: p, programme, record, existing, key: `lease:${programme.id}:${existing ? `id${existing.id}` : record.agreement_no}`, label: `Lease agreement ${record.agreement_no} – ${contractor?.name ?? p.tenant ?? "tenant not matched"}`, readValues, missing, differences, contractorId, contractLine });
  }

  const undecided = plans.filter((pl) => pl.existing && !decide(decisions, pl.key));
  if (undecided.length) {
    result.needsDecision = true;
    result.duplicates = undecided.map<Duplicate>((pl) => ({
      key: pl.key,
      existing: { id: Number(pl.existing!.id), label: `Lease ${pl.existing!.agreement_no}`, detail: `${pl.existing!.contractor_id__label ?? ""} – from ${pl.existing!.commencement_date ? formatDate(String(pl.existing!.commencement_date)) : "–"}, fee ${show(pl.existing!.lease_fee)} SAR, ${pl.existing!.amendments_count || 0} amendment(s)` },
      incoming: { label: pl.label, detail: pl.read.note },
      differences: pl.differences,
      files: [pl.read.name],
    }));
    return result;
  }

  const file = (programmeId: number, f: DocFile | undefined, p: LeaseRead, reading: Partial<Reading>, agreementId: number | null): number | null => {
    if (!f) return null;
    try {
      const doc = addDoc(programmeId, "contract", { name: f.name, relPath: `Accommodation leases/${f.name}`, bytes: f.bytes, mime: "application/pdf" }, { kind: "pdf", text: p.text.slice(0, 600_000), note: null }, {
        contractor_id: reading.contractor_id ?? null,
        contract_id: null,
        contract_code: p.acc || null,
        po_no: null,
        doc_type: p.kind === "amendment" ? "Lease Amendment" : "Lease Agreement",
        title: p.kind === "amendment" ? `Lease amendment No ${p.amendmentNo ?? "?"} – ${p.tenant || p.agreementNo}` : `Labour Accommodation Lease Agreement ${p.agreementNo} – ${p.tenant}`,
        reference: p.agreementNo,
        doc_date: (p.kind === "amendment" ? p.amendmentDate : p.agreementDate) || null,
        claim_ref: "",
        eot_days_claimed: null,
        eot_days_assessed: null,
        cost_claimed: null,
        cost_assessed: p.kind === "amendment" ? p.newFee : p.leaseFee,
        summary: p.note + (agreementId ? ` (lease tracker entry #${agreementId})` : ""),
        key_points: p.kind === "amendment" ? p.changes : [],
        matched_by: "lease tracker",
        confidence: reading.contractor_id ? "High" : "Low",
        read_status: "Read",
      }, user);
      return doc.id;
    } catch (e) {
      result.warnings.push(`${f.name}: filed on the tracker but could not be kept in the Contract Library (${e instanceof Error ? e.message.slice(0, 120) : String(e)}).`);
      return null;
    }
  };

  for (const pl of plans) {
    const f = files.find((x) => x.name === pl.read.name);
    const outcome = (action: Outcome["action"], row: RecordRow): Outcome => ({ action, id: Number(row.id), label: `Lease ${row.agreement_no}`, description: pl.label, programme: pl.programme.name, files: [pl.read.name], read: pl.readValues, missing: pl.missing });
    if (pl.existing) {
      if (decide(decisions, pl.key) === "keep") {
        file(pl.programme.id, f, pl.read, { contractor_id: pl.contractorId }, Number(pl.existing.id));
        result.entries.push(outcome("kept", pl.existing));
        continue;
      }
      const patch: Record<string, unknown> = {};
      for (const k of ["agreement_no", "contract_code", "works_description", "agreement_date", "commencement_date", "term_months", "expiry_date", "lease_fee", "security_deposit", "person_nights", "rate_worker", "rate_junior", "rate_senior", "rate_executive", "histogram", "aconex_ref"]) if (pl.record[k] !== null && pl.record[k] !== "" && pl.record[k] !== undefined) patch[k] = pl.record[k];
      if (!pl.existing.contractor_id && pl.contractorId) patch.contractor_id = pl.contractorId;
      if (!pl.existing.cost_line_id && pl.record.cost_line_id) patch.cost_line_id = pl.record.cost_line_id;
      if (!Number(pl.existing.amendments_count)) {
        if (pl.record.lease_fee) patch.current_fee = pl.record.lease_fee;
        if (pl.record.expiry_date) patch.current_expiry = pl.record.expiry_date;
      }
      patch.comments = [String(pl.existing.comments ?? "").trim(), `Replaced from ${pl.read.name} on ${formatDate(todayIso())}.`].filter(Boolean).join("\n");
      const row = updateRecord(def, Number(pl.existing.id), patch, user, "import", { bypassRoles: true });
      const docId = file(pl.programme.id, f, pl.read, { contractor_id: pl.contractorId }, Number(row.id));
      if (docId) updateRecord(def, Number(row.id), { library_doc_id: docId }, user, "import", { bypassRoles: true });
      result.entries.push(outcome("updated", row));
    } else {
      const row = createRecord(def, pl.record, user, "import", { bypassRoles: true });
      const docId = file(pl.programme.id, f, pl.read, { contractor_id: pl.contractorId }, Number(row.id));
      if (docId) updateRecord(def, Number(row.id), { library_doc_id: docId }, user, "import", { bypassRoles: true });
      result.entries.push(outcome("created", row));
    }
  }

  // amendments: find the agreement, log the amendment, move the current fee and expiry on
  for (const a of amendments) {
    const p = a.read;
    const f = files.find((x) => x.name === p.name);
    const rows = listRecords(def, { allScopes: true }).filter((r) => Number(r.programme_id) === a.programme.id);
    const agreement =
      rows.find((r) => p.agreementNo && String(r.agreement_no ?? "").toUpperCase() === p.agreementNo) ??
      rows.find((r) => a.contractorId && Number(r.contractor_id) === a.contractorId && p.acc && String(r.contract_code ?? "").toUpperCase() === p.acc) ??
      rows.find((r) => a.contractorId && Number(r.contractor_id) === a.contractorId) ??
      rows.find((r) => p.tenant && sameCompany(r.contractor_id__label, p.tenant)) ??
      null;
    if (!agreement) {
      result.warnings.push(`${p.name}: amendment No ${p.amendmentNo ?? "?"} to lease ${p.agreementNo || "(number not read)"} for ${p.tenant || "an unknown tenant"} – no lease agreement for that tenant is on the tracker, so nothing was changed. Add the agreement first (upload it), then this amendment again.`);
      continue;
    }
    const amendRows = listRecords(amendDef, { allScopes: true }).filter((r) => Number(r.agreement_id) === Number(agreement.id));
    const no = p.amendmentNo ?? amendRows.length + 1;
    const existingAmend = amendRows.find((r) => Number(r.amendment_no) === no) ?? null;
    const readValues: ReadValue[] = [
      { label: "Amendment", value: `No ${no} to lease ${agreement.agreement_no}`, from: p.name },
      ...(p.amendmentDate ? [{ label: "Date", value: formatDate(p.amendmentDate), from: p.name }] : []),
      ...(p.newFee ? [{ label: "Lease fee after amendment (SAR)", value: formatMoney(p.newFee), from: p.name }] : []),
      ...(p.newTermMonths ? [{ label: "Term after amendment (months)", value: String(p.newTermMonths), from: p.name }] : []),
      ...(p.newExpiry ? [{ label: "Expiry after amendment", value: formatDate(p.newExpiry), from: p.name }] : []),
      ...(p.histogram.length ? [{ label: "Monthly fee histogram", value: histogramText(p.histogram), from: p.name }] : []),
      ...p.changes.map((c) => ({ label: "Change", value: c, from: p.name })),
    ];
    const amendRecord: Record<string, unknown> = {
      programme_id: a.programme.id,
      agreement_id: Number(agreement.id),
      amendment_no: no,
      amendment_date: p.amendmentDate || null,
      new_fee: p.newFee,
      new_term_months: p.newTermMonths,
      new_expiry: p.newExpiry || null,
      changes: p.changes.join("\n") || null,
      aconex_ref: p.aconex.join(" ") || null,
      comments: `Added from ${p.name} on ${formatDate(todayIso())}.`,
    };
    const row = existingAmend ? updateRecord(amendDef, Number(existingAmend.id), amendRecord, user, "import", { bypassRoles: true }) : createRecord(amendDef, amendRecord, user, "import", { bypassRoles: true });
    // the agreement's current position follows the latest amendment on record
    const all = listRecords(amendDef, { allScopes: true }).filter((r) => Number(r.agreement_id) === Number(agreement.id)).sort((x, y) => Number(x.amendment_no) - Number(y.amendment_no));
    const latestFee = [...all].reverse().find((r) => r.new_fee !== null && r.new_fee !== undefined && r.new_fee !== "")?.new_fee ?? agreement.lease_fee;
    const latestExpiry = [...all].reverse().find((r) => r.new_expiry)?.new_expiry ?? agreement.expiry_date;
    const patch: Record<string, unknown> = { amendments_count: all.length, current_fee: latestFee ?? null, current_expiry: latestExpiry ?? null };
    if (!agreement.term_months && p.oldTermMonths) {
      patch.term_months = p.oldTermMonths;
      if (!agreement.expiry_date && agreement.commencement_date) patch.expiry_date = addMonths(String(agreement.commencement_date), p.oldTermMonths);
    }
    if (p.histogram.length) patch.histogram = histogramText(p.histogram);
    if (p.rates.worker || p.rates.junior || p.rates.senior || p.rates.executive) for (const [k, v] of Object.entries({ rate_worker: p.rates.worker, rate_junior: p.rates.junior, rate_senior: p.rates.senior, rate_executive: p.rates.executive })) if (v) patch[k] = v;
    if (agreement.status === "Expired" && latestExpiry && String(latestExpiry) >= todayIso()) patch.status = "Extended";
    else if (agreement.status === "Active" && all.length) patch.status = "Extended";
    patch.comments = [String(agreement.comments ?? "").trim(), `Amendment No ${no} added from ${p.name} on ${formatDate(todayIso())}: ${p.changes.join(" ") || p.note}`].filter(Boolean).join("\n");
    const updated = updateRecord(def, Number(agreement.id), patch, user, "import", { bypassRoles: true });
    const docId = file(a.programme.id, f, p, { contractor_id: Number(agreement.contractor_id) || a.contractorId }, Number(agreement.id));
    if (docId) updateRecord(amendDef, Number(row.id), { library_doc_id: docId }, user, "import", { bypassRoles: true });
    result.entries.push({ action: existingAmend ? "updated" : "created", id: Number(row.id), label: `Amendment No ${no} – lease ${updated.agreement_no}`, description: `${updated.contractor_id__label ?? p.tenant} – current fee ${show(updated.current_fee)} SAR, current expiry ${updated.current_expiry ? formatDate(String(updated.current_expiry)) : "–"}`, programme: a.programme.name, files: [p.name], read: readValues, missing: [] });
  }
  return result;
}
