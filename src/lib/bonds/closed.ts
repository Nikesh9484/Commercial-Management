import type Database from "better-sqlite3";
import { tableExists } from "../cost-report/feeds";
import { codeFrag } from "../workbook/claims-tracker";
import { contractorKey } from "./name-key";

/** Final account statuses that mean the contract is finished and its bonds / insurances are no longer required. */
export const FA_CLOSED_STATUSES = ["Closed", "Not Required", "Direct Payment – No FA"];
/** Contract statuses that mean the same in Payment Tracking. */
export const CONTRACT_CLOSED_STATUSES = ["Closed", "Completed", "Terminated"];

export interface ClosedContracts {
  /** Cost lines whose contract is closed: every line of that contract (CN.031C02, CN.031C02-2 …), not only the one the final account points at. */
  lines: Set<number>;
  /** Cost lines the Final Account Status or Payment Tracking says anything at all about, closed or not.
   *  A line in neither is unknown rather than open, so a bond on it falls back to its contractor. */
  knownLines: Set<number>;
  /** Contract codes (031C02 …) that are closed. */
  contracts: Set<string>;
  /** Contractors all of whose contracts / final accounts are closed (used when a bond is not linked to a cost line). */
  contractors: Set<number>;
  /** The same contractors by name, squashed to letters and digits. A contractor entered twice under
   *  slightly different spellings ("Co.Ltd." and "Co. Ltd.") is one company, and the closure of the
   *  one that carries the contracts has to reach the bonds filed against the other. */
  contractorNames: Set<string>;
  /** Packages every contract of which is closed. The surest link of the three when a company has been
   *  entered twice under names that are not alike at all ("WSP Middle East" and "WSP Consulting"):
   *  the package is a number on both rows, so no spelling has to be guessed at. */
  packages: Set<number>;
  /** Packages anything is known about at all, so "not mentioned" can be told from "still open". */
  knownPackages: Set<number>;
}

export { contractorKey };

/**
 * Which contracts are closed. The Final Account Status register decides first (a closed, not-required or
 * direct-payment final account closes the contract even if Payment Tracking still says Active); Payment
 * Tracking decides for contracts that have no final account row. Contracts are recognised by their code
 * fragment (031C02), so a closed contract releases the bonds on all of its cost lines.
 */
