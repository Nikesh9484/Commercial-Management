/**
 * Converters for the two cost-recovery trackers – uploaded when they change, not every month:
 *
 *  - The accommodation invoice tracker ("L.A. Invoice Tracker (W)" sheet): one row per lease
 *    agreement, with the cumulative invoiced / received / withheld / outstanding columns B–Z.
 *  - The AMAALA Customs Recovery Tracker ("Summary-Site Team to Enter" sheet): one row per vendor
 *    (columns A–H, the customs paid) and the commercial lead's contract annotations (K–AE).
 *
 * Both hold every project at AMAALA; only the rows that belong to the programme in the top bar are
 * kept – recognised by the asset code (1TB01031 / 1.TB.01.031 …), the program name on the row, or a
 * contractor of ours by name. The result is a clean sheet per register that the normal importer
 * maps 1:1, exactly like the monthly report and Claims Tracker converters.
 */
import type { SheetValues } from "./read";
import { cellText } from "./read";
import { cell, cols, date, findHeaderRow, findSheet, isNum, money, rows, txt, type ConvertedSheet, type Row, type Sheet } from "./marina";
import { contractorKey } from "../bonds/name-key";
import { nameWords } from "../bonds/closed";

export interface RecoveryContext {
  /** e.g. 1TB01031 */
  programmeCode: string;
  programmeName: string;
  /** contractors of the programme (from its cost lines and contractor register), for matching by name */
  contractors: KnownContractor[];
  /** cost lines of the programme, by contract code fragment (031C13) */
  linesByFrag: Map<string, { code: string; contractor: string }>;
  /** the file name, to read the "as of" date from */
  fileName: string;
}

export interface RecoveryResult {
  sheets: ConvertedSheet[];
  notes: string[];
  /** rows of every programme seen, and how many were kept */
  total: number;
  kept: number;
}

/* ------------------------------------------------------------------ helpers */

/** "1.TB.01.031.01", "1TB01031", " 1TB01031.01.CN.031C15" → "1TB01031" (the 8-character programme code). */
export function programmeCodeOf(text: unknown): string | null {
  const s = String(text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/(\d[A-Z]{2}\d{5})/);
  return m ? m[1] : null;
}

