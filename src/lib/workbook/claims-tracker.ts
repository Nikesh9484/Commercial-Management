/**
 * Converter for the AMAALA CM "Claims Tracker" workbook (AMA-CM-FRM-0018, one sheet per programme
 * such as "Program_01"). Only the rows that belong to the programme / asset selected in the top bar
 * are kept (matched on the contract number, e.g. 1TB01031C02, and the asset code 1.TB.01.031.01),
 * and each one is linked to our cost report line by the contract code fragment (031C02).
 */
import type { SheetValues } from "./read";
import { cellText } from "./read";
import type { ConvertedSheet } from "./marina";

type Row = unknown[];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cell = (v: Row | undefined, i: number): unknown => (v && v.length > i ? v[i] : undefined);
const txt = (v: Row | undefined, i: number): string => {
  const x = cell(v, i);
  const s = x === null || x === undefined ? "" : String(x).trim();
  return /^(n\/?a|-|–|tbc|nil)$/i.test(s) ? "" : s;
};
const num = (v: Row | undefined, i: number): number | null => {
  const x = cell(v, i);
  if (isNum(x)) return Math.round(x * 100) / 100;
  const t = txt(v, i).replace(/,/g, "").replace(/SAR/i, "").trim();
  const n = Number(t);
  return t && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const inRange = (y: number) => y >= 2015 && y <= 2035;
function date(v: Row | undefined, i: number): string | null {
  const x = cell(v, i);
  if (x === null || x === undefined || x === "") return null;
  if (isNum(x)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(x) * 86400000);
    return inRange(d.getUTCFullYear()) ? d.toISOString().slice(0, 10) : null;
  }
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return inRange(Number(m[1])) ? s.slice(0, 10) : null;
  const m3 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m3 && inRange(Number(m3[3]))) return `${m3[3]}-${m3[2].padStart(2, "0")}-${m3[1].padStart(2, "0")}`;
  return null;
}
const flag = (v: Row | undefined, i: number) => {
  const x = cell(v, i);
  return x === 1 || x === true || /^(1|x|y|yes|true)$/i.test(txt(v, i));
};
const rowsOf = (s: SheetValues) => [...s.rows.entries()].sort((a, b) => a[0] - b[0]);
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normRef = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function headerRow(sheet: SheetValues): number | null {
  for (const [r, v] of rowsOf(sheet)) {
    const joined = v.map((x) => cellText(x).toLowerCase()).join(" | ");
    if (joined.includes("claim no") && joined.includes("assessment type") && joined.includes("contract no")) return r;
  }
  return null;
}

/** True when the workbook is a Claims Tracker (any sheet with the tracker's header row). */
export function looksLikeClaimsTracker(sheets: SheetValues[]): boolean {
  return sheets.some((s) => headerRow(s) !== null);
}

export interface KnownLine {
  /** Cost line code, e.g. CN.031C02-2 */
  code: string;
  package: string;
  contractor: string;
}

export interface ExistingClaim {
  claim_no: string;
  detail_letter_ref?: string | null;
  notice_letter_ref?: string | null;
  description?: string | null;
}

/** First 40 letters/digits of a description, for matching the same claim written slightly differently. */
const descKey = (s: string) => s.toLowerCase().replace(/\[(time|cost) claim\]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 40);

export interface ClaimsTrackerContext {
  programmeCode: string; // e.g. 1TB01031
  assetCode: string; // e.g. 1TB01031.01
  assetLabel: string; // value written to the Asset column (matched by code on import)
  /** Cost lines of the programme keyed by contract fragment, e.g. "031C02" */
  linesByFrag: Map<string, KnownLine>;
  existingClaims: ExistingClaim[];
}

export interface ClaimsTrackerResult {
  sheets: ConvertedSheet[];
  notes: string[];
  periodEnd: string | null;
  reportNo: number | null;
}

/** Contract fragment used in our cost line codes: "1TB01031C02" -> "031C02". */
export function contractFrag(contractNo: string, programmeCode: string): string {
  const c = normCode(contractNo);
  const p = normCode(programmeCode);
  const tail = c.startsWith(p) ? c.slice(p.length) : c.replace(/^1TB\d{5}/, "");
  return `${p.slice(-3)}${tail}`;
}

/** Fragment of one of our codes: "CN.031C02-2" -> "031C02", "PS.031D03" -> "031D03". */
export function codeFrag(code: string): string | null {
  const m = /(\d{3}[A-Z]\d{2})/i.exec(code.toUpperCase());
  return m ? m[1] : null;
}

