import type Database from "better-sqlite3";
import { tableExists } from "../cost-report/feeds";

/** Final account statuses that mean the contract is finished and its bonds / insurances are no longer required. */
export const FA_CLOSED_STATUSES = ["Closed", "Not Required", "Direct Payment – No FA"];
/** Contract statuses that mean the same in Payment Tracking. */
export const CONTRACT_CLOSED_STATUSES = ["Closed", "Completed", "Terminated"];

export interface ClosedContracts {
  /** Cost lines whose contract is closed (Final Account Status closed / not required, or contract Closed / Completed / Terminated). */
  lines: Set<number>;
  /** Contractors all of whose contracts / final accounts are closed (used when a bond is not linked to a cost line). */
  contractors: Set<number>;
}

/** Which contracts are closed, read from the Final Account Status register first and Payment Tracking second. */
export function closedContracts(db: Database.Database, programmeId: number): ClosedContracts {
  const lines = new Set<number>();
  const byContractor = new Map<number, { open: number; closed: number }>();
  const bump = (contractor: unknown, closed: boolean) => {
    if (contractor === null || contractor === undefined) return;
    const c = byContractor.get(Number(contractor)) ?? { open: 0, closed: 0 };
    if (closed) c.closed++;
    else c.open++;
    byContractor.set(Number(contractor), c);
  };
  if (tableExists(db, "final_accounts")) {
    const rows = db.prepare("SELECT cost_line_id, contractor_id, status FROM final_accounts WHERE programme_id = ?").all(programmeId) as { cost_line_id: number | null; contractor_id: number | null; status: string | null }[];
    for (const r of rows) {
      const closed = FA_CLOSED_STATUSES.includes(String(r.status ?? ""));
      if (closed && r.cost_line_id) lines.add(r.cost_line_id);
      bump(r.contractor_id, closed);
    }
  }
  if (tableExists(db, "contracts")) {
    const rows = db.prepare("SELECT cost_line_id, contractor_id, current_status FROM contracts WHERE programme_id = ?").all(programmeId) as { cost_line_id: number | null; contractor_id: number | null; current_status: string | null }[];
    for (const r of rows) {
      const closed = CONTRACT_CLOSED_STATUSES.includes(String(r.current_status ?? ""));
      if (closed && r.cost_line_id) lines.add(r.cost_line_id);
      bump(r.contractor_id, closed);
    }
  }
  const contractors = new Set<number>();
  for (const [id, c] of byContractor) if (c.closed > 0 && c.open === 0) contractors.add(id);
  return { lines, contractors };
}
