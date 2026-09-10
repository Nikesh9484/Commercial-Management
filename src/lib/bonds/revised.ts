import type Database from "better-sqlite3";
import { getSetting } from "../db";
import { tableExists } from "../cost-report/feeds";
import { computeCostReport } from "../cost-report/compute";

/**
 * Revised contract value per cost line (contract).
 * Source 1 (once Module 8 exists): the latest revised contract sum recorded in Payment Tracking.
 * Fallback: the cost report's Committed Costs (column I) = latest budget + determined variations.
 */
export function revisedContractValues(db: Database.Database, programmeId: number): { values: Map<number, number>; source: string } {
  if (tableExists(db, "payment_applications")) {
    const rows = db
      .prepare(
        `SELECT cost_line_id, revised_contract_sum FROM payment_applications
         WHERE programme_id = ? AND cost_line_id IS NOT NULL AND revised_contract_sum IS NOT NULL
         ORDER BY application_date ASC, id ASC`,
      )
      .all(programmeId) as { cost_line_id: number; revised_contract_sum: number }[];
    if (rows.length) {
      const values = new Map<number, number>();
      for (const r of rows) values.set(r.cost_line_id, Number(r.revised_contract_sum)); // last one wins
      return { values, source: "Payment Tracking" };
    }
  }
  const periodId = getSetting(db, "current_period_id");
  const report = computeCostReport(programmeId, periodId ? Number(periodId) : null);
  return { values: new Map(report.lines.map((l) => [l.id, l.I])), source: "Cost report (Committed Costs)" };
}