/** The date in a tracker's file name ("as of 2026.09.23", "As_of_2026.09.23", "R01 23-09-2026"). */
export function dateInFileName(name: string): string | null {
  const m = name.match(/(20\d\d)[._-](\d\d)[._-](\d\d)/) ?? name.match(/(\d\d)[._-](\d\d)[._-](20\d\d)/);
  if (!m) return null;
  const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const iso = `${y}-${mo}-${d}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Words of a company name without the legal-form filler, so "Al-Saad" finds "Al Saad General Contracting Co. Ltd." */
const NAME_FILLER = new Set(["company", "co", "ltd", "llc", "limited", "l", "wll", "inc", "sa", "sl", "as", "ag", "plc", "branch", "the", "and", "of", "for", "general", "contracting", "trading", "engineering", "services", "international", "saudi", "arabia", "arabian", "middle", "east", "partner", "partners", "consultants", "consulting"]);
function coreWords(name: unknown): string[] {
  return nameWords(String(name ?? "").replace(/\(.*?\)/g, " ").split(/\s[-–]\s/)[0]).filter((w) => !NAME_FILLER.has(w));
}
/** The same, keeping what follows a dash ("MME – Majestic Marine Engineering" → mme, majestic, marine). */
function coreWordsFull(name: unknown): string[] {
  return nameWords(String(name ?? "").replace(/\(.*?\)/g, " ")).filter((w) => !NAME_FILLER.has(w));
}

/** Two words of a company name that are the same bar a typo ("Khalleej" / "Khaleej"): one letter added, dropped or changed. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ra = a.slice(i + (a.length >= b.length ? 1 : 0));
  const rb = b.slice(i + (b.length >= a.length ? 1 : 0));
  return ra === rb;
}
/** The word is in the list: the same bar a typo, or – for long words – the same stem ("Industries" / "Industrial"). */
const has = (list: string[], w: string) => list.some((x) => sameWord(x, w) || (x.length >= 8 && w.length >= 8 && x.slice(0, 7) === w.slice(0, 7)));

export interface KnownContractor {
  id: number;
  name: string;
  /** on a cost report line of the programme – preferred when two records of one company both fit */
  primary?: boolean;
}

/**
 * Our contractor for a name on a tracker: the same squashed name, else the one whose identifying
 * words all appear in the tracker's name (or the other way round) – "MME Marine Engineering - Marina"
 * is "MME – Majestic Marine Engineering LLC", "Al-Saad" is "Al Saad General Contracting Co. Ltd.".
 * A tracker name that is one word ("STUDIO", "Spa") only matches a contractor whose whole
 * identifying name is that word, so a fragment never lands on a company that merely contains it.
 */
export function matchContractor(name: string, contractors: KnownContractor[]): KnownContractor | null {
  const key = contractorKey(name.replace(/\(.*?\)/g, " ").split(/\s[-–]\s/)[0]);
  const exact = contractors.filter((c) => contractorKey(c.name) === key);
  if (exact.length) return exact.find((c) => c.primary) ?? exact[0];
  const words = coreWords(name);
  if (!words.length) return null;
  const hits = contractorHits(words, contractors);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // the record on a cost report line wins, then the most words in common, then the closest name
    // (fewest words of its own beyond the tracker's); a dead heat is left alone
    const primary = hits.filter((c) => c.primary);
    if (primary.length === 1) return primary[0];
    const score = (c: { name: string }) => coreWords(c.name).filter((w) => has(words, w)).length;
    // words of the same stem ("Industries" / "Industrial") count a little: they tell "Nova Composites
    // Industries" from "Nova Composites Manufacturing" when the first words are the same
    const stem = (c: { name: string }) => coreWords(c.name).filter((w) => !has(words, w) && words.some((x) => x.length >= 6 && w.length >= 6 && x.slice(0, 6) === w.slice(0, 6))).length;
    const extra = (c: { name: string }) => coreWords(c.name).length - score(c) - stem(c);
    const sorted = [...(primary.length ? primary : hits)].sort((x, y) => score(y) - score(x) || stem(y) - stem(x) || extra(x) - extra(y));
    return score(sorted[0]) > score(sorted[1]) || stem(sorted[0]) > stem(sorted[1]) || extra(sorted[0]) < extra(sorted[1]) ? sorted[0] : null;
  }
  return null;
}

/**
 * How the trackers name our project in their "Program" column: "Marina Village" / "Marinas" for The
 * Marina, "Marina - VBH" / "Village Boutique Hotel" for VBH, "AYC" / "Yacht Club" for the Amaala Yacht
 * Club. The other Marina-precinct projects (RSMLI, MLH, MH3 …) are excluded from The Marina by name.
 */
export function projectNamePattern(ctx: Pick<RecoveryContext, "programmeCode" | "programmeName">): RegExp {
  const vbh = /boutique|\bvbh\b/i.test(ctx.programmeName) || /006$/.test(ctx.programmeCode);
  if (vbh) return /\bvbh\b|\bvhb\b|boutique/i;
  // Amaala Yacht Club: "AYC", "Yacht Club", "Program 1 - AYC"
  const ayc = /yacht|\bayc\b/i.test(ctx.programmeName) || /003$/.test(ctx.programmeCode);
  if (ayc) return /\bayc\b|yacht/i;
  return /^(?!.*(vbh|vhb|boutique|rsmli|ayc|mlh|mh3|hotel|lifestyle|precinct|yacht|infra))\s*marina/i;
}

const num = (v: Row | undefined, i: number) => money(v, i) ?? 0;
const pct = (v: Row | undefined, i: number) => {
  const x = cell(v, i);
  return isNum(x) ? Math.round(x * 10000) / 100 : null;
};

/* ------------------------------------------------------------------ accommodation */

export function looksLikeAccommodationTracker(sheets: SheetValues[]): boolean {
  const s = findSheet(sheets, "L.A. Invoice Tracker (W)", "L.A. Invoice Tracker", "Invoice Tracker") ?? sheets.find((x) => /invoice tracker/i.test(x.name));
  if (!s) return false;
  return findHeaderRow(s, "lease agreement sum", "name of consultant") !== null;
}

export function convertAccommodationTracker(sheets: SheetValues[], ctx: RecoveryContext): RecoveryResult {
  const notes: string[] = [];
  const s: Sheet | undefined = findSheet(sheets, "L.A. Invoice Tracker (W)", "L.A. Invoice Tracker", "Invoice Tracker") ?? sheets.find((x) => /invoice tracker/i.test(x.name));
  const out: unknown[][] = [];
  let total = 0;
  let kept = 0;
  let unmatchedOurs = 0;
  const asOf = dateInFileName(ctx.fileName);
  const namesOurProject = projectNamePattern(ctx);
  const isOurProgramme = (programName: string, assetRef: string, contractorName: string) => {
    const code = programmeCodeOf(assetRef);
    if (code === ctx.programmeCode.toUpperCase()) return true;
    // no asset code of ours on the row: the program name has to say which project it is, and the
    // company has to be one of our contractors
    return namesOurProject.test(programName) && !!matchContractor(contractorName, ctx.contractors);
  };
  if (s) {
    const hdr = findHeaderRow(s, "lease agreement sum", "name of consultant") ?? 6;
    for (const [r, v] of rows(s)) {
      if (r <= hdr + 3) continue;
      const name = txt(v, 3);
      const sr = txt(v, 2);
      if (!name || !sr || !/\d/.test(sr)) continue; // section rows ("A · Consultants") carry a letter
      total++;
      const programName = txt(v, 4);
      const assetRef = txt(v, 6);
      if (!isOurProgramme(programName, assetRef, name)) continue;
      kept++;
      const contractor = matchContractor(name, ctx.contractors);
      if (!contractor) unmatchedOurs++;
      const note = txt(v, 10);
      const status = /^closed/i.test(note) ? "Closed" : "Open";
      out.push([
        `${name}|${assetRef}`.toLowerCase(),
        name,
        contractor?.name ?? name,
        programName,
        assetRef,
        status,
        asOf,
        money(v, 7),
        txt(v, 8),
        txt(v, 9),
        note,
        num(v, 12),
        num(v, 13),
        num(v, 14),
        num(v, 15),
        pct(v, 16),
        num(v, 17),
        num(v, 18),
        num(v, 19),
        num(v, 20),
        num(v, 21),
        num(v, 22),
        num(v, 23),
        txt(v, 24) === "0" ? "" : txt(v, 24),
        num(v, 25),
        num(v, 26),
      ]);
    }
  }
  // The invoice sets: 18 columns per set to the right of the lease row ("Invoice Set No. 3 - January
  // 2025"), holding one invoice each – period, number, dates, amount, what came in and what is due.
  // The columns inside a set are not always in the same order, so each set is read by its labels.
  const invoices: unknown[][] = [];
  if (s) {
    const hdr = findHeaderRow(s, "lease agreement sum", "name of consultant") ?? 6;
    const titleRow = s.rows.get(hdr - 1) ?? [];
    const labelRow = s.rows.get(hdr) ?? [];
    const subRow = s.rows.get(hdr + 1) ?? [];
    const sets: { no: number; base: number; title: string }[] = [];
    titleRow.forEach((v, c) => {
      const m = /invoice set no\.?\s*(\d+)/i.exec(cellText(v));
      if (m) sets.push({ no: Number(m[1]), base: c - 2, title: cellText(v).trim() });
    });
    const find = (row: unknown[], base: number, re: RegExp) => {
      for (let c = Math.max(0, base); c < base + 18; c++) if (re.test(cellText(row[c]).toLowerCase())) return c;
      return -1;
    };
    const setCols = sets.map((st) => ({
      ...st,
      period: find(labelRow, st.base, /invoice period/),
      no: st.no,
      invNo: find(labelRow, st.base, /invoice no/),
      invDate: find(labelRow, st.base, /invoice date/),
      issuedFlag: find(labelRow, st.base, /inv\.? ?iss/),
      net: find(labelRow, st.base, /excl/),
      gross: find(labelRow, st.base, /incl/),
      issued: find(subRow, st.base, /issued date/),
      due: find(subRow, st.base, /^settlement date/),
      settled: find(subRow, st.base, /actual settlement/),
      overdue: find(subRow, st.base, /overdue/),
      received: find(subRow, st.base, /amount received/),
      confirmed: find(subRow, st.base, /confirmation/),
      balance: find(subRow, st.base, /balance of invoice/),
      offset: find(subRow, st.base, /offset/),
      withheld: find(subRow, st.base, /withheld/),
      remark: find(subRow, st.base, /remark/),
    }));
    for (const [r, v] of rows(s)) {
      if (r <= hdr + 3) continue;
      const name = txt(v, 3);
      const sr = txt(v, 2);
      if (!name || !sr || !/\d/.test(sr)) continue;
      const programName = txt(v, 4);
      const assetRef = txt(v, 6);
      if (!isOurProgramme(programName, assetRef, name)) continue;
      const leaseKey = `${name}|${assetRef}`.toLowerCase();
      const contractor = matchContractor(name, ctx.contractors);
      for (const sc of setCols) {
        const invNo = sc.invNo >= 0 ? txt(v, sc.invNo) : "";
        const gross = sc.gross >= 0 ? money(v, sc.gross) : null;
        const net = sc.net >= 0 ? money(v, sc.net) : null;
        if (!invNo && !gross && !net) continue;
        const issuedFlag = sc.issuedFlag >= 0 ? txt(v, sc.issuedFlag) : "";
        const issued = /^(1|y|yes|true)$/i.test(issuedFlag) || !!invNo;
        const received = (sc.received >= 0 ? money(v, sc.received) : null) ?? 0;
        const offset = (sc.offset >= 0 ? money(v, sc.offset) : null) ?? 0;
        const withheld = (sc.withheld >= 0 ? money(v, sc.withheld) : null) ?? 0;
        // the tracker's "Balance of invoice due" is received less invoiced: negative while money is owed,
        // positive when the contractor has overpaid – the register keeps what is still to pay
        const balanceCell = sc.balance >= 0 ? money(v, sc.balance) : null;
        const balance = Math.round(((balanceCell !== null ? -balanceCell : (gross ?? 0) - received - offset - withheld) as number) * 100) / 100;
        const due = sc.due >= 0 ? date(v, sc.due) : null;
        const settled = sc.settled >= 0 ? date(v, sc.settled) : null;
        const overdueCell = sc.overdue >= 0 ? money(v, sc.overdue) : null;
        const status = !issued ? "Not issued" : balance <= 0.5 ? "Paid" : received + offset + withheld > 0.5 ? "Part-paid" : "Unpaid";
        // the tracker's own overdue count when it has one (settled: how late; unpaid: at the tracker date),
        // else counted from the due date to the settlement or the tracker date
        let daysOverdue: number | null = overdueCell !== null ? Math.round(overdueCell) : null;
        if (daysOverdue === null) {
          if (status === "Paid") daysOverdue = due && settled ? daysApart(due, settled) : null;
          else if (status !== "Not issued" && due && asOf) daysOverdue = Math.max(0, daysApart(due, asOf));
        }
        invoices.push([
          `${leaseKey}|set${sc.no}|${invNo.toLowerCase()}`,
          leaseKey,
          name,
          contractor?.name ?? name,
          sc.no,
          sc.period >= 0 ? date(v, sc.period) : null,
          invNo,
          sc.invDate >= 0 ? date(v, sc.invDate) : null,
          sc.issued >= 0 ? date(v, sc.issued) : null,
          due,
          net,
          gross,
          status,
          received,
          sc.confirmed >= 0 ? txt(v, sc.confirmed) : "",
          offset,
          withheld,
          balance,
          settled,
          daysOverdue,
          sc.remark >= 0 ? txt(v, sc.remark) : "",
          asOf,
        ]);
      }
    }
  }
  notes.push(`Accommodation invoice tracker${asOf ? ` as of ${asOf}` : ""}: ${kept} of ${total} lease agreements belong to ${ctx.programmeName} (matched by asset code ${ctx.programmeCode} or program name), with ${invoices.length} invoice(s) from the invoice sets.`);
  if (unmatchedOurs) notes.push(`${unmatchedOurs} row(s) name a company that is not yet in our contractor list – they are added under the tracker's name; merge or rename them under Settings → Contractors if needed.`);
  return {
    sheets: [
      {
        name: "Accommodation Recovery",
        register: "accommodation_recovery",
        columns: cols([
          ["Tracker key", "tracker_key"],
          ["Name on the tracker", "tracker_name"],
          ["Contractor / Consultant", "contractor_id"],
          ["Program (tracker)", "program_name"],
          ["Asset code (tracker)", "asset_ref"],
          ["Status", "status"],
          ["Tracker as of", "tracker_date"],
          ["Lease agreement sum", "lease_sum"],
          ["Commercial lead", "commercial_lead"],
          ["Point of contact", "point_of_contact"],
          ["Tracker note", "note"],
          ["Assessment to date (net)", "assessment_to_date"],
          ["Invoiced to date (excl. VAT)", "invoiced_net"],
          ["Assessed, not yet invoiced", "not_yet_invoiced"],
          ["Invoiced to date (incl. VAT)", "invoiced_gross"],
          ["% received + recovered", "received_pct"],
          ["Received + recovered", "received_total"],
          ["Payments recorded by Finance", "received_recorded"],
          ["Confirmed by Finance", "confirmed_by_finance"],
          ["Awaiting Finance confirmation", "awaiting_confirmation"],
          ["Offset via IPC", "offset_via_ipc"],
          ["Outstanding", "outstanding"],
          ["Withheld under IPC", "withheld_in_ipc"],
          ["IPC ref", "ipc_ref"],
          ["Received, recovered + withheld", "received_plus_withheld"],
          ["To settle in the final account", "deemed_settled_fa"],
        ]),
        rows: out,
      },
      {
        name: "Accommodation Invoices",
        register: "accommodation_invoices",
        columns: cols([
          ["Tracker key", "tracker_key"],
          ["Lease agreement key", "lease_key"],
          ["Lease agreement (name on the tracker)", "tracker_name"],
          ["Contractor / Consultant", "contractor_id"],
          ["Invoice set", "set_no"],
          ["Occupancy period", "invoice_period"],
          ["Invoice no", "invoice_no"],
          ["Invoice date", "invoice_date"],
          ["Issued on", "issued_date"],
          ["Due date", "due_date"],
          ["Amount (excl. VAT)", "amount_net"],
          ["Amount (incl. VAT)", "amount_gross"],
          ["Status", "status"],
          ["Received (incl. VAT)", "received"],
          ["Confirmed by Finance", "confirmed_by_finance"],
          ["Offset via IPC", "offset_via_ipc"],
          ["Withheld under IPC", "withheld_in_ipc"],
          ["Unpaid", "balance_due"],
          ["Settled on", "actual_settlement_date"],
          ["Days overdue", "days_overdue"],
          ["Remark", "remark"],
          ["Tracker as of", "tracker_date"],
        ]),
        rows: invoices,
      },
    ],
    notes,
    total,
    kept,
  };
}

