import type Database from "better-sqlite3";
import { codeFrag } from "../workbook/claims-tracker";
import type { RecoveryContext } from "../workbook/recovery";
import type { ClaimsTrackerContext, KnownLine } from "../workbook/claims-tracker";
import { getRegisterDef } from "../registers";
import { listRecords } from "../registers/engine";
import type { AconexContext } from "../workbook/aconex";
import { contractKey } from "./aconex-codes";
import { todayIso } from "../format";

/**
 * What the cost-recovery tracker converters need to know about each project: its contractors (from
 * the cost lines and the bond, final-account and early-warning registers) and its cost lines by
 * contract code. The accommodation and customs trackers are one AMAALA-wide file each, so the
 * converters run once per project and file every row under its own project.
 */
export function recoveryContextsFor(db: Database.Database, programmes: { id: number; code: string; name: string }[], fileName: string): RecoveryContext[] {
  return programmes.map((programme) => {
    const linesByFrag = new Map<string, { code: string; contractor: string }>();
    const contractors = new Map<number, { id: number; name: string; primary: boolean }>();
    const lines = db
      .prepare("SELECT l.code, l.contractor_id, c.name AS contractor FROM cost_lines l LEFT JOIN contractors c ON c.id = l.contractor_id WHERE l.programme_id = ? AND l.is_budget_hold IS NOT 1 ORDER BY COALESCE(l.approved_baseline_budget, 0) + COALESCE(l.opening_transfers, 0) DESC, l.sort_order, l.code")
      .all(programme.id) as { code: string; contractor_id: number | null; contractor: string | null }[];
    for (const l of lines) {
      const frag = codeFrag(l.code);
      if (frag && !linesByFrag.has(frag)) linesByFrag.set(frag, { code: l.code, contractor: l.contractor ?? "" });
      if (l.contractor_id && l.contractor) contractors.set(l.contractor_id, { id: l.contractor_id, name: l.contractor, primary: true });
    }
    for (const c of db.prepare("SELECT DISTINCT c.id, c.name FROM contractors c JOIN (SELECT contractor_id FROM bonds WHERE programme_id = ? UNION SELECT contractor_id FROM final_accounts WHERE programme_id = ? UNION SELECT contractor_id FROM early_warnings WHERE programme_id = ?) x ON x.contractor_id = c.id").all(programme.id, programme.id, programme.id) as { id: number; name: string }[]) if (!contractors.has(c.id)) contractors.set(c.id, { id: c.id, name: c.name, primary: false });
    return { programmeCode: programme.code, programmeName: programme.name, contractors: [...contractors.values()], linesByFrag, fileName };
  });
}

/** What the Aconex Cost converters need to know about a project: its contract lines by code (and by section and code) with their names, and its budget-hold lines by section. */
export function aconexContextFor(db: Database.Database, programme: { id: number; code: string; name: string }, fileName: string): AconexContext {
  const linesByFrag = new Map<string, { code: string; contractor: string }>();
  const holdLinesByKey = new Map<string, string>();
  const known: { code: string; name: string; contractor: string }[] = [];
  const lines = db
    .prepare("SELECT l.code, l.name, l.is_budget_hold, a.code AS asset, c.name AS contractor FROM cost_lines l JOIN assets a ON a.id = l.asset_id LEFT JOIN contractors c ON c.id = l.contractor_id WHERE l.programme_id = ? ORDER BY COALESCE(l.approved_baseline_budget, 0) + COALESCE(l.opening_transfers, 0) DESC, l.sort_order, l.code")
    .all(programme.id) as { code: string; name: string | null; is_budget_hold: number | null; asset: string; contractor: string | null }[];
  for (const l of lines) {
    if (l.is_budget_hold) {
      // "01.PS.98" / "PS.98" under asset 1TB01006.01 → "1TB01006.01.PS"
      const m = String(l.code).match(/([A-Z&\s]+)\.98$/i);
      if (m) holdLinesByKey.set(`${l.asset}.${m[1].replace(/[^A-Z]/gi, "").toUpperCase()}`, l.code);
      continue;
    }
    const ck = contractKey(l.code);
    // the line of a code is the plainly coded one (CN.003C13) ahead of its sub-lines (CN.003C13-3, a contract of its own filed under it)
    const plain = (code: string) => /\d{3}[A-Z]\d{2,3}$/i.test(code);
    const take = (key: string) => {
      const have = linesByFrag.get(key);
      if (!have || (plain(l.code) && !plain(have.code))) linesByFrag.set(key, { code: l.code, contractor: l.contractor ?? "" });
    };
    if (ck) take(ck.frag);
    if (ck && ck.key !== ck.frag) take(ck.key);
    known.push({ code: l.code, name: String(l.name ?? ""), contractor: l.contractor ?? "" });
  }
  return { programmeCode: programme.code, programmeName: programme.name, linesByFrag, lines: known, holdLinesByKey, fileName, today: todayIso() };
}

/**
 * What the Claims Tracker converter needs to know about each project: its cost lines by contract
 * code (the main contract line – the one with the largest budget – when a contract has several), its
 * asset codes and the claims it already holds (matched by letter reference or description, so a
 * re-upload updates rather than duplicates). The tracker is one AMAALA-wide file: each claim is filed
 * under the project its contract number or asset code names.
 */
export function claimsContextsFor(db: Database.Database, programmes: { id: number; code: string; name: string }[]): ClaimsTrackerContext[] {
  const all = listRecords(getRegisterDef("claims")!, { allScopes: true });
  return programmes.map((programme) => {
    const linesByFrag = new Map<string, KnownLine>();
    const lines = db
      .prepare("SELECT l.code, p.name AS package, c.name AS contractor FROM cost_lines l LEFT JOIN packages p ON p.id = l.package_id LEFT JOIN contractors c ON c.id = l.contractor_id WHERE l.programme_id = ? AND l.is_budget_hold IS NOT 1 ORDER BY COALESCE(l.approved_baseline_budget, 0) + COALESCE(l.opening_transfers, 0) DESC, l.sort_order, l.code")
      .all(programme.id) as { code: string; package: string | null; contractor: string | null }[];
    for (const l of lines) {
      const frag = codeFrag(l.code);
      if (frag && !linesByFrag.has(frag)) linesByFrag.set(frag, { code: l.code, package: l.package ?? "", contractor: l.contractor ?? "" });
    }
    const assets = (db.prepare("SELECT code FROM assets WHERE programme_id = ? ORDER BY id").all(programme.id) as { code: string }[]).map((a) => a.code);
    const existingClaims = all
      .filter((c) => Number(c.programme_id) === programme.id)
      .map((c) => ({ claim_no: String(c.claim_no), detail_letter_ref: c.detail_letter_ref as string | null, notice_letter_ref: c.notice_letter_ref as string | null, description: c.description as string | null }));
    return { programmeCode: programme.code, assetCode: programme.code, assetLabel: assets[0] ?? programme.code, assets, linesByFrag, existingClaims };
  });
}
