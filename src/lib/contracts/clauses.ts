import { getDb } from "../db";

/**
 * Clause references for the notices, read from the contract documents in the Contract Library:
 * a notice cites "Clause 4.2 (Performance Security)" or "Schedule 12 (Insurance)" of the
 * contractor's own contract, and the periods its particulars set (the Defects Notification Period,
 * how long the Performance Bond and the Professional Indemnity insurance are to run). Nothing is
 * cited that the contract's text does not carry; where no contract document is filed, the
 * notice falls back to "the Contract".
 */

export type ClauseTopic =
  | "performance_security"
  | "bond_extension"
  | "insurance"
  | "insurance_schedule"
  | "professional_indemnity"
  | "dnp"
  | "remedying_defects"
  | "employer_claims"
  | "set_off"
  | "payment"
  | "customs"
  | "accommodation"
  | "lease_fee"
  | "lease_payment"
  | "lease_late";

export interface ClauseRef {
  topic: ClauseTopic;
  /** "4.2", "4.6.4", "Schedule 12" */
  clause: string;
  heading: string;
  /** a short sentence from the document, when the clause states the obligation outright */
  quote?: string;
}

export interface ContractTerms {
  docId: number;
  docTitle: string;
  contractCode: string;
  refs: Partial<Record<ClauseTopic, ClauseRef>>;
  /** months of the Defects Notification Period from taking over / completion, when the particulars state it */
  dnpMonths: number | null;
  /** "the Defects Completion Date", "Completion or as required by the Employer" – how long the Performance Bond runs */
  perfBondUntil: string | null;
  /** days before expiry by which an extension of the Performance Bond is to be lodged */
  bondExtensionBusinessDays: number | null;
  /** years after completion for which the Professional Indemnity insurance is to be kept */
  piYearsAfterCompletion: number | null;
  /** the period insured the insurance schedule states for the policies */
  insurancePeriod: string | null;
}

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ");
const sentence = (text: string, at: number, max = 320) => {
  const start = Math.max(0, text.lastIndexOf(". ", at) + 2);
  const endDot = text.indexOf(". ", at);
  const end = endDot < 0 ? Math.min(text.length, at + max) : Math.min(endDot + 1, start + max);
  return text.slice(start, end).trim();
};

/** "4.2 Performance Security" – a numbered heading whose title matches. */
function heading(text: string, title: RegExp, topic: ClauseTopic): ClauseRef | undefined {
  const re = new RegExp(`(?:^|[\\s\\n])(\\d{1,2}(?:\\.\\d{1,2}){0,2})\\s+(${title.source})(?=[\\s\\n.:(])`, title.flags.includes("i") ? "gi" : "g");
  // the contents page and the body both carry the heading: the clause number they agree on wins,
  // so a page number that happens to sit before the word ("55 Insurance") does not
  const seen = new Map<string, { n: number; ref: ClauseRef }>();
  for (const m of text.matchAll(re)) {
    const cur = seen.get(m[1]) ?? { n: 0, ref: { topic, clause: m[1], heading: titleCase(m[2]) } };
    cur.n++;
    seen.set(m[1], cur);
  }
  const best = [...seen.values()].sort((a, b) => b.n - a.n)[0];
  return best?.ref;
}
/** "Schedule 12 (Insurance)" */
function schedule(text: string, title: RegExp, topic: ClauseTopic): ClauseRef | undefined {
  const re = new RegExp(`Schedule\\s+\\[?(\\d{1,2})\\]?\\s*[(\\u2013\\u2014-]\\s*(${title.source})`, "i");
  const m = re.exec(text);
  return m ? { topic, clause: `Schedule ${m[1]}`, heading: titleCase(m[2]) } : undefined;
}
/** the clause number that precedes a stated obligation ("4.6.4 The Contractor shall procure that: the Performance Bond is in effect …") */
function clauseBefore(text: string, obligation: RegExp, topic: ClauseTopic, headingText: string): ClauseRef | undefined {
  const m = obligation.exec(text);
  if (!m || m.index === undefined) return undefined;
  const before = text.slice(Math.max(0, m.index - 400), m.index);
  const nums = [...before.matchAll(/(?:^|\s)(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(?=[A-Z(])/g)];
  const clause = nums.length ? nums[nums.length - 1][1] : "";
  return { topic, clause, heading: headingText, quote: sentence(text, m.index) };
}
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, "of").replace(/\bAnd\b/g, "and") : s.trim());
const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const numberOf = (w: string, d?: string) => (d ? Number(d) : words[w.toLowerCase()] ?? null);