/** Calendar days from a to b (ISO dates). */
function daysApart(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

/* ------------------------------------------------------------------ customs */

/** "Supreme Rubber LLC" yes; "green", "2Modern", "STUDIO" no – a name with at least two real words, or one long distinctive word. */
export function looksLikeCompanyName(name: string): boolean {
  const words = name
    .replace(/[^A-Za-z0-9&]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(llc|ltd|limited|co|company|inc|corp|for|and|the|of|saudi|arabia|contracting|trading|general|branch|group|international|industries|industrial|services|l\.l\.c)$/i.test(w));
  return words.length >= 2 || words.some((w) => w.length >= 8);
}

/**
 * A supplier on a customs declaration is tied to a company only on a firm match: the same squashed
 * name, or every distinctive word of the company (at least two) present in the supplier's name.
 * "FOSTER GAMKO" is not Foster + Partners, and "Green Light Energy" is not "green".
 */
function matchSupplier(supplier: string, companies: KnownContractor[]): KnownContractor | null {
  const key = contractorKey(supplier);
  const exact = companies.find((c) => contractorKey(c.name) === key);
  if (exact) return exact;
  const sw = new Set(coreWords(supplier));
  let best: { c: KnownContractor; n: number } | null = null;
  for (const c of companies) {
    const cw = coreWords(c.name);
    if (cw.length < 2 || !cw.every((w) => sw.has(w))) continue;
    if (!best || cw.length > best.n) best = { c, n: cw.length };
  }
  return best?.c ?? null;
}

/** Every contractor a name could be, before the tie-break – more than one left means the name is ambiguous. */
function contractorHits(words: string[], contractors: KnownContractor[]): KnownContractor[] {
  return contractors.filter((c) => {
    const cw = coreWords(c.name);
    if (!cw.length) return false;
    // one word ("Depa", "STUDIO"): only a contractor whose name is that word (a typo allowed), or one of our
    // contract holders whose name starts with exactly it ("DEPA Saudi Arabia for Contracting …") –
    // "Rational" is not "National Center …"
    if (words.length === 1) return cw.length === 1 ? sameWord(cw[0], words[0]) : cw[0] === words[0] && !!c.primary;
    // every word of the tracker's name in the contractor's full name ("MME Marine Engineering" in "MME – Majestic Marine Engineering")
    const a = words.every((w) => has(coreWordsFull(c.name), w));
    // the other way round only for a name of two words or more: a company known by one word ("Foster",
    // "NAS") is not every vendor that happens to contain it ("Foster Refrigerator", "Qamrun Nas and Sons")
    const b = cw.length >= 2 && cw.every((w) => has(words, w));
    return a || b;
  });
}

/** Our contractors a tracker vendor could be when no single one fits (two Nova companies for "Nova Composites Industries"). */
export function contractorCandidates(name: string, contractors: KnownContractor[]): KnownContractor[] {
  if (!looksLikeCompanyName(name)) return [];
  const words = coreWords(name);
  if (!words.length) return [];
  const hits = contractorHits(words, contractors);
  if (hits.length >= 2) return hits;
  if (hits.length === 1) return [];
  // a looser look: the same first word and at least one more word in common ("Nova Composites Industries"
  // against "Nova Composite Industrial Company" and "Nova Composites Manufcturing")
  return contractors.filter((c) => {
    const cw = coreWordsFull(c.name);
    return cw.length >= 2 && sameWord(cw[0], words[0]) && words.filter((w) => has(cw, w)).length >= 2;
  });
}

/** The tracker's vendor cell is free text: a real company name is matched loosely, a stray word only when it is a contractor's exact name. */
function matchVendor(name: string, contractors: KnownContractor[]): KnownContractor | null {
  if (looksLikeCompanyName(name)) return matchContractor(name, contractors);
  const key = contractorKey(name);
  return (key && contractors.find((c) => contractorKey(c.name) === key)) || null;
}

/**
 * The sheets a tracker is read from, decided on a preview of its first rows – the AMAALA customs
 * tracker also carries pivots, rankings and untraceable-vendor lists that run to tens of thousands
 * of cells and are not needed; leaving them out keeps a 30 MB tracker within the server's memory.
 */
export function trackerReadPlan(preview: SheetValues[]): { sheets: RegExp[]; maxCols?: number } | null {
  if (looksLikeCustomsTracker(preview)) return { sheets: [/^summary/i, /^breakdown/i, /^detail1$/i], maxCols: 64 };
  if (looksLikeAccommodationTracker(preview)) return { sheets: [/invoice tracker/i] };
  return null;
}

export function looksLikeCustomsTracker(sheets: SheetValues[]): boolean {
  const s = findSheet(sheets, "Summary-Site Team to Enter", "Summary") ?? sheets.find((x) => /summary/i.test(x.name) && findHeaderRow(x, "customs", "vendor") !== null);
  if (!s) return false;
  return findHeaderRow(s, "vendor", "rsg paid") !== null || findHeaderRow(s, "vendor", "customs") !== null;
}

/** "1.TB.01.031.01" → "1TB01031"; "006C58" → "006C58". */
const fragOf = (code: string) => code.toUpperCase().replace(/\s+/g, "");

export function convertCustomsTracker(sheets: SheetValues[], ctx: RecoveryContext): RecoveryResult {
  const notes: string[] = [];
  const s = findSheet(sheets, "Summary-Site Team to Enter", "Summary") ?? sheets.find((x) => /summary/i.test(x.name) && findHeaderRow(x, "customs", "vendor") !== null);
  const asOf = dateInFileName(ctx.fileName);
  type Rec = Record<string, unknown>;
  const byKey = new Map<string, Rec>();
  let total = 0;
  let kept = 0;
  let vendorRows = 0;
  const ambiguous: string[] = [];
  if (s) {
    const hdr = findHeaderRow(s, "vendor", "customs") ?? 3;
    // The vendor block (A–H) and the commercial lead's block (K–AE) are not always on the same row
    // in a copy of the tracker, so each is read on its own: the contract annotations first, then the
    // vendor figures, which land on the contractor's annotated contract when it has exactly one.
    const all = rows(s).filter(([r]) => r > hdr);
    for (const [, v] of all) {
      const vendor = txt(v, 1);
      const asset = txt(v, 13);
      const contractCode = txt(v, 14);
      if (txt(v, 12) || asset || contractCode) total++;
      if (programmeCodeOf(asset) !== ctx.programmeCode.toUpperCase()) continue;
      kept++;
      const frag = contractCode ? fragOf(contractCode) : "";
      const line = frag ? ctx.linesByFrag.get(frag) : undefined;
      const key = frag ? `contract:${frag.toLowerCase()}` : `vendor:${vendor.toLowerCase()}`;
      const rec: Rec = byKey.get(key) ?? { tracker_key: key };
      Object.assign(rec, {
        vendor: vendor || rec.vendor || line?.contractor || contractCode,
        contractor_id: rec.contractor_id ?? (vendor ? matchContractor(vendor, ctx.contractors)?.name : undefined) ?? line?.contractor ?? null,
        contract_code: contractCode || rec.contract_code || null,
        cost_line_id: line?.code ?? rec.cost_line_id ?? null,
        asset_ref: asset || rec.asset_ref || null,
        legal_entity: txt(v, 15) || rec.legal_entity || null,
        action_lead: txt(v, 16) || rec.action_lead || null,
        notice_ref: txt(v, 17) || rec.notice_ref || null,
        contract_value: money(v, 18) ?? rec.contract_value ?? null,
        remaining_to_pay: money(v, 19) ?? rec.remaining_to_pay ?? null,
        customs_payer: txt(v, 20) || rec.customs_payer || null,
        other_contract_note: txt(v, 21) || rec.other_contract_note || null,
        actual_customs_cost: money(v, 22) ?? rec.actual_customs_cost ?? null,
        unrecoverable: money(v, 23) ?? rec.unrecoverable ?? null,
        recoverable_via_contractor: money(v, 24) ?? rec.recoverable_via_contractor ?? null,
        ps_exceeds: money(v, 25) ?? rec.ps_exceeds ?? null,
        pvo_ref: txt(v, 26) || rec.pvo_ref || null,
        pvo_date: date(v, 27) ?? rec.pvo_date ?? null,
        pvo_value: money(v, 28) ?? rec.pvo_value ?? null,
        ewn_ref: txt(v, 29) || rec.ewn_ref || null,
        ewn_value: money(v, 30) ?? rec.ewn_value ?? null,
        comments: txt(v, 31) || rec.comments || null,
      });
      byKey.set(key, rec);
    }
    for (const [, v] of all) {
      const vendor = txt(v, 1);
      if (!vendor || !(isNum(cell(v, 6)) || isNum(cell(v, 8)) || isNum(cell(v, 4)))) continue;
      const ours = programmeCodeOf(txt(v, 13)) === ctx.programmeCode.toUpperCase();
      const frag = ours && txt(v, 14) ? fragOf(txt(v, 14)) : "";
      const contractor = matchVendor(vendor, ctx.contractors);
      // a vendor that fits more than one of our contractors is kept under its own name, with the candidates noted
      const rivals = contractor ? [] : contractorCandidates(vendor, ctx.contractors);
      if (!contractor && !ours && !rivals.length) continue;
      vendorRows++;
      if (rivals.length) ambiguous.push(`${vendor} (${rivals.map((r) => r.name).join(" or ")})`);
      const owned = contractor ? [...byKey.values()].filter((x) => x.contractor_id === contractor.name) : [];
      const own = frag ? byKey.get(`contract:${frag.toLowerCase()}`) : undefined;
      const rec: Rec = own ?? (owned.length === 1 ? owned[0] : (byKey.get(`vendor:${vendor.toLowerCase()}`) ?? { tracker_key: `vendor:${vendor.toLowerCase()}`, vendor, contractor_id: contractor?.name ?? null }));
      if (rivals.length) rec.comments = [rivals.length > 1 ? `Vendor fits more than one of our contractors (${rivals.map((r) => r.name).join("; ")}) – tie it to the right contract on the tracker.` : `Vendor may be ${rivals[0].name} – confirm and tie it to the contract on the tracker.`, txt(v, 9)].filter(Boolean).join(" ");
      Object.assign(rec, {
        vendor: rec.vendor ?? vendor,
        vat_deferred: money(v, 2),
        vat_definitive: money(v, 3),
        customs_fasah: money(v, 4),
        customs_naif: money(v, 5),
        customs_rsg_paid: money(v, 6),
        customs_contractor_paid: money(v, 7),
        to_recover: money(v, 8),
      });
      if (!rec.comments && txt(v, 9)) rec.comments = txt(v, 9);
      byKey.set(String(rec.tracker_key), rec);
    }
  }
  const out: unknown[][] = [...byKey.values()].map((r) => [
    r.tracker_key,
    r.vendor,
    r.contractor_id,
    r.contract_code,
    r.cost_line_id,
    r.asset_ref,
    r.legal_entity,
    r.action_lead,
    r.contract_value,
    r.remaining_to_pay,
    r.customs_payer,
    r.other_contract_note,
    /closed/i.test(String(r.customs_payer ?? "")) ? "Closed" : "Open",
    asOf,
    r.vat_deferred ?? null,
    r.vat_definitive ?? null,
    r.customs_fasah ?? null,
    r.customs_naif ?? null,
    r.customs_rsg_paid ?? null,
    r.customs_contractor_paid ?? null,
    r.to_recover ?? null,
    r.actual_customs_cost,
    r.unrecoverable,
    r.recoverable_via_contractor,
    r.ps_exceeds,
    r.notice_ref,
    r.pvo_ref,
    r.pvo_date,
    r.pvo_value,
    r.ewn_ref,
    r.ewn_value,
    r.comments,
  ]);
  // The Breakdown sheet lists every customs declaration (Bayan) with its supplier and who paid the
  // duty; the ones whose supplier is one of our tracker vendors – or one of our contractors – are the
  // declarations behind each contractor's recovery.
  const declarations: unknown[][] = [];
  // every Breakdown sheet – the tracker keeps one per year ("Breakdown", "Breakdown (2025)") – and Detail1 as a fallback
  const breakdowns = sheets.filter((x) => /^breakdown/i.test(x.name.trim()));
  if (!breakdowns.length) {
    const d1 = findSheet(sheets, "Detail1");
    if (d1) breakdowns.push(d1);
  }
  const seen = new Set<string>();
  for (const breakdown of breakdowns) {
    const bh = findHeaderRow(breakdown, "bayan no", "who paid");
    if (bh === null) continue;
    const head = breakdown.rows.get(bh) ?? [];
    const col = (re: RegExp) => head.findIndex((v) => re.test(cellText(v).toLowerCase().replace(/\s+/g, " ").trim()));
    const c = {
      payDate: col(/^payment date/), stmtDate: col(/^statement date/), port: col(/^port/), type: col(/^type of statement/), duty: col(/^custom duties$/), bayan: col(/^bayan no/), broker: col(/^customs broker name/), supplier: col(/^manufacturer/), goods: col(/^sar value/), vat: col(/^value added tax/), who: col(/^who paid/), invoice: col(/^invoice no/), snb: col(/^rsg snb status/), rsgPaid: col(/^paid amount by rsg/), remarks: col(/^remarks/), contractorPaid: col(/^paid amount by contractor/), pvoAmt: col(/^pvo ?\/ ?dvo amount/), pvoRef: col(/^pvo ?\/ ?dvo reference/), code: col(/^contract code/), otherCode: col(/^if different contract/),
    };
    const vendorList: KnownContractor[] = [...byKey.values()].map((r, i) => ({ id: i + 1, name: String(r.vendor ?? "") })).filter((v) => looksLikeCompanyName(v.name));
    const recOfVendor = (v: KnownContractor) => [...byKey.values()][v.id - 1];
    for (const [, v] of rows(breakdown)) {
      const supplier = c.supplier >= 0 ? txt(v, c.supplier) : "";
      // the site team's contract code on the declaration ties it to our contract outright
      const codeCell = [c.otherCode, c.code].map((i) => (i >= 0 ? txt(v, i) : "")).find((x) => /\d{3}[A-Z]\d{2}/i.test(x)) ?? "";
      const codeFrag = codeCell ? /(\d{3}[A-Z]\d{2})/i.exec(codeCell.toUpperCase())?.[1] ?? "" : "";
      let rec: Rec | undefined = codeFrag ? byKey.get(`contract:${codeFrag.toLowerCase()}`) : undefined;
      if (!rec) {
        if (!supplier || !looksLikeCompanyName(supplier)) continue;
        const hit = matchSupplier(supplier, vendorList);
        rec = hit ? recOfVendor(hit) : undefined;
      }
      if (!rec) {
        // a supplier that is one of our contractors under its own name (the tracker's vendor row may be blank or garbled)
        const contractor = matchSupplier(supplier, ctx.contractors);
        if (contractor) rec = [...byKey.values()].find((r) => r.contractor_id === contractor.name);
      }
      if (!rec) continue;
      const bayan = c.bayan >= 0 ? txt(v, c.bayan) : "";
      const invoice = c.invoice >= 0 ? txt(v, c.invoice) : "";
      const payDate = c.payDate >= 0 ? date(v, c.payDate) : null;
      const key = `decl:${String(rec.tracker_key)}|${bayan}|${invoice}|${payDate ?? ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const who = c.who >= 0 ? txt(v, c.who) : "";
      declarations.push([
        key,
        rec.contractor_id ?? null,
        rec.vendor ?? supplier,
        rec.contract_code ?? null,
        rec.cost_line_id ?? null,
        payDate,
        c.stmtDate >= 0 ? date(v, c.stmtDate) : null,
        c.port >= 0 ? txt(v, c.port) : "",
        c.type >= 0 ? txt(v, c.type) : "",
        bayan,
        c.broker >= 0 ? txt(v, c.broker) : "",
        supplier,
        c.goods >= 0 ? money(v, c.goods) : null,
        c.vat >= 0 ? money(v, c.vat) : null,
        c.duty >= 0 ? money(v, c.duty) : null,
        /rsg/i.test(who) ? "RSG" : /contractor/i.test(who) ? "Contractor" : "Unknown",
        invoice,
        c.snb >= 0 ? txt(v, c.snb) : "",
        c.rsgPaid >= 0 ? money(v, c.rsgPaid) : null,
        c.contractorPaid >= 0 ? money(v, c.contractorPaid) : null,
        c.pvoRef >= 0 ? txt(v, c.pvoRef) : "",
        c.pvoAmt >= 0 ? money(v, c.pvoAmt) : null,
        c.remarks >= 0 ? txt(v, c.remarks) : "",
        asOf,
      ]);
    }
  }
  notes.push(`Customs recovery tracker${asOf ? ` as of ${asOf}` : ""}: ${kept} contract annotation(s) for ${ctx.programmeName} (asset codes ${ctx.programmeCode}) and ${vendorRows} vendor row(s) with customs figures for our contractors, ${out.length} row(s) in all; ${declarations.length} customs declaration(s) of theirs on the Breakdown sheet${breakdowns.length > 1 ? `s (${breakdowns.map((b) => b.name).join(", ")})` : ""}.`);
  if (ambiguous.length) notes.push(`${ambiguous.length} vendor(s) could not be tied to one contractor for certain and are listed under the vendor's own name until the tracker names the contract: ${ambiguous.join("; ")}.`);
  const noFigures = out.filter((r) => r[18] === null && r[20] === null).length;
  if (noFigures) notes.push(`${noFigures} contract(s) carry no customs figures yet on the tracker (the vendor's figures could not be tied to them): only the contract details are recorded.`);
  return {
    sheets: [
      {
        name: "Customs Recovery",
        register: "customs_recovery",
        columns: cols([
          ["Tracker key", "tracker_key"],
          ["Vendor / contractor on the tracker", "vendor"],
          ["Contractor / Consultant", "contractor_id"],
          ["Contract code", "contract_code"],
          ["Cost report line", "cost_line_id"],
          ["Asset code (tracker)", "asset_ref"],
          ["RSG legal entity", "legal_entity"],
          ["Action lead", "action_lead"],
          ["Contract value incl. variations", "contract_value"],
          ["Remaining to pay", "remaining_to_pay"],
          ["Who pays customs per contract", "customs_payer"],
          ["Paid under a different contract", "other_contract_note"],
          ["Status", "status"],
          ["Tracker as of", "tracker_date"],
          ["VAT deferred (Fasah)", "vat_deferred"],
          ["VAT definitive (Fasah)", "vat_definitive"],
          ["Customs (Fasah)", "customs_fasah"],
          ["Customs (Naif)", "customs_naif"],
          ["Customs paid by RSG", "customs_rsg_paid"],
          ["Customs paid by contractor", "customs_contractor_paid"],
          ["RSG / AMAALA to recover", "to_recover"],
          ["Actual customs cost by asset", "actual_customs_cost"],
          ["Unrecoverable", "unrecoverable"],
          ["Recoverable through contractor", "recoverable_via_contractor"],
          ["Customs PS exceeded", "ps_exceeds"],
          ["Notice of customs recovery", "notice_ref"],
          ["PVO / Employer notice ref", "pvo_ref"],
          ["PVO approved date", "pvo_date"],
          ["PVO value", "pvo_value"],
          ["EWN reference", "ewn_ref"],
          ["EWN value", "ewn_value"],
          ["Comments", "comments"],
        ]),
        rows: out,
      },
      {
        name: "Customs Declarations",
        register: "customs_declarations",
        columns: cols([
          ["Tracker key", "tracker_key"],
          ["Contractor / Consultant", "contractor_id"],
          ["Vendor on the tracker", "vendor"],
          ["Contract code", "contract_code"],
          ["Cost report line", "cost_line_id"],
          ["Payment date", "payment_date"],
          ["Statement date", "statement_date"],
          ["Port", "port"],
          ["Type of statement", "statement_type"],
          ["Bayan no", "bayan_no"],
          ["Customs broker", "broker"],
          ["Manufacturer / supplier", "supplier"],
          ["Goods value (SAR)", "goods_value"],
          ["VAT", "vat_amount"],
          ["Customs duty", "customs_duty"],
          ["Who paid", "paid_by"],
          ["Invoice no", "invoice_no"],
          ["RSG SNB status", "snb_status"],
          ["Paid by RSG", "rsg_paid"],
          ["Paid by contractor", "contractor_paid"],
          ["PVO / DVO reference", "pvo_dvo_ref"],
          ["PVO / DVO amount", "pvo_dvo_amount"],
          ["Remarks", "remarks"],
          ["Tracker as of", "tracker_date"],
        ]),
        rows: declarations,
      },
    ],
    notes,
    total,
    kept,
  };
}

export { cellText };

/* ------------------------------------------------------- one file, every project */

/**
 * The accommodation and customs trackers are one AMAALA-wide file: one upload fills every project at
 * once. Each project's rows are picked out with that project's own contractors and cost lines, then
 * laid into a single sheet whose last column names the project – the importer files every row under
 * it. The tracker key is prefixed with the project code so the two projects' rows never collide.
 */
export function convertRecoveryTrackers(sheets: SheetValues[], ctxs: RecoveryContext[], kind: "accommodation" | "customs"): RecoveryResult {
  const parts = ctxs.map((ctx) => ({ ctx, res: kind === "accommodation" ? convertAccommodationTracker(sheets, ctx) : convertCustomsTracker(sheets, ctx) }));
  if (!parts.length) return { sheets: [], notes: ["No project has been set up yet."], total: 0, kept: 0 };
  const merged = new Map<string, ConvertedSheet>();
  const notes: string[] = [];
  let total = 0;
  let kept = 0;
  for (const { ctx, res } of parts) {
    for (const sheet of res.sheets) {
      let target = merged.get(sheet.register);
      if (!target) {
        target = { name: sheet.name, register: sheet.register, columns: [...sheet.columns, { label: "Project", key: "programme_id" }], rows: [] };
        merged.set(sheet.register, target);
      }
      for (const r of sheet.rows) target.rows.push([`${ctx.programmeCode.toUpperCase()}|${String(r[0] ?? "")}`, ...r.slice(1), ctx.programmeCode]);
    }
    notes.push(...res.notes.map((n) => `${ctx.programmeName}: ${n}`));
    total = Math.max(total, res.total);
    kept += res.kept;
  }
  return { sheets: [...merged.values()], notes, total, kept };
}
