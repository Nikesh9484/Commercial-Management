import type Database from "better-sqlite3";
import { getSetting } from "../db";
import { computeCostReport } from "../cost-report/compute";
import { revisedByLine } from "../payments/compute";

/**
 * Revised contract value per cost line (contract).
 * Source 1: the revised contract value of the contract in Payment Tracking linked to the same cost line.
 * Fallback: the cost report's Committed Costs (column I) = latest budget + determined variations.
 */
export function revisedContractValues(db: Database.Database, programmeId: number): { values: Map<number, number>; source: string } {
  const fromContracts = revisedByLine(db, programmeId);
  const periodId = getSetting(db, "current_period_id");
  const report = computeCostReport(programmeId, periodId ? Number(periodId) : null);
  const values = new Map(report.lines.map((l) => [l.id, l.I]));
  for (const [line, v] of fromContracts) values.set(line, v);
  return { values, source: fromContracts.size ? "Payment Tracking / cost report" : "Cost report (Committed Costs)" };
}