export function readContractTerms(docId: number, docTitle: string, contractCode: string, rawText: string, kind: "contract" | "lease" = "contract"): ContractTerms {
  const text = norm(rawText);
  const refs: ContractTerms["refs"] = {};
  const LEASE_TOPICS: ClauseTopic[] = ["lease_fee", "lease_payment", "lease_late", "accommodation"];
  const put = (r?: ClauseRef) => {
    if (!r || !(r.clause || r.quote)) return;
    if ((kind === "lease") !== LEASE_TOPICS.includes(r.topic) && r.topic !== "accommodation") return;
    refs[r.topic] = r;
  };
  put(heading(text, /Performance Security|Performance Bond and Retention Bond|Performance Bond/i, "performance_security"));
  const PERF_UNTIL = /Performance Bond[^.;]{0,80}?(?:in (?:full force and )?effect|valid(?: and enforceable)?|remains? in force|maintained)[^.;]{0,40}?until ([^;.]{3,90})/i;
  const perf = clauseBefore(text, PERF_UNTIL, "performance_security", "Performance Security");
  const perfUntil = PERF_UNTIL.exec(text)?.[1]?.trim() ?? null;
  if (perf && !refs.performance_security?.clause && perf.clause) refs.performance_security = perf;
  else if (perf && refs.performance_security) refs.performance_security.quote = perf.quote;
  put(clauseBefore(text, /If the Performance Bond is due to expire[^.]*\./i, "bond_extension", "Extension of the Performance Bond"));
  const ext = /no later than (\w+)\s*\(?(\d{1,2})?\)?\s*Business Days prior to such expiry/i.exec(text);
  put(heading(text, /Insurances?|Contractor's Insurances/i, "insurance"));
  put(schedule(text, /Insurances?/i, "insurance_schedule"));
  put(heading(text, /Professional Indemnity Insurance/i, "professional_indemnity"));
  put(heading(text, /Defects Notification Period|Defects Liability Period/i, "dnp"));
  put(heading(text, /Completion of Outstanding Work and Remedying Defects|Remedying Defects|Defects Liability/i, "remedying_defects"));
  put(heading(text, /Employer's Claims/i, "employer_claims"));
  put(heading(text, /Set-?off|Set off and Withholding|Withholding/i, "set_off"));
  put(heading(text, /Interim Payments?|Payment of (?:the )?Contract Price|Application for (?:Interim )?Payment|Statements? and Payments?|Payment Terms|Payments?/i, "payment"));
  put(heading(text, /Customs(?: Duties| and Import Duties| Clearance)?|Taxes(?:,)? Duties and Levies|Taxes and Duties|Import Duties and Taxes/i, "customs"));
  put(heading(text, /Employer's Facilities|Accommodation(?: and Camp)?|Camp Facilities|Site Accommodation/i, "accommodation"));
  put(heading(text, /Lease Fee|Rent(?:al)?(?: Fee)?/i, "lease_fee"));
  put(heading(text, /Payment(?: Terms| of the Lease Fee)?|Invoicing(?: and Payment)?/i, "lease_payment"));
  put(heading(text, /Late Payment|Default Interest|Interest on Late Payment/i, "lease_late"));
  if (refs.dnp && /^1\.1$/.test(refs.dnp.clause) && /Schedule\s+1\s*[(–-]\s*Particulars/i.test(text)) refs.dnp = { ...refs.dnp, clause: "Schedule 1", heading: "Particulars – Defects Notification Period" };
  const dnp = /Defects Notification Period for the whole of the (?:Works|Products|Services)[^.]{0,120}?continues until (\d{1,3}) months? after/i.exec(text) ?? /Defects (?:Notification|Liability) Period[^.]{0,60}?(\d{1,3})\s*months?/i.exec(text);
  const piA = /Professional Indemnity Insurance[^.]{0,260}?(\w+)\s*\((\d{1,2})\)\s*years?\]?\d?\s*(?:from|after) (?:the )?completion/i.exec(text) ?? /during the duration of the Works and \[?(\w+)\s*\((\d{1,2})\)\s*years?\]?\d?\s*from the completion/i.exec(text);
  const piB = /(\d{1,2})-year period thereafter/i.exec(text);
  const insPeriod = /Period Insured:\s*From (?:the )?Commencement Date until ([^.]{5,140}?)(?:\.|Insured Value|Limit of Indemnity)/i.exec(text)?.[1]?.trim() ?? null;
  return {
    docId,
    docTitle,
    contractCode,
    refs,
    dnpMonths: dnp ? Number(dnp[1]) : null,
    perfBondUntil: perfUntil,
    bondExtensionBusinessDays: ext ? numberOf(ext[1], ext[2]) : null,
    piYearsAfterCompletion: piA ? numberOf(piA[1], piA[2]) : piB ? Number(piB[1]) : null,
    insurancePeriod: insPeriod,
  };
}

const CODE = /(\d{3}[A-Z]\d{2})/;
export const contractFrag = (s: unknown) => CODE.exec(String(s ?? "").toUpperCase())?.[1] ?? "";

type Row = { id: number; title: string; contract_code: string | null; contractor_id: number | null; doc_type: string | null; text_chars: number | null; updated_at: string | null };
const cache = new Map<string, ContractTerms | null>();

/**
 * The terms of a contractor's contract from the Contract Library: the document filed against the
 * contract code (a contract agreement first, then the largest contract document), else one filed
 * against the contractor. Null when nothing is filed.
 */
export function contractTermsFor(programmeId: number, opts: { contractCode?: string | null; contractorId?: number | null; leases?: boolean }): ContractTerms | null {
  const frag = contractFrag(opts.contractCode);
  const key = `${programmeId}|${frag}|${opts.contractorId ?? ""}|${opts.leases ? "lease" : "contract"}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let out: ContractTerms | null = null;
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT id, title, contract_code, contractor_id, doc_type, text_chars, updated_at FROM library_docs WHERE programme_id = ? AND library = 'contract' AND COALESCE(text_chars, 0) > 3000")
      .all(programmeId) as Row[];
    const isLease = (r: Row) => /lease/i.test(`${r.doc_type ?? ""} ${r.title}`);
    const pool = rows.filter((r) => (opts.leases ? isLease(r) : !isLease(r)));
    const rank = (r: Row) => (/contract agreement|agreement|lease agreement/i.test(r.doc_type ?? "") ? 2 : /scope|specification|drawing|addendum|query|tender/i.test(r.doc_type ?? "") ? 0 : 1);
    const byCode = frag ? pool.filter((r) => contractFrag(r.contract_code) === frag || contractFrag(r.title) === frag) : [];
    const byContractor = !byCode.length && opts.contractorId ? pool.filter((r) => Number(r.contractor_id) === Number(opts.contractorId)) : [];
    // the document that reads like the contract itself (particulars, conditions, bonds, defects period), not a
    // drawing or a specification filed under the same code – judged on its text, since the filed type may be off
    const SIGNALS = opts.leases ? [/Lease Fee/i, /Lease Agreement/i, /Tenant/i, /Term of the Lease|Lease Period/i] : [/Schedule\s+1\s*[(–-]\s*Particulars/i, /Conditions of Contract|Construction Contract|Supply (?:Agreement|Contract)|Consultancy Agreement|Framework Agreement/i, /Performance (?:Security|Bond)/i, /Defects Notification Period/i, /Employer's Claims/i, /Insurances?\b/i];
    const cands = [...byCode, ...byContractor].sort((a, b) => rank(b) - rank(a) || Number(b.text_chars ?? 0) - Number(a.text_chars ?? 0)).slice(0, 8);
    let best: { row: Row; text: string; score: number } | null = null;
    for (const r of cands) {
      const text = (db.prepare("SELECT text FROM library_docs WHERE id = ?").get(r.id) as { text: string | null } | undefined)?.text ?? "";
      const score = SIGNALS.filter((re) => re.test(text)).length + (rank(r) === 2 ? 1 : 0);
      if (score >= 2 && (!best || score > best.score)) best = { row: r, text, score };
    }
    if (best) out = readContractTerms(best.row.id, best.row.title, frag || contractFrag(best.row.contract_code), best.text, opts.leases ? "lease" : "contract");
  } catch {
    out = null;
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

/** "Clause 4.2 (Performance Security)", "Schedule 12 (Insurance)" – or null. */
export function cite(ref: ClauseRef | undefined | null): string | null {
  if (!ref || !ref.clause) return null;
  return /^Schedule/i.test(ref.clause) ? `${ref.clause} (${ref.heading})` : `Clause ${ref.clause} (${ref.heading})`;
}
/** "under Clause 4.2 (Performance Security) of the Contract" – or "under the Contract" when nothing is filed. */
export function under(ref: ClauseRef | undefined | null, what = "the Contract"): string {
  const c = cite(ref);
  return c ? `under ${c} of ${what}` : `under ${what}`;
}
/** A list of the clauses a notice relies on, for its closing line. */
export function citedList(refs: (ClauseRef | undefined | null)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    const c = cite(r);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out.join(", ");
}