export function convertClaimsTracker(sheets: SheetValues[], ctx: ClaimsTrackerContext): ClaimsTrackerResult {
  const notes: string[] = [];
  const out: unknown[][] = [];
  const prog = normCode(ctx.programmeCode);
  const asset = normCode(ctx.assetCode);
  let total = 0;
  let asOf: string | null = null;
  const byRef = new Map<string, string>();
  for (const c of ctx.existingClaims) {
    for (const r of [c.detail_letter_ref, c.notice_letter_ref]) if (r && normRef(String(r))) byRef.set(normRef(String(r)), c.claim_no);
  }
  const byDesc = new Map<string, string>();
  for (const c of ctx.existingClaims) {
    const k = c.description ? descKey(String(c.description)) : "";
    if (k.length >= 20 && !byDesc.has(k)) byDesc.set(k, c.claim_no);
  }
  const seen = new Set<string>();
  let matchedExisting = 0;
  let linked = 0;

  for (const sheet of sheets) {
    const hdr = headerRow(sheet);
    if (hdr === null) continue;
    for (const [r, v] of rowsOf(sheet)) {
      if (r <= hdr + 2) {
        const label = cellText(cell(v, 1)).toLowerCase();
        if (label.includes("as of")) asOf = date(v, 4) ?? asOf;
        continue;
      }
      if (!isNum(cell(v, 1)) || !txt(v, 3)) continue;
      total++;
      const contractNo = txt(v, 4);
      const assetCode = normCode(txt(v, 5));
      const mine = (contractNo && normCode(contractNo).startsWith(prog)) || (assetCode && assetCode === asset);
      if (!mine) continue;
      const n = Math.trunc(cell(v, 1) as number);
      const kind = txt(v, 2).toUpperCase();
      const isCost = kind.includes("COST");
      const frag = contractNo ? contractFrag(contractNo, ctx.programmeCode) : "";
      const line = frag ? ctx.linesByFrag.get(frag) : undefined;
      if (line) linked++;

      // Reuse an existing claim when its letter references match, so the monthly report's claims are updated, not duplicated.
      const detailRef = txt(v, 22);
      const noticeRef = txt(v, 16);
      let claimNo = `CT-${String(n).padStart(3, "0")}`;
      const hit = byRef.get(normRef(detailRef)) ?? byRef.get(normRef(noticeRef)) ?? byDesc.get(descKey(txt(v, 3)));
      if (hit && !seen.has(hit)) {
        claimNo = hit;
        matchedExisting++;
      }
      seen.add(claimNo);

      const st67 = txt(v, 67).toLowerCase();
      const st68 = txt(v, 68).toLowerCase();
      const rejected = st67.startsWith("cancel") || st68.startsWith("cancel") || txt(v, 72).toLowerCase().startsWith("merit") || txt(v, 54).toLowerCase() === "rejected" || txt(v, 44).toLowerCase() === "rejected";
      const approved = /determination issued|dvo issued|ei issued/.test(st68);
      const status = rejected ? "Rejected" : approved ? "Approved" : "Pending";

      const engRef = isCost ? txt(v, 48) || txt(v, 36) : txt(v, 36) || txt(v, 48);
      const engDate = isCost ? date(v, 49) ?? date(v, 37) : date(v, 37) ?? date(v, 49);
      const empRef = isCost ? txt(v, 51) || txt(v, 40) : txt(v, 40) || txt(v, 51);
      const empDate = isCost ? date(v, 52) ?? date(v, 41) : date(v, 41) ?? date(v, 52);
      const detRef = isCost ? txt(v, 54) || txt(v, 44) : txt(v, 44) || txt(v, 54);
      const detDate = isCost ? date(v, 55) ?? date(v, 45) : date(v, 45) ?? date(v, 55);
      const noteParts = [
        `Claims Tracker item ${n} (${txt(v, 2) || "claim"})`,
        txt(v, 67) ? `Assessment report: ${txt(v, 67)}` : "",
        txt(v, 68) ? `EI / DVO: ${txt(v, 68)}` : "",
        txt(v, 69) ? `Action with: ${txt(v, 69)}` : "",
        txt(v, 73).toLowerCase() === "yes" ? "Notice of Dissatisfaction: Yes" : "",
        txt(v, 74).toLowerCase() === "yes" ? "Notice of Dispute: Yes" : "",
        txt(v, 66) ? `Discretionary EOT: ${txt(v, 66)}` : "",
        txt(v, 70) ? `Remarks: ${txt(v, 70)}` : "",
      ].filter(Boolean);

      out.push([
        claimNo,
        `${txt(v, 3)}${isCost ? " [Cost claim]" : kind.includes("TIA") ? " [Time claim]" : ""}`,
        status,
        ctx.assetLabel,
        line?.contractor || txt(v, 8),
        contractNo,
        txt(v, 6),
        txt(v, 7),
        line?.package ?? "",
        line?.code ?? "",
        status === "Approved",
        flag(v, 9),
        flag(v, 10),
        flag(v, 11),
        flag(v, 12),
        flag(v, 13) || flag(v, 14),
        flag(v, 13) ? "Notice of Dissatisfaction" : flag(v, 14) ? "Other" : "",
        date(v, 15),
        noticeRef,
        date(v, 17),
        txt(v, 20),
        date(v, 21),
        detailRef,
        date(v, 23),
        txt(v, 26),
        date(v, 27),
        txt(v, 30),
        date(v, 31),
        num(v, 32),
        num(v, 33),
        num(v, 46),
        detailRef || noticeRef,
        date(v, 23) ?? date(v, 17),
        num(v, 34),
        num(v, 35),
        num(v, 47),
        engRef,
        engDate,
        num(v, 38),
        num(v, 39),
        num(v, 50),
        empRef,
        empDate,
        num(v, 42),
        num(v, 43),
        num(v, 53),
        detRef,
        detDate,
        noteParts.join(" · "),
      ]);
    }
  }

  notes.push(`Claims Tracker${asOf ? ` as of ${asOf}` : ""}: ${total} claim(s) in the file, ${out.length} belong to ${ctx.programmeCode} / ${ctx.assetCode} and were kept; the rest (other assets) were ignored.`);
  if (out.length) notes.push(`${linked} linked to a cost report line by contract code; ${matchedExisting} matched an existing claim by letter reference or description (updated), ${out.length - matchedExisting} new (numbered CT-###).`);
  if (out.length) notes.push("Pending claims are not carried in cost report column M (as in the Excel report, where they sit in the early warnings); only approved claims with a determined amount feed the cost report. Tick \"Carry in cost report\" on a claim to change that.");

  const columns = [
    ["Claim No", "claim_no"], ["Description", "description"], ["Status", "status"], ["Asset code", "asset_id"], ["Contractor / Consultant", "contractor_id"], ["Contract No", "contract_no"], ["Project", "project"], ["Scope", "scope"], ["Package", "package_id"], ["Cost report line", "cost_line_id"], ["Carry in cost report (M)", "in_cost_report"],
    ["Claim type: EOT", "type_eot"], ["Claim type: Prolongation", "type_prolongation"], ["Claim type: Disruption", "type_disruption"], ["Claim type: Acceleration", "type_acceleration"], ["Claim type: Other", "type_other"], ["Other – describe", "type_other_text"],
    ["(A) Date contractor became aware", "notice_aware_date"], ["Notice letter ref", "notice_letter_ref"], ["(B) Date received by RSG", "notice_received_date"], ["Engineer / Employer response ref", "notice_response_ref"], ["Response date", "notice_response_date"],
    ["Detailed claim letter ref", "detail_letter_ref"], ["(C) Date detailed claim received", "detail_received_date"], ["Engineer / Employer detailed response ref", "detail_response_ref"], ["Detailed response date", "detail_response_date"], ["Resubmission ref", "resubmission_ref"], ["Resubmission date", "resubmission_date"],
    ["Contractor EOT days", "contractor_eot_days"], ["Contractor compensable days", "contractor_compensable_days"], ["Contractor cost (SAR)", "contractor_cost"], ["Claim letter ref", "contractor_ref"], ["Claim date", "contractor_date"],
    ["Engineer EOT days", "engineer_eot_days"], ["Engineer compensable days", "engineer_compensable_days"], ["Engineer cost (SAR)", "engineer_cost"], ["Engineer letter ref", "engineer_ref"], ["Engineer date", "engineer_date"],
    ["Employer EOT days", "employer_eot_days"], ["Employer compensable days", "employer_compensable_days"], ["Employer cost (SAR)", "employer_cost"], ["Employer letter ref", "employer_ref"], ["Employer date", "employer_date"],
    ["Determination EOT days", "determination_eot_days"], ["Determination compensable days", "determination_compensable_days"], ["Determination cost (SAR)", "determination_cost"], ["Determination letter / VO ref", "determination_ref"], ["Determination date", "determination_date"],
    ["Notes", "notes"],
  ].map(([label, key]) => ({ label, key }));

  return { sheets: out.length ? [{ name: "Claims Tracker", register: "claims", columns, rows: out }] : [], notes, periodEnd: asOf, reportNo: null };
}