export function closedContracts(db: Database.Database, programmeId: number): ClosedContracts {
  const lineCode = new Map<number, string>();
  const linePackage = new Map<number, number>();
  if (tableExists(db, "cost_lines")) {
    for (const r of db.prepare("SELECT id, code, package_id FROM cost_lines WHERE programme_id = ?").all(programmeId) as { id: number; code: string | null; package_id: number | null }[]) {
      lineCode.set(r.id, String(r.code ?? ""));
      if (r.package_id !== null && r.package_id !== undefined) linePackage.set(r.id, Number(r.package_id));
    }
  }
  const byPackage = new Map<number, { open: number; closed: number }>();
  const bumpPackage = (pkg: unknown, closed: boolean) => {
    if (pkg === null || pkg === undefined || pkg === "") return;
    const p = byPackage.get(Number(pkg)) ?? { open: 0, closed: 0 };
    if (closed) p.closed++;
    else p.open++;
    byPackage.set(Number(pkg), p);
  };
  const fragOf = (lineId: number | null, ref: string | null) => (lineId !== null ? codeFrag(lineCode.get(lineId) ?? "") : null) ?? (ref ? codeFrag(ref) : null);

  // per contract: what the final account says, and what payment tracking says
  const fa = new Map<string, boolean>();
  const pt = new Map<string, boolean>();
  const faLines = new Map<number, boolean>();
  const ptLines = new Map<number, boolean>();
  const byContractor = new Map<number, { open: number; closed: number }>();
  const byName = new Map<string, { open: number; closed: number }>();
  const contractorName = new Map<number, string>();
  if (tableExists(db, "contractors")) {
    for (const r of db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string | null }[]) contractorName.set(r.id, contractorKey(r.name));
  }
  const bump = (contractor: unknown, closed: boolean) => {
    if (contractor === null || contractor === undefined) return;
    const c = byContractor.get(Number(contractor)) ?? { open: 0, closed: 0 };
    if (closed) c.closed++;
    else c.open++;
    byContractor.set(Number(contractor), c);
    const key = contractorName.get(Number(contractor));
    if (key) {
      const n = byName.get(key) ?? { open: 0, closed: 0 };
      if (closed) n.closed++;
      else n.open++;
      byName.set(key, n);
    }
  };
  const note = (map: Map<string, boolean>, frag: string | null, closed: boolean) => {
    if (!frag) return;
    // one open row keeps the contract open
    map.set(frag, map.has(frag) ? map.get(frag)! && closed : closed);
  };
  if (tableExists(db, "final_accounts")) {
    const rows = db.prepare("SELECT cost_line_id, contractor_id, status, acc_ref FROM final_accounts WHERE programme_id = ?").all(programmeId) as { cost_line_id: number | null; contractor_id: number | null; status: string | null; acc_ref: string | null }[];
    for (const r of rows) {
      const closed = FA_CLOSED_STATUSES.includes(String(r.status ?? ""));
      note(fa, fragOf(r.cost_line_id, r.acc_ref), closed);
      if (r.cost_line_id) faLines.set(r.cost_line_id, closed);
      bump(r.contractor_id, closed);
      bumpPackage(r.cost_line_id ? linePackage.get(Number(r.cost_line_id)) : undefined, closed);
    }
  }
  if (tableExists(db, "contracts")) {
    const rows = db.prepare("SELECT cost_line_id, contractor_id, current_status, acc_ref, package_id FROM contracts WHERE programme_id = ?").all(programmeId) as { cost_line_id: number | null; contractor_id: number | null; current_status: string | null; acc_ref: string | null; package_id: number | null }[];
    for (const r of rows) {
      const closed = CONTRACT_CLOSED_STATUSES.includes(String(r.current_status ?? ""));
      const frag = fragOf(r.cost_line_id, r.acc_ref);
      note(pt, frag, closed);
      if (r.cost_line_id) ptLines.set(r.cost_line_id, closed);
      // the final account is the authority when it exists for this contract
      const faDecides = (frag && fa.has(frag)) || (r.cost_line_id && faLines.has(r.cost_line_id));
      if (!faDecides) {
        bump(r.contractor_id, closed);
        bumpPackage(r.package_id ?? (r.cost_line_id ? linePackage.get(Number(r.cost_line_id)) : undefined), closed);
      }
    }
  }
  const contracts = new Set<string>();
  for (const [frag, closed] of pt) if (closed && !fa.has(frag)) contracts.add(frag);
  for (const [frag, closed] of fa) if (closed) contracts.add(frag);
  const lines = new Set<number>();
  for (const [id, code] of lineCode) {
    const frag = codeFrag(code);
    if (frag && contracts.has(frag)) lines.add(id);
  }
  for (const [id, closed] of ptLines) if (closed && !faLines.has(id)) lines.add(id);
  for (const [id, closed] of faLines) if (closed) lines.add(id);
  const contractors = new Set<number>();
  for (const [id, c] of byContractor) if (c.closed > 0 && c.open === 0) contractors.add(id);
  const contractorNames = new Set<string>();
  for (const [key, c] of byName) if (c.closed > 0 && c.open === 0) contractorNames.add(key);
  // which lines anything is known about, so "not mentioned" can be told from "still open"
  const knownLines = new Set<number>([...faLines.keys(), ...ptLines.keys()]);
  for (const [id, code] of lineCode) {
    const frag = codeFrag(code);
    if (frag && (fa.has(frag) || pt.has(frag))) knownLines.add(id);
  }
  const packages = new Set<number>();
  for (const [id, p] of byPackage) if (p.closed > 0 && p.open === 0) packages.add(id);
  const knownPackages = new Set<number>(byPackage.keys());
  return { lines, knownLines, contracts, contractors, contractorNames, packages, knownPackages };
}
