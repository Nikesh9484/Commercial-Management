import type Database from "better-sqlite3";
import { tableExists } from "../cost-report/feeds";
import { codeFrag } from "../workbook/claims-tracker";
import { contractorKey } from "./name-key";
import { contractIsOpen, faStatusFromExcel } from "./contract-status";

/** Final account statuses that mean the contract is finished and its bonds / insurances are no longer required. */
export const FA_CLOSED_STATUSES = ["Closed", "Not Required", "Direct Payment – No FA"];
/** Contract statuses that mean the same in Payment Tracking. */
export const CONTRACT_CLOSED_STATUSES = ["Closed", "Completed", "Terminated", "Suspended"];

export { contractIsOpen, faStatusFromExcel };

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
  /** Contractors (by row and by squashed name) that appear on any final account or contract at all. */
  knownContractors: Set<number>;
  knownContractorNames: Set<string>;
  /** Every contract by the words of its names (final account description, cost line, package), so a
   *  bond filed under a package of its own ("Marina Basin") can be tied to the contract those words
   *  belong to ("Al Saad-Marina Basin") when it carries neither the cost line nor the package number. */
  namedContracts: { words: Set<string>; closed: boolean }[];
}

const NAME_STOPWORDS = new Set(["and", "the", "for", "of", "with", "package", "works", "work", "contract", "llc", "ltd", "co"]);

/** The words that identify a contract or package name: lower case, three letters or more, no filler. */
export function nameWords(label: unknown): string[] {
  return String(label ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w));
}

/**
 * Is the contract whose names carry every identifying word of this label closed? True or false when
 * such contracts exist (closed only when all of them are), null when the words match nothing.
 */
export function closureByName(closed: ClosedContracts, label: unknown): boolean | null {
  const words = nameWords(label);
  if (!words.length) return null;
  const hits = closed.namedContracts.filter((c) => words.every((w) => c.words.has(w)));
  if (!hits.length) return null;
  return hits.every((c) => c.closed);
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
  const lineName = new Map<number, string>();
  const packageName = new Map<number, string>();
  if (tableExists(db, "packages")) {
    for (const r of db.prepare("SELECT id, name FROM packages").all() as { id: number; name: string | null }[]) packageName.set(r.id, String(r.name ?? ""));
  }
  if (tableExists(db, "cost_lines")) {
    for (const r of db.prepare("SELECT id, code, name, package_id FROM cost_lines WHERE programme_id = ?").all(programmeId) as { id: number; code: string | null; name: string | null; package_id: number | null }[]) {
      lineCode.set(r.id, String(r.code ?? ""));
      lineName.set(r.id, String(r.name ?? ""));
      if (r.package_id !== null && r.package_id !== undefined) linePackage.set(r.id, Number(r.package_id));
    }
  }
  // every contract by the words of its names, for bonds that carry neither its line nor its package
  const namedContracts: { words: Set<string>; closed: boolean }[] = [];
  const nameContract = (closed: boolean, lineId: number | null, pkg: number | null | undefined, ...labels: unknown[]) => {
    const words = new Set<string>();
    for (const l of [...labels, lineId !== null ? lineName.get(lineId) : "", lineId !== null ? packageName.get(linePackage.get(lineId) ?? -1) : "", pkg ? packageName.get(pkg) : ""]) for (const w of nameWords(l)) words.add(w);
    if (words.size) namedContracts.push({ words, closed });
  };
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
    const rows = db.prepare("SELECT cost_line_id, contractor_id, status, acc_ref, description FROM final_accounts WHERE programme_id = ?").all(programmeId) as { cost_line_id: number | null; contractor_id: number | null; status: string | null; acc_ref: string | null; description: string | null }[];
    for (const r of rows) {
      const closed = !contractIsOpen(r.status);
      note(fa, fragOf(r.cost_line_id, r.acc_ref), closed);
      if (r.cost_line_id) faLines.set(r.cost_line_id, closed);
      bump(r.contractor_id, closed);
      bumpPackage(r.cost_line_id ? linePackage.get(Number(r.cost_line_id)) : undefined, closed);
      nameContract(closed, r.cost_line_id ?? null, undefined, r.description);
    }
  }
  if (tableExists(db, "contracts")) {
    const rows = db.prepare("SELECT cost_line_id, contractor_id, current_status, acc_ref, package_id FROM contracts WHERE programme_id = ?").all(programmeId) as { cost_line_id: number | null; contractor_id: number | null; current_status: string | null; acc_ref: string | null; package_id: number | null }[];
    for (const r of rows) {
      const closed = !contractIsOpen(r.current_status);
      const frag = fragOf(r.cost_line_id, r.acc_ref);
      note(pt, frag, closed);
      if (r.cost_line_id) ptLines.set(r.cost_line_id, closed);
      // the final account is the authority when it exists for this contract
      const faDecides = (frag && fa.has(frag)) || (r.cost_line_id && faLines.has(r.cost_line_id));
      if (!faDecides) {
        bump(r.contractor_id, closed);
        bumpPackage(r.package_id ?? (r.cost_line_id ? linePackage.get(Number(r.cost_line_id)) : undefined), closed);
        nameContract(closed, r.cost_line_id ?? null, r.package_id);
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
  const knownContractors = new Set<number>(byContractor.keys());
  const knownContractorNames = new Set<string>(byName.keys());
  return { lines, knownLines, contracts, contractors, contractorNames, packages, knownPackages, knownContractors, knownContractorNames, namedContracts };
}
