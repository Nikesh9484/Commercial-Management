import type Database from "better-sqlite3";
import { tableExists } from "../cost-report/feeds";
import { codeFrag } from "../workbook/claims-tracker";

/** Final account statuses that mean the contract is finished and its bonds / insurances are no longer required. */
export const FA_CLOSED_STATUSES = ["Closed", "Not Required", "Direct Payment – No FA"];
/** Contract statuses that mean the same in Payment Tracking. */
export const CONTRACT_CLOSED_STATUSES = ["Closed", "Completed", "Terminated"];

export interface ClosedContracts {
  /** Cost lines whose contract is closed: every line of that contract (CN.031C02, CN.031C02-2 …), not only the one the final account points at. */
  lines: Set<number>;
  /** Contract codes (031C02 …) that are closed. */
  contracts: Set<string>;
  /** Contractors all of whose contracts / final accounts are closed (used when a bond is not linked to a cost line). */
  contractors: Set<number>;
}

/**
 * Which contracts are closed. The Final Account Status register decides first (a closed, not-required or
 * direct-payment final account closes the contract even if Payment Tracking still says Active); Payment
 * Tracking decides for contracts that have no final account row. Contracts are recognised by their code
 * fragment (031C02), so a closed contract releases the bonds on all of its cost lines.
 */
export function closedContracts(db: Database.Database, programmeId: number): ClosedContracts {
  const lineCode = new Map<number, string>();
  if (tableExists(db, "cost_lines")) {
    for (const r of db.prepare("SELECT id, code FROM cost_lines WHERE programme_id = ?").all(programmeId) as { id: number; code: string | null }[]) lineCode.set(r.id, String(r.code ?? ""));
  }
  const fragOf = (lineId: number | null, ref: string | null) => (lineId !== null ? codeFrag(lineCode.get(lineId) ?? "") : null) ?? (ref ? codeFrag(ref) : null);

  // per contract: what the final account says, and what payment tracking says
  const fa = new Map<string, boolean>();
  const pt = new Map<string, boolean>();
  const faLines = new Map<number, boolean>();
  const ptLines = new Map<number, boolean>();
  const byContractor = new Map<number, { open: number; closed: number }>();
  const bump = (contractor: unknown, closed: boolean) => {
    if (contractor === null || contractor === undefined) return;
    const c = byContractor.get(Number(contractor)) ?? { open: 0, closed: 0 };
    if (closed) c.closed++;
    else c.open++;
    byContractor.set(Number(contractor), c);
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
    }
  }
  if (tableExists(db, "contracts")) {
    const rows = db.prepare("SELECT cost_line_id, contractor_id, current_status, acc_ref FROM contracts WHERE programme_id = ?").all(programmeId) as { cost_line_id: number | null; contractor_id: number | null; current_status: string | null; acc_ref: string | null }[];
    for (const r of rows) {
      const closed = CONTRACT_CLOSED_STATUSES.includes(String(r.current_status ?? ""));
      const frag = fragOf(r.cost_line_id, r.acc_ref);
      note(pt, frag, closed);
      if (r.cost_line_id) ptLines.set(r.cost_line_id, closed);
      // the final account is the authority when it exists for this contract
      if (!(frag && fa.has(frag)) && !(r.cost_line_id && faLines.has(r.cost_line_id))) bump(r.contractor_id, closed);
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
  return { lines, contracts, contractors };
}
