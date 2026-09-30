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
const has = (list: string[], w: string) => list.some((x) => sameWord(x, w));

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
  const hits = contractors.filter((c) => {
    const cw = coreWords(c.name);
    if (!cw.length) return false;
    // one word ("Depa", "STUDIO"): only a contractor whose name is that word, or one of our contract
    // holders whose name starts with it ("DEPA Saudi Arabia for Contracting …")
    if (words.length === 1) return sameWord(cw[0], words[0]) && (cw.length === 1 || !!c.primary);
    const a = words.every((w) => has(cw, w));
    const b = cw.every((w) => has(words, w));
    return a || b;
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // the record on a cost report line wins, then the most words in common, then the closest name
    // (fewest words of its own beyond the tracker's); a dead heat is left alone
    const primary = hits.filter((c) => c.primary);
    if (primary.length === 1) return primary[0];
    const score = (c: { name: string }) => coreWords(c.name).filter((w) => has(words, w)).length;
    const extra = (c: { name: string }) => coreWords(c.name).length - score(c);
    const sorted = [...(primary.length ? primary : hits)].sort((x, y) => score(y) - score(x) || extra(x) - extra(y));
    return score(sorted[0]) > score(sorted[1]) || extra(sorted[0]) < extra(sorted[1]) ? sorted[0] : null;
  }
  return null;
}

/**
 * How the trackers name our project in their "Program" column: "Marina Village" / "Marinas" for The
 * Marina, "Marina - VBH" / "Village Boutique Hotel" for VBH. The other Marina-precinct projects
 * (RSMLI, AYC, MLH, MH3 …) are excluded from The Marina by name.
 */
export function projectNamePattern(ctx: Pick<RecoveryContext, "programmeCode" | "programmeName">): RegExp {
  const vbh = /boutique|\bvbh\b/i.test(ctx.programmeName) || /006$/.test(ctx.programmeCode);
  if (vbh) return /\bvbh\b|\bvhb\b|boutique/i;
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
  notes.push(`Accommodation invoice tracker${asOf ? ` as of ${asOf}` : ""}: ${kept} of ${total} lease agreements belong to ${ctx.programmeName} (matched by asset code ${ctx.programmeCode} or program name).`);
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
    ],
    notes,
    total,
    kept,
  };
}

/* ------------------------------------------------------------------ customs */

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
      const contractor = matchContractor(vendor, ctx.contractors);
      if (!contractor && !ours) continue;
      vendorRows++;
      const owned = contractor ? [...byKey.values()].filter((x) => x.contractor_id === contractor.name) : [];
      const own = frag ? byKey.get(`contract:${frag.toLowerCase()}`) : undefined;
      const rec: Rec = own ?? (owned.length === 1 ? owned[0] : (byKey.get(`vendor:${vendor.toLowerCase()}`) ?? { tracker_key: `vendor:${vendor.toLowerCase()}`, vendor, contractor_id: contractor?.name ?? null }));
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
  notes.push(`Customs recovery tracker${asOf ? ` as of ${asOf}` : ""}: ${kept} contract annotation(s) for ${ctx.programmeName} (asset codes ${ctx.programmeCode}) and ${vendorRows} vendor row(s) with customs figures for our contractors, ${out.length} row(s) in all.`);
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
    ],
    notes,
    total,
    kept,
  };
}

export { cellText };
