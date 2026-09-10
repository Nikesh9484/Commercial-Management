import type Database from "better-sqlite3";
import { CHANGE_STAGES, DEAD_STATUSES } from "../registers/defs/changes";
import { claimCostReportAmount } from "../registers/defs/claims";
import { certifiedByLine } from "../payments/compute";

/**
 * "Feeds" are the columns of the cost report that come from other modules.
 * Each feed returns a map of cost_line_id -> SAR amount for one programme / period.
 *
 * As each module is built it fills in its feed here. Until then the feed returns an
 * empty map (the column shows 0) and `available` is false so the page can say so.
 */
export interface CostFeeds {
  budgetTransfers: Map<number, number>; // F  – Module 10 Budget Transfers
  dvo: Map<number, number>; // H  – Module 3 Change Tracker (Determined / Approved)
  pvo: Map<number, number>; // J  – Module 3 Change Tracker (Potential)
  rfc: Map<number, number>; // K  – Module 3 Change Tracker (Requests for Change)
  earlyWarnings: Map<number, number>; // L  – Module 5 Early Warnings
  claims: Map<number, number>; // M  – Module 4 Claims
  certified: Map<number, number>; // P  – Module 8 Invoice & Payment Tracking
}

import type { FeedStatus } from "./feeds-types";
export type { FeedStatus };

export function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

/** Sums `amountSql` per cost_line_id for rows matching `whereSql` (only if the table exists). */
export function sumByCostLine(db: Database.Database, table: string, amountSql: string, whereSql = "1 = 1", params: unknown[] = []): Map<number, number> {
  const out = new Map<number, number>();
  if (!tableExists(db, table)) return out;
  const rows = db.prepare(`SELECT cost_line_id AS id, SUM(${amountSql}) AS total FROM "${table}" WHERE cost_line_id IS NOT NULL AND (${whereSql}) GROUP BY cost_line_id`).all(...(params as never[])) as {
    id: number;
    total: number | null;
  }[];
  for (const r of rows) out.set(r.id, Number(r.total ?? 0));
  return out;
}

/**
 * Change tracker -> cost report. Each change is counted ONCE, at its most advanced live stage:
 *   DVO approved / review complete  -> H (Determined VO)      using the DVO cost-report amount
 *   otherwise VO or PVO stage live  -> J (Potential VO)       using that stage's cost-report amount
 *   otherwise RFC stage live        -> K (Request for Change) using the RFC cost-report amount
 * A stage is "live" unless its status is Cancelled / Rejected / Superseded / Transferred.
 * A change whose OVERALL status is one of those feeds nothing at all.
 */
export function changeFeeds(db: Database.Database, programmeId: number): { dvo: Map<number, number>; pvo: Map<number, number>; rfc: Map<number, number> } {
  const dvo = new Map<number, number>();
  const pvo = new Map<number, number>();
  const rfc = new Map<number, number>();
  if (!tableExists(db, "changes")) return { dvo, pvo, rfc };
  const statusName = (col: string) => `(SELECT name FROM approval_statuses WHERE id = c.${col})`;
  const rows = db
    .prepare(
      `SELECT c.cost_line_id, ${statusName("overall_status_id")} AS overall_status,
              c.dvo_cr_amount, ${statusName("dvo_status_id")} AS dvo_status, c.dvo_ref, c.dvo_date,
              c.vo_cr_amount,  ${statusName("vo_status_id")}  AS vo_status,  c.vo_ref,  c.vo_date,
              c.pvo_cr_amount, ${statusName("pvo_status_id")} AS pvo_status, c.pvo_ref, c.pvo_date,
              c.rfc_cr_amount, ${statusName("rfc_status_id")} AS rfc_status, c.rfc_ref, c.rfc_date
       FROM changes c WHERE c.programme_id = ? AND c.cost_line_id IS NOT NULL`,
    )
    .all(programmeId) as Record<string, unknown>[];
  const add = (m: Map<number, number>, id: number, v: unknown) => m.set(id, (m.get(id) ?? 0) + Number(v ?? 0));
  const has = (r: Record<string, unknown>, p: string) => r[`${p}_ref`] || r[`${p}_date`] || r[`${p}_status`] || r[`${p}_cr_amount`] !== null;
  const live = (r: Record<string, unknown>, p: string) => !DEAD_STATUSES.includes(String(r[`${p}_status`] ?? ""));
  for (const r of rows) {
    const id = Number(r.cost_line_id);
    if (DEAD_STATUSES.includes(String(r.overall_status ?? ""))) continue;
    if (["Approved", "Review Complete"].includes(String(r.dvo_status ?? ""))) {
      add(dvo, id, r.dvo_cr_amount);
      continue;
    }
    const potential = [...CHANGE_STAGES].reverse().find((s) => (s.prefix === "vo" || s.prefix === "pvo") && has(r, s.prefix) && live(r, s.prefix));
    if (potential) {
      add(pvo, id, r[`${potential.prefix}_cr_amount`]);
      continue;
    }
    if (has(r, "rfc") && live(r, "rfc")) add(rfc, id, r.rfc_cr_amount);
  }
  return { dvo, pvo, rfc };
}

/** Claims -> cost report column M (see claimCostReportAmount for the value carried per claim). */
export function claimFeeds(db: Database.Database, programmeId: number): Map<number, number> {
  const out = new Map<number, number>();
  if (!tableExists(db, "claims")) return out;
  const rows = db
    .prepare("SELECT cost_line_id, status, determination_cost, employer_cost, engineer_cost, contractor_cost FROM claims WHERE programme_id = ? AND cost_line_id IS NOT NULL")
    .all(programmeId) as Record<string, unknown>[];
  for (const r of rows) {
    const id = Number(r.cost_line_id);
    out.set(id, (out.get(id) ?? 0) + claimCostReportAmount(r));
  }
  return out;
}

/** Open early warnings -> cost report column L. */
export function earlyWarningFeeds(db: Database.Database, programmeId: number): Map<number, number> {
  return sumByCostLine(db, "early_warnings", "COALESCE(cost_impact, 0)", "programme_id = ? AND status = 'Open'", [programmeId]);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getCostFeeds(db: Database.Database, programmeId: number, periodId: number): { feeds: CostFeeds; status: FeedStatus[] } {
  // Each entry is filled in when the source module is built.
  const changes = changeFeeds(db, programmeId);
  const feeds: CostFeeds = {
    budgetTransfers: new Map(),
    dvo: changes.dvo,
    pvo: changes.pvo,
    rfc: changes.rfc,
    earlyWarnings: earlyWarningFeeds(db, programmeId),
    claims: claimFeeds(db, programmeId),
    certified: certifiedByLine(db, programmeId),
  };
  const status: FeedStatus[] = [
    { column: "F", label: "Budget Transfers", module: "Module 10 – Budget Transfers", available: false },
    { column: "H", label: "Determined Variation Orders", module: "Module 3 – Change Management", available: true },
    { column: "J", label: "Potential Variation Orders", module: "Module 3 – Change Management", available: true },
    { column: "K", label: "Requests for Change", module: "Module 3 – Change Management", available: true },
    { column: "L", label: "Early Warnings", module: "Module 5 – Early Warnings", available: true },
    { column: "M", label: "Claims", module: "Module 4 – Claims & Disputes", available: true },
    { column: "P", label: "Certified to Date", module: "Module 8 – Invoice & Payment Tracking", available: true },
  ];
  return { feeds, status };
}
