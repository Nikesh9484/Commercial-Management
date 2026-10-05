import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { createRecord, lookupOptions, updateRecord } from "../registers/engine";
import type { RecordRow, UserInfo } from "../registers/types";
import { positioned } from "../packs/extract";
import type { PosPage } from "../packs/positioned";
import { convertToPdf, convertible } from "../packs/convert";
import { matchAgainstRegisters } from "../library/read";
import { getAppContext } from "../context";
import { formatDate, formatMoney, todayIso } from "../format";
import { ocrAvailable, ocrPdfPages } from "../ocr";
import type { Decisions, Duplicate, FromDocsResult, Outcome, ReadValue } from "../from-docs-shared";
import { decide } from "../from-docs-shared";
import { attachBondDocuments } from "./documents";
import { contractorKey } from "./name-key";
import { extractText } from "../ear/extract";
import { readBondWithAi } from "./ai-read";

/**
 * A bond or an insurance policy read from its own document – the policy schedule, the certificate of
 * insurance, the bank guarantee, with or without the Aconex transmittal that sent it. The type, the
 * policy number, the insurer or bank, the insured contractor and its contract, the period and the
 * amount are read (scanned pages through OCR) and written to the Bonds & Insurance register. A policy
 * of the same type already held for that contractor is a duplicate: nothing is written until the
 * person says whether to replace it with the new details or keep the old. Bonds are standalone: they
 * are written whatever reporting period is open or selected.
 */

export interface DocFile {
  name: string;
  bytes: Buffer;
}
interface DocRead {
  name: string;
  kind: "policy" | "transmittal" | "unknown";
  text: string;
  programmeCode: string;
  acc: string;
  typeName: string;
  policyNo: string;
  issuer: string;
  start: string;
  expiry: string;
  amount: number | null;
  premium: number | null;
  aconex: string[];
  subject: string;
  contractLine: string;
  fromCompany: string;
  ocr: boolean;
  /** an amendment / endorsement letter: it changes an existing bond (its validity, its amount), it is not a new one */
  amendment: boolean;
  note: string;
}

const TYPES: [RegExp, string][] = [
  [/workmen'?s'? compensation|\bWC\b|workers'? compensation/i, "Workmen's Compensation"],
  [/professional indemnity|\bPI\b|\/PIS?\//i, "Professional Indemnity"],
  [/contractors'? all risks|erection all risks|\bCAR\b policy|\bEAR\b policy/i, "Contractors All Risks"],
  [/advance payment (bond|guarantee|security)/i, "Advance Payment Bond"],
  [/performance (bond|guarantee|security)/i, "Performance Bond"],
  [/retention (bond|guarantee)/i, "Retention Bond"],
  [/public[\s/-]*(and|&)?[\s/-]*products? liability|product liability/i, "Public-Product Liability"],
  [/comprehensive general liability|general liability|public liability|third party liability|\/PL\/|legal liabilit(?:y|ies)[^\n]{0,140}third part(?:y|ies)|third part(?:y|ies)[^\n]{0,80}liabilit/i, "Public/Third Party Liability"],
  [/employer'?s liability|\bGOSI\b/i, "Employer’s Liability & Supplementary GOSI Insurance"],
  [/protection (and|&) indemnity|\bP&I\b/i, "Protection & Indemnity"],
  [/marine (hull|cargo)|\bhull\b/i, "Marine & Hull"],
  [/motor (vehicle|fleet)|vehicle insurance/i, "Motor Vehicle Liability"],
  [/plant (and|&) (equipment|machinery)|contractor'?s plant/i, "Plant & Equipment"],
  [/trade licen[cs]e|commercial registration/i, "Trade License"],
];
const INSURERS = /(Gulf Insurance Group|\bGIG\b|MEDGULF|Buruj Cooperative Insurance|Buruj|Tawuniya|The Company for Cooperative Insurance|Walaa Cooperative|Walaa|Al ?Rajhi Takaful|Al ?Rajhi Bank|Malath|Salama|Allianz|AXA|Chubb|Wataniya|Arabian Shield|Saudi Re|Gulf General|United Cooperative Assurance|\bUCA\b|Saudi National Bank|\bSNB\b|Riyad Bank|\bSABB\b|Saudi Awwal Bank|Banque Saudi Fransi|Arab National Bank|Alinma Bank|Bank Al ?Jazira|Gulf International Bank|Emirates NBD|First Abu Dhabi Bank|Mashreq|HSBC|Standard Chartered|Citibank|Qatar National Bank|Bank Al ?Bilad|Saudi Investment Bank)/i;
const INSURER_NAME: Record<string, string> = { gig: "Gulf Insurance Group", buruj: "Buruj Cooperative Insurance Company", "the company for cooperative insurance": "Tawuniya", snb: "Saudi National Bank", sabb: "Saudi Awwal Bank (SABB)", uca: "United Cooperative Assurance" };

/** a type named in an exclusion ("Excluding … workmen's compensation and employer liability") is not the policy's type */
const EXCLUDED_NEAR = /(?:\bexcluding\b|\bexcluded\b|\bexclusions?\b|other than|not (?:covered|including|insured)|does not cover|no cover for)[^\n]{0,90}$/i;
/** the type the text names: the one named first, exclusion lines left out (the list's order breaks ties) */
function typeIn(text: string): string {
  let best: { name: string; at: number } | null = null;
  for (const [re, name] of TYPES) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) {
      const at = m.index ?? 0;
      if (EXCLUDED_NEAR.test(text.slice(Math.max(0, at - 100), at))) continue;
      if (!best || at < best.at) best = { name, at };
      break;
    }
  }
  return best?.name ?? "";
}

/** "E ndorsement" – a first letter the positioned reader set apart from its word */
const unsplit = (s: string) => s.replace(/\b([A-Za-z]) (?=[a-z]{3,}\b)/g, "$1");
/** the type a labelled line gives ("Type of Insurance : …", "Class of Business : …", a schedule heading "… Liability Insurance Policy") */
function labelledType(text: string): string {
  for (const m of text.matchAll(/(?:TYPE|CLASS|LINE|NATURE) OF (?:INSURANCE|BUSINESS|POLICY|COVER|BOND|GUARANTEE)|POLICY TYPE|TYPE OF (?:THE )?(?:BOND|GUARANTEE|SECURITY)|\bCOVER(?:AGE)?\s*:/gi)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 260).replace(/^\s*[:\-]?\s*/, "");
    const t = typeIn(after.split("\n").slice(0, 2).join(" "));
    if (t) return t;
  }
  // a heading: the policy's own title on its first lines
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (l.length > 8 && l.length < 120 && /(?:INSURANCE|POLICY|GUARANTEE|BOND|CERTIFICATE)/i.test(l) && !/excluding|exclusion/i.test(l)) {
      const t = typeIn(l);
      if (t) return t;
    }
  }
  return "";
}

const textOf = (pages: PosPage[]) => pages.map((p) => p.rows.map((r) => r.cells.map((c) => c.s).join(" ")).join("\n")).join("\n");
const num = (s: string) => Number(String(s).replace(/[^\d.]/g, ""));
const isoDate = (d: string, m: string, y: string) => `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** every date in the text, in order of appearance, as ISO */
function datesIn(text: string): { iso: string; at: number }[] {
  const out: { iso: string; at: number }[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    out.push({ iso: isoDate(m[1], m[2], m[3]), at: m.index ?? 0 });
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[\s\-,]+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
    if (mi < 0) continue;
    out.push({ iso: isoDate(m[1], String(mi + 1), m[3]), at: m.index ?? 0 });
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ iso: `${m[1]}-${m[2]}-${m[3]}`, at: m.index ?? 0 });
  return out.sort((a, b) => a.at - b.at);
}
function moneyNear(text: string, labels: RegExp, window = 260): number | null {
  for (const m of text.matchAll(labels)) {
    const slice = text.slice(m.index ?? 0, (m.index ?? 0) + window);
    const money = slice.match(/(?:S\.?A?\.?R\.?|SAR|ريال)\s*\.?\s*([\d,]{5,}(?:\.\d{2})?)|([\d,]{5,}(?:\.\d{2})?)\s*(?:SAR|S\.?R\.?)/i);
    if (money) {
      const n = num(money[1] ?? money[2]);
      if (n >= 1000) return n;
    }
  }
  return null;
}
const normType = (s: string) => s.toLowerCase().replace(/[’'`]/g, "").replace(/\band\b/g, "&").replace(/[^a-z0-9&]+/g, " ").trim();

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
  let text = textOf(pages);
  let ocr = false;
  // scanned pages carry no text: the first few are read by OCR
  const blank = pages.map((p, i) => ({ i: i + 1, len: p.rows.reduce((a, r) => a + r.cells.reduce((b, c) => b + c.s.length, 0), 0) })).filter((p) => p.len < 40).map((p) => p.i).slice(0, 6);
  if (blank.length && ocrAvailable()) {
    const read = await ocrPdfPages(pdf, blank);
    const extra = [...read.values()].filter((t) => t.trim().length > 20);
    if (extra.length) {
      text = `${extra.join("\n")}\n${text}`;
      ocr = true;
    }
  }
  // a second reading of the same pages (the text stream, not positions): where one reader splits a word
  // or scrambles a table the other usually has it whole – the labels are looked for in both
  let plain = "";
  if (isPdf) {
    try {
      plain = (await extractText(f.name, pdf)).text;
    } catch {
      plain = "";
    }
  }
  const scan = `${unsplit(text)}\n${plain}`;
  const head = text.slice(0, 6000);
  const isTransmittal = ((/MAIL TYPE/i.test(head.slice(0, 1500)) && /\bTransmittal\b/i.test(head.slice(0, 1500))) || /TRANSMIT-\d{6}/i.test(f.name)) && !/POLICY\s*(NUMBER|NO)|CERTIFICATE OF INSURANCE|GUARANTEE/i.test(head.slice(0, 1500));
  const aconex = [...new Set([...`${f.name}\n${text}`.matchAll(/\b([A-Z]{2,4}\d{5}-[A-Z]{3,8}-\d{6}|1TB\d{5}-\d{3}[A-Z]\d{2}-[A-Z]{2,4}-(?:INS|BND|BOND|INSC)-[A-Z]{2}-\d{4}(?:\[?C\d\]?)?)\b/g)].map((m) => m[1]))];
  const programmeCode = `${f.name}\n${text}`.match(/\b(1TB\d{5})\b/)?.[1] ?? "";
  const acc = `${f.name}\n${text}`.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1]?.toUpperCase() ?? "";
  const subject = text.match(/^(?:Re:|Subject:)\s*(.+)$/im)?.[1]?.trim() ?? text.match(/\n([^\n]{8,120}(?:INSURANCE|POLICY|BOND|GUARANTEE)[^\n]{0,60})\n/i)?.[1]?.trim() ?? "";
  const contractLine = text.match(/\bContract\s*\n\s*(\d{3}[A-Z]\d{2}[^\n]+)/)?.[1]?.trim() ?? "";
  const fromCompany = text.match(/\nFrom\s*\n\s*(?:Mrs?\.?\s+)?[^\n]+?\s+-\s+([^\n]+)/)?.[1]?.trim() ?? "";
  if (isTransmittal) return { name: f.name, kind: "transmittal", text, programmeCode, acc, typeName: TYPES.find(([re]) => re.test(subject))?.[1] ?? "", policyNo: "", issuer: "", start: "", expiry: "", amount: null, premium: null, aconex, subject, contractLine, fromCompany, ocr, amendment: false, note: `Aconex transmittal${subject ? ` – ${subject}` : ""}` };

  // the type: the schedule heading first, then anything in the document
  // the type: what the schedule labels it, its own heading, the first page, anything in the document, the file name
  let typeName = labelledType(scan) || typeIn(unsplit(head.slice(0, 2500))) || typeIn(scan) || typeIn(f.name);
  // the policy / bond number: the token nearest after its label, else the first policy-like token
  const token = /\b(?:[A-Z]{1,3}-[A-Z]\d{1,3}(?:-[A-Z0-9]{2,8}){2,}|\d{1,3}\/[A-Z]{1,4}\/\d{3,}(?:\/[A-Z0-9]+){0,4}|[A-Z]{1,3}\/\d{2,3}\/\d{4}\/\d{4,}(?:\/[A-Z0-9]+)*|\d{2,3}\/\d{3,4}\/\d{2,3}\/\d{2}\/\d{4,}|\d{2}\/[A-Z]{2,4}\/\d{4}\/\d{6}|[A-Z]{2,4}\d{7,}|[A-Z]\d{6,}(?:-\d{2,4})?|\d{2,4}(?:-\d{2,6}){2,}|[A-Z]{1,3}\d{2}\/\d{5,}|P\/\d{2}\/\d{4}\/\d{4}\/\d+(?:\/\d+)?)\b/g;
  let policyNo = "";
  // an amendment letter names the guarantee it changes ("L/G Reference J094812") and extends it ("extended until 31/05/2027")
  let amendment = /AMENDMENT (?:LETTER )?(?:OF|TO) (?:THE )?(?:LETTER OF )?GUARANTEE|WE HAVE AMENDED|AMENDMENT (?:NO|LETTER)\b|ENDORSEMENT (?:NO|SCHEDULE|PERIOD)|POLICY PERIOD EXTENSION|HEREBY EXTENDED|EXTENDED FOR A FURTHER PERIOD/i.test(unsplit(head) + plain.slice(0, 6000));
  for (const m of scan.matchAll(/(?:L\/G\s*(?:REFERENCE|REF\.?|NO\.?|NUMBER)|GUARANTEE\s*REF\.?\s*(?:NO\.?)?|(?:POLICY|BOND|GUARANTEE|CERTIFICATE)\s*(?:NUMBER|NO\.?|#|REF\.?)?)\s*[:\-.]?/gi)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 160);
    const t = after.match(token)?.[0];
    if (t && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      policyNo = t;
      break;
    }
  }
  if (!policyNo) policyNo = [...scan.matchAll(token)].map((m) => m[0]).find((t) => /\//.test(t) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) ?? "";
  policyNo = policyNo.replace(/\/P1S\//, "/PIS/").replace(/O/g, (c, i) => (/\d/.test(policyNo[i - 1] ?? "") && /\d/.test(policyNo[i + 1] ?? "") ? "0" : c));
  // the insurer or bank
  const named = text.match(/Insurer'?s? Name\s*[:\-]?\s*([^\n]{3,80})/i)?.[1]?.trim() ?? text.match(/issued by\s*[:\-]?\s*([^\n]{3,80})/i)?.[1]?.trim() ?? "";
  const known = (named.match(INSURERS) ?? text.match(INSURERS))?.[1] ?? "";
  const issuer1 = (INSURER_NAME[known.toLowerCase()] ?? known ?? named).trim();
  // the period: a FROM–TO line, a dated pair on one line (effective – expiry), or a labelled expiry;
  // a pack holding several certificates (renewals) keeps the latest expiry
  let start = "";
  let expiry = "";
  const spans: { start: string; expiry: string }[] = [];
  for (const m of text.matchAll(/\bFROM\s*:?\s*([^\n]{6,30}?)\s*(?:\n\s*)?(?:TO|UNTIL|-)\s*:?\s*([^\n]{6,30})/gi)) {
    const a = datesIn(m[1])[0]?.iso ?? "";
    const b = datesIn(m[2])[0]?.iso ?? "";
    if (a && b && a < b) spans.push({ start: a, expiry: b });
  }
  for (const line of text.split("\n")) {
    const ds = datesIn(line);
    if (ds.length === 2 && ds[0].iso < ds[1].iso) spans.push({ start: ds[0].iso, expiry: ds[1].iso });
  }
  for (const m of text.matchAll(/(?:EXPIR\w*|VALID (?:UNTIL|TILL|UP ?TO)|UNTIL|DATE OF EXPIRY)\s*(?:DATE)?\s*:?[^\n]{0,40}\n?[^\n]{0,60}/gi)) {
    const d = datesIn(m[0])[0]?.iso;
    if (d) spans.push({ start: "", expiry: d });
  }
  // an extension: "extended until 31/05/2027", "extended for a further period … from 06/05/2026 to 31/08/2026",
  // "Endorsement Period : From … To …" – a pack of several endorsements keeps the latest date
  const extensions: string[] = [];
  for (const m of scan.matchAll(/(?:EXTENDED|VALID|RENEWED)\s+(?:UNTIL|TO|UP\s*TO|TILL)\s*:?\s*([^\n]{6,30})/gi)) extensions.push(datesIn(m[1])[0]?.iso ?? "");
  for (const m of scan.matchAll(/(?:EXTENDED FOR A FURTHER PERIOD|PERIOD OF EXTENSION|(?:ENDORSEMENT|EXTENSION|EXTENDED) PERIOD)[^\n]{0,60}?FROM\s*:?\s*([^\n]{6,30}?)\s*(?:TO|UNTIL|-)\s*:?\s*([^\n]{6,30})/gi)) extensions.push(datesIn(m[2])[0]?.iso ?? "");
  const extendedTo = extensions.filter(Boolean).sort().pop() ?? "";
  if (amendment && extendedTo) {
    spans.length = 0;
    spans.push({ start: "", expiry: extendedTo });
  }
  if (spans.length) {
    const best = [...spans].sort((a, b) => (a.expiry > b.expiry ? -1 : 1))[0];
    expiry = best.expiry;
    start = best.start || spans.filter((x) => x.start && x.expiry === expiry)[0]?.start || "";
  }
  if (!expiry) {
    // "PERIOD OF INSURANCE : FROM … TO dd/mm/yyyy" split over cells: the latest date in the schedule
    const all = datesIn(head);
    if (all.length >= 2) expiry = [...all].sort((a, b) => (a.iso > b.iso ? -1 : 1))[0].iso;
  }
  if (!start && expiry) {
    const all = datesIn(head).filter((d) => d.iso < expiry);
    // a year or so before the expiry is the inception; the issue date sits between
    const year = all.filter((d) => d.iso >= `${Number(expiry.slice(0, 4)) - 2}` && d.iso < expiry).sort((a, b) => (a.iso < b.iso ? -1 : 1));
    start = year[0]?.iso ?? "";
  }
  if (amendment) {
    // the entry's start stays the day the policy was first put in place: the original period, when the endorsement gives it
    const orig = scan.match(/(?:ORIGINAL POLICY PERIOD|INCEPTION DATE|ORIGINAL PERIOD|POLICY PERIOD)\s*:?\s*(?:FROM\s*:?\s*)?([^\n]{6,30})/i);
    const d = orig ? (datesIn(orig[1])[0]?.iso ?? "") : "";
    if (d) start = d;
  }
  if (start && expiry && start >= expiry) start = "";
  // the amount and the premium
  // a bank's own capital in its footer ("Capital of SAR 25,000,000,000") is never the bond
  const cleaned = text.replace(/CAPITAL\s+(?:OF\s+)?(?:S\.?A?\.?R\.?|SAR)?\s*[\d,]{7,}(?:\.\d{2})?/gi, " ").replace(/(?:S\.?A?\.?R\.?|SAR)\s*[\d,]{7,}(?:\.\d{2})?\s*(?:CR\.|C\.R\.|COMMERCIAL REGISTRATION)/gi, " ");
  const amendedAmount = amendment ? moneyNear(cleaned, /(?:NEW|AMENDED|REVISED|INCREASED|REDUCED)\s+(?:GUARANTEE\s+)?AMOUNT|AMOUNT\s+(?:HAS BEEN\s+)?(?:AMENDED|REVISED|INCREASED|REDUCED)/gi, 200) : null;
  const amountRead = amendment
    ? amendedAmount
    : (moneyNear(cleaned, /LIMIT OF (?:INDEMNITY|LIABILITY)|SUM INSURED|(?:BOND|GUARANTEE|SECURITY|L\/G|CURRENT) (?:AMOUNT|VALUE)|AMOUNT OF (?:THE )?(?:BOND|GUARANTEE)|TOTAL SUM INSURED|MAXIMUM AMOUNT|FOR THE SUM OF|AMOUNT NOT EXCEEDING|UP TO (?:AN AMOUNT|THE AMOUNT)/gi) ??
      (() => {
        const sums = [...cleaned.matchAll(/(?:S\.?A?\.?R\.?|SAR)\s*\.?\s*([\d,]{7,}(?:\.\d{2})?)/gi)].filter((m) => !/premium/i.test(cleaned.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0))).map((m) => num(m[1]));
        return sums.length ? Math.max(...sums) : null;
      })());
  // no bond on these projects runs to billions: such a figure is a misread
  const amount1 = amountRead !== null && amountRead > 2_000_000_000 ? null : amountRead;
  const premium = moneyNear(text, /TOTAL PREMIUM|PREMIUM/gi, 120);
  // the reading engine's view of the same document, where it is on: a value is taken over only when the
  // document carries it (the number's digits, the date, the type name) – the rules keep the rest
  let amount2 = amount1;
  let expiry2 = expiry;
  let start2 = start;
  let issuer2 = issuer1;
  try {
    const ai = await readBondWithAi(f.name, scan.slice(0, 60_000));
    if (ai) {
      const digitsOf = (v: string) => v.replace(/\D/g, "");
      const tn = typeIn(ai.type_of_cover);
      if (tn) typeName = tn;
      const no = ai.policy_or_guarantee_no.trim();
      if (no && digitsOf(no).length >= 5 && scan.replace(/\s+/g, "").toUpperCase().includes(no.replace(/\s+/g, "").toUpperCase())) policyNo = no;
      const dates = new Set(datesIn(scan).map((d) => d.iso));
      if (/^\d{4}-\d{2}-\d{2}$/.test(ai.expiry_date) && dates.has(ai.expiry_date) && (!expiry2 || ai.is_amendment || ai.document_kind.startsWith("endorsement") || ai.expiry_date >= expiry2)) expiry2 = ai.expiry_date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(ai.inception_date) && dates.has(ai.inception_date) && (!start2 || ai.inception_date < start2) && (!expiry2 || ai.inception_date < expiry2)) start2 = ai.inception_date;
      if (ai.amount && ai.amount >= 1000 && ai.amount <= 2_000_000_000 && scan.replace(/[,\s]/g, "").includes(String(Math.round(ai.amount)))) amount2 = ai.amount;
      if (!issuer2 && ai.insurer_or_bank.trim()) issuer2 = ai.insurer_or_bank.trim().slice(0, 80);
      if (ai.is_amendment || /^(endorsement|amendment)/.test(ai.document_kind)) amendment = true;
      else if (ai.document_kind === "insurance policy or certificate" || ai.document_kind === "bank guarantee or bond") amendment = amendment && !!extendedTo;
    }
  } catch (e) {
    console.error("bond document – engine reading skipped:", f.name, e instanceof Error ? e.message : e);
  }
  const amount = amount2;
  expiry = expiry2;
  start = start2;
  const issuer = issuer2;
  const note = `${amendment ? "amendment to " : ""}${typeName || "bond / insurance"}${policyNo ? ` No ${policyNo}` : ""}${issuer ? ` – ${issuer}` : ""}${expiry ? `, ${amendment ? "validity extended to" : "expires"} ${formatDate(expiry)}` : ""}${ocr ? " (scanned pages read by OCR)" : ""}`;
  const kind = typeName || policyNo ? "policy" : "unknown";
  return { name: f.name, kind, text, programmeCode, acc, typeName, policyNo, issuer, start, expiry, amount, premium, aconex, subject, contractLine, fromCompany, ocr, amendment, note: kind === "unknown" ? "not recognised as a bond or an insurance policy – kept out" : note };
}

interface Plan {
  key: string;
  docs: DocRead[];
  programme: { id: number; code: string; name: string };
  record: Record<string, unknown>;
  existing: RecordRow | null;
  read: ReadValue[];
  missing: string[];
  label: string;
  differences: { label: string; old: string; new: string }[];
  amendment: boolean;
  /** the document carries the number of a policy or bond already on the register: a renewal or extension of it */
  sameNumber: boolean;
}

/** a document dropped on one row of the register: it updates that row (already filed with it) */
export interface BondTarget {
  bondId: number;
}

export async function addBondsFromDocuments(files: DocFile[], user: UserInfo, decisions: Decisions = {}, target: BondTarget | null = null): Promise<FromDocsResult> {
  const db = getDb();
  const def = getRegisterDef("bonds")!;
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
  const types = lookupOptions(db, "bond_types", true);
  const typeIdOf = (name: string, preferred: number[] = []) => {
    const n = normType(name);
    const hits = types.filter((t) => normType(t.label) === n || normType(t.label).replace(/s\b/g, "") === n.replace(/s\b/g, ""));
    return hits.find((h) => preferred.includes(h.id))?.id ?? hits[0]?.id ?? types.find((t) => normType(t.label).includes(n.split(" ")[0]))?.id ?? null;
  };

  // one entry per policy document; a transmittal joins the policy of the same contractor (or type)
  const policies = reads.filter((r) => r.kind === "policy");
  const transmittals = reads.filter((r) => r.kind === "transmittal");
  const plans: Plan[] = [];
  for (const p of policies) {
    const code = p.programmeCode || transmittals.find((t) => t.programmeCode)?.programmeCode || "";
    const targetRow = target ? ((db.prepare("SELECT * FROM bonds WHERE id = ?").get(target.bondId) as RecordRow | undefined) ?? null) : null;
    const programme = (targetRow ? programmes.find((x) => x.id === Number(targetRow.programme_id)) : null) ?? programmes.find((x) => x.code === code) ?? app.programme;
    if (!programme) {
      result.warnings.push(`${p.name}: no project could be told from the document and none is selected in the top bar.`);
      continue;
    }
    const match = matchAgainstRegisters(db, programme.id, p.text.slice(0, 40_000), p.name, { code: p.acc });
    const mates = transmittals.filter((t) => {
      const m = matchAgainstRegisters(db, programme.id, `${t.contractLine}\n${t.fromCompany}\n${t.text.slice(0, 20_000)}`, t.name, { code: t.acc });
      return (m.contractor_id && m.contractor_id === match.contractor_id) || (t.acc && t.acc === p.acc) || (t.typeName && t.typeName === p.typeName && transmittals.length === 1 && policies.length === 1);
    });
    const docs = [p, ...mates];
    const contract = match.contract_id ? (db.prepare("SELECT id, title, contractor_id, package_id, cost_line_id, original_contract FROM contracts WHERE id = ?").get(match.contract_id) as { id: number; title: string; contractor_id: number | null; package_id: number | null; cost_line_id: number | null; original_contract: number | null } | undefined) : undefined;
    const line = contract?.cost_line_id ? (db.prepare("SELECT id, package_id, contractor_id FROM cost_lines WHERE id = ?").get(contract.cost_line_id) as { id: number; package_id: number | null; contractor_id: number | null } | undefined) : undefined;
    const contractorId = contract?.contractor_id ?? line?.contractor_id ?? match.contractor_id ?? null;
    const packageId = line?.package_id ?? contract?.package_id ?? (contractorId ? ((db.prepare("SELECT package_id FROM contractors WHERE id = ?").get(contractorId) as { package_id: number | null } | undefined)?.package_id ?? null) : null);
    const contractorName = contractorId ? ((db.prepare("SELECT name FROM contractors WHERE id = ?").get(contractorId) as { name: string } | undefined)?.name ?? "") : "";
    const rows = db.prepare("SELECT * FROM bonds WHERE programme_id = ?").all(programme.id) as RecordRow[];
    // the contractor's bonds: by our contractor record, or by the same company name – the register can hold the
    // same company twice ("Al Saad General Contracting Co. Ltd." and "… (Jetty Works Package)")
    const nameOfId = new Map((db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
    const coKey = (n: unknown) => contractorKey(String(n ?? "").replace(/\(.*?\)/g, " ").split(/\s[-–]\s/)[0]);
    const myKey = coKey(contractorName || p.fromCompany);
    const sameCompany = (r: RecordRow) => {
      if (contractorId && Number(r.contractor_id) === contractorId) return true;
      const k = coKey(nameOfId.get(Number(r.contractor_id)));
      return !!k && !!myKey && (k === myKey || k.includes(myKey) || myKey.includes(k));
    };
    const mine = rows.filter(sameCompany);
    const typeId = typeIdOf(p.typeName, mine.map((r) => Number(r.type_id)));
    const typeLabel = types.find((t) => t.id === typeId)?.label ?? p.typeName;
    // the same policy, or a policy of the same type for the same contractor, already held
    const base = p.policyNo.split("/").slice(0, 3).join("/");
    const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
    const sameType = (r: RecordRow) => !!typeId && normType(types.find((t) => t.id === Number(r.type_id))?.label ?? "") === normType(typeLabel);
    const ofType = mine.filter(sameType);
    const squashed = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toUpperCase();
    const byNumber =
      mine.find((r) => p.policyNo && squashed(r.policy_no) === squashed(p.policyNo)) ??
      mine.find((r) => base.length > 6 && squashed(r.policy_no).startsWith(squashed(base))) ??
      mine.find((r) => digits(r.policy_no).length > 6 && digits(p.policyNo).startsWith(digits(r.policy_no))) ??
      // the same number under a prefix the document left out ("P-C01-25-50010-392776" held, "25-50010-392776" read)
      mine.find((r) => digits(p.policyNo).length >= 8 && digits(r.policy_no).endsWith(digits(p.policyNo))) ??
      // a distinctive number is the bond whatever contractor record it sits under
      (p.policyNo.replace(/\s+/g, "").length >= 6 ? rows.find((r) => squashed(r.policy_no) === squashed(p.policyNo)) ?? null : null);
    // the same number; else the bond of this type on the same contract line; else the contractor's only
    // bond of this type – never one of several (a contractor with three contracts has three performance bonds)
    // dropped on a row: that row is the entry – when the document is its policy (same number) or the same kind of
    // cover for the same company; a document of another policy or contractor changes nothing
    if (targetRow) {
      const okNumber = !!byNumber && Number(byNumber.id) === Number(targetRow.id);
      const okKind = sameCompany(targetRow) && (!typeId || sameType(targetRow));
      if (!okNumber && !okKind) {
        result.warnings.push(`${p.name}: reads as ${typeLabel || "a bond / insurance"}${p.policyNo ? ` No ${p.policyNo}` : ""}${contractorName ? ` for ${contractorName}` : ""} – not the entry it was added to (Ref ${targetRow.ref}, policy ${targetRow.policy_no ?? "–"}), so the entry was not changed. The document is kept with it; use "Add from documents" to file it where it belongs.`);
        continue;
      }
    }
    const existing =
      targetRow ??
      byNumber ??
      (contract?.cost_line_id ? (ofType.find((r) => Number(r.cost_line_id) === Number(contract.cost_line_id)) ?? null) : null) ??
      (!p.amendment && ofType.length === 1 && (!p.acc || !contract) ? ofType[0] : null);
    if (p.amendment && !existing) {
      result.warnings.push(`${p.name}: an amendment to bond ${p.policyNo || "(number not read)"} – no bond with that number (or on that contract) is on the register for ${contractorName || "this contractor"}, so nothing was changed. Add the original bond first, then upload the amendment again.`);
      continue;
    }
    // the same number read by OCR with a letter wrong (PTS for PIS) or an endorsement suffix is the register's number
    if (existing && p.ocr && digits(existing.policy_no).length > 6 && digits(p.policyNo).startsWith(digits(existing.policy_no))) p.policyNo = String(existing.policy_no);
    if (p.premium && p.amount && p.premium > p.amount * 0.5) p.premium = null;

    const read: ReadValue[] = [];
    const push = (label: string, value: string | number | null | undefined, from = p.name) => {
      if (value !== null && value !== undefined && value !== "") read.push({ label, value: String(value), from });
    };
    const sameNumber = (!!byNumber || !!targetRow) && !p.amendment;
    if (p.amendment) push("Document", `Amendment to bond ${p.policyNo || existing?.policy_no || ""} – the entry keeps its details, the validity${p.amount ? " and the amount" : ""} follow the amendment`);
    else if (sameNumber) push("Document", `Policy ${existing?.policy_no ?? p.policyNo} is already on the register (Ref ${existing?.ref ?? ""}) – its validity${p.amount ? " and amount" : ""} follow this document; anything the entry lacks is filled in`);
    push("Type", typeLabel);
    push("Policy / bond no", p.policyNo);
    push("Issued by", p.issuer);
    push("Insured / contractor", contractorName || match.matched_by, contractorName ? "registers" : p.name);
    if (contract) push("Contract", `${contract.title}${p.acc ? ` (${p.acc})` : ""}`, "registers");
    push("Start date", p.start);
    push("Expiry date", p.expiry);
    push("Amount (SAR)", p.amount);
    push("Premium (SAR)", p.premium);
    for (const t of mates) push("Transmittal", `${t.aconex[0] ?? t.name}${t.subject ? ` – ${t.subject}` : ""}`, t.name);
    const missing: string[] = [];
    if (!typeId) missing.push("Type of bond / insurance");
    if (!p.policyNo) missing.push("Policy / bond number");
    if (!contractorId) missing.push("Contractor");
    if (!p.expiry) missing.push("Expiry date");
    if (!p.amount) missing.push("Amount provided");
    if (!p.issuer) missing.push("Issued by (bank / insurer)");

    const refs = [...new Set(docs.flatMap((d) => d.aconex))];
    const stamp = `Added from documents on ${formatDate(todayIso())} (${docs.map((d) => d.name).join("; ")})${refs.length ? ` – ${refs.join(" ")}` : ""}${p.premium ? ` – premium ${formatMoney(p.premium)} SAR` : ""}${p.ocr ? " – scanned pages read by OCR, please check the figures" : ""}`;
    const missingNote = missing.length ? `Not found in the documents – to be added by hand: ${missing.join(", ")}.` : "";
    // the ref follows the project's own pattern: G-<ACC>-n, else the next number
    const pattern = rows.map((r) => String(r.ref ?? "")).find((r) => /^G-\d{3}[A-Z]\d{2}-\d+$/i.test(r));
    const accOf = p.acc || (contract ? (String(contract.title).match(/\d{3}[A-Z]\d{2,3}(?!\d)/)?.[0] ?? "") : "");
    let ref: string;
    if (pattern && accOf) {
      const n = rows.map((r) => Number(String(r.ref ?? "").match(new RegExp(`^G-${accOf}-(\\d+)$`, "i"))?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0);
      ref = `G-${accOf}-${n + 1}`;
    } else {
      const n = rows.map((r) => Number(String(r.ref ?? "").match(/^(\d+)$/)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0);
      ref = String(n + 1);
    }
    const sample = mine[0];
    const record: Record<string, unknown> = {
      programme_id: programme.id,
      ref,
      contractor_id: contractorId,
      package_id: packageId,
      cost_line_id: contract?.cost_line_id ?? (sample?.cost_line_id as number | null) ?? null,
      type_id: typeId,
      policy_no: p.policyNo,
      issuer: p.issuer,
      original_contract_sum: contract?.original_contract ?? (sample?.original_contract_sum as number | null) ?? null,
      requirement_type: (sample?.requirement_type as string) ?? "Fixed SAR amount",
      requirement_value: p.amount ?? null,
      amount_provided: p.amount ?? null,
      start_date: p.start || null,
      expiry_date: p.expiry || null,
      approved: false,
      bank_verification: false,
      contract_closed: false,
      comments: [stamp, missingNote].filter(Boolean).join("\n"),
    };
    const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "number" ? formatMoney(v) : String(v));
    const differences = existing
      ? ([
          ["Policy / bond no", existing.policy_no, p.policyNo],
          ["Issued by", existing.issuer, p.issuer],
          ["Amount provided", existing.amount_provided, p.amount],
          ["Start date", existing.start_date, p.start],
          ["Expiry date", existing.expiry_date, p.expiry],
        ] as [string, unknown, unknown][])
          .filter(([label, o, n]) => show(o) !== show(n) && !(label === "Start date" && o))
          .map(([label, o, n]) => ({ label, old: show(o), new: show(n) }))
      : [];
    plans.push({ key: `bond:${programme.id}:${contractorId ?? "x"}:${existing ? `id${existing.id}` : normType(typeLabel) || p.policyNo}`, docs, programme, record, existing, read, missing: p.amendment ? [] : missing, label: `${p.amendment ? "Amendment – " : ""}${typeLabel || "Bond / insurance"} – ${contractorName || "contractor not matched"}`, differences: p.amendment ? differences.filter((d) => d.label === "Expiry date" || (p.amount && d.label === "Amount provided")) : differences, amendment: p.amendment, sameNumber });
  }
  for (const t of transmittals) if (!plans.some((pl) => pl.docs.includes(t))) result.warnings.push(`${t.name}: a transmittal on its own – upload the policy or certificate it sent with it.`);

  // a duplicate waits for a decision; nothing is written until every one has it
  const undecided = plans.filter((pl) => pl.existing && !pl.amendment && !pl.sameNumber && !decide(decisions, pl.key));
  if (undecided.length) {
    result.needsDecision = true;
    result.duplicates = undecided.map<Duplicate>((pl) => ({
      key: pl.key,
      existing: { id: Number(pl.existing!.id), label: `Ref ${pl.existing!.ref}`, detail: `${types.find((t) => t.id === Number(pl.existing!.type_id))?.label ?? ""} – policy ${pl.existing!.policy_no ?? "–"}, expires ${pl.existing!.expiry_date ? formatDate(String(pl.existing!.expiry_date)) : "–"}, ${pl.existing!.amount_provided ? formatMoney(Number(pl.existing!.amount_provided)) : "–"} SAR` },
      incoming: { label: pl.label, detail: `policy ${pl.record.policy_no || "–"}, expires ${pl.record.expiry_date ? formatDate(String(pl.record.expiry_date)) : "–"}, ${pl.record.amount_provided ? formatMoney(Number(pl.record.amount_provided)) : "–"} SAR` },
      differences: pl.differences,
      files: pl.docs.map((d) => d.name),
    }));
    return result;
  }
  for (const pl of plans) {
    const outcome = (action: Outcome["action"], row: RecordRow): Outcome => ({ action, id: Number(row.id), label: `Ref ${row.ref}`, description: pl.label, programme: pl.programme.name, files: pl.docs.map((d) => d.name), read: pl.read, missing: pl.missing });
    const attach = (bondId: number, note: string) => {
      const bytes = pl.docs.map((d) => files.find((f) => f.name === d.name)).filter((f): f is DocFile => !!f);
      if (bytes.length && !target) attachBondDocuments(bondId, bytes, user, note);
    };
    if (pl.existing) {
      if (decide(decisions, pl.key) === "keep") {
        attach(Number(pl.existing.id), "uploaded again – entry kept as it was");
        result.entries.push(outcome("kept", pl.existing));
        continue;
      }
      const patch: Record<string, unknown> = {};
      if (pl.amendment) {
        // only what the amendment changes: the validity, and the amount when it states a new one
        if (pl.record.expiry_date) patch.expiry_date = pl.record.expiry_date;
        if (pl.record.amount_provided) patch.amount_provided = pl.record.amount_provided;
        if (!pl.existing.start_date && pl.record.start_date) patch.start_date = pl.record.start_date;
        if (!pl.existing.issuer && pl.record.issuer) patch.issuer = pl.record.issuer;
        // the full number when the register holds it without its prefix ("25-50032-392774" for "P-C01-25-50032-392774")
        const dg = (v: unknown) => String(v ?? "").replace(/\D/g, "");
        if (pl.record.policy_no && dg(pl.existing.policy_no).length >= 6 && dg(pl.record.policy_no).endsWith(dg(pl.existing.policy_no)) && String(pl.record.policy_no).length > String(pl.existing.policy_no ?? "").length) patch.policy_no = pl.record.policy_no;
        const refs = [...new Set(pl.docs.flatMap((d) => d.aconex))];
        const said = `(${pl.docs.map((d) => d.name).join("; ")})${refs.length ? ` – ${refs.join(" ")}` : ""}: ${pl.record.expiry_date ? `validity extended to ${formatDate(String(pl.record.expiry_date))}` : "no new expiry read"}${pl.record.amount_provided ? `, amount ${formatMoney(Number(pl.record.amount_provided))} SAR` : ""}.`;
        // the same amendment read again (dropped on its row a second time) is noted once
        const before = String(pl.existing.comments ?? "").trim();
        patch.comments = before.includes(said) ? before : [before, `Amendment added from documents on ${formatDate(todayIso())} ${said}`].filter(Boolean).join("\n");
      } else {
        // a renewal or extension of the bond already held: the start date stays the date the bond was
        // first put in place (filled only when the entry has none); the number, bank, amount and expiry follow the new document
        for (const k of ["policy_no", "issuer", "amount_provided", "expiry_date"]) if (pl.record[k] !== null && pl.record[k] !== "" && pl.record[k] !== undefined) patch[k] = pl.record[k];
        // the same policy uploaded again (an older certificate of it, say) never takes the validity backwards
        if (pl.sameNumber && pl.existing.expiry_date && pl.record.expiry_date && String(pl.record.expiry_date) < String(pl.existing.expiry_date)) delete patch.expiry_date;
        if (!pl.existing.start_date && pl.record.start_date) patch.start_date = pl.record.start_date;
        if (!pl.existing.cost_line_id && pl.record.cost_line_id) patch.cost_line_id = pl.record.cost_line_id;
        if (!pl.existing.package_id && pl.record.package_id) patch.package_id = pl.record.package_id;
        const before = String(pl.existing.comments ?? "").trim();
        const files = `(${pl.docs.map((d) => d.name).join("; ")})`;
        // the same document read again is noted once
        const seen = before.split("\n").some((l) => l.includes(files) && (!pl.record.expiry_date || String(pl.existing!.expiry_date ?? "") === String(pl.record.expiry_date)));
        patch.comments = seen ? before : [before, `${pl.sameNumber ? "Updated from the policy's own document – " : "Replaced "}${String(pl.record.comments)}`].filter(Boolean).join("\n");
      }
      const row = updateRecord(def, Number(pl.existing.id), patch, user, "import", { bypassRoles: true });
      attach(Number(row.id), pl.amendment ? "amendment" : "replacement document");
      result.entries.push(outcome("updated", row));
    } else {
      const row = createRecord(def, pl.record, user, "import", { bypassRoles: true });
      attach(Number(row.id), "original document");
      result.entries.push(outcome("created", row));
    }
  }
  return result;
}
