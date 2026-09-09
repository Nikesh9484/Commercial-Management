import type Database from "better-sqlite3";

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getCostFeeds(db: Database.Database, programmeId: number, periodId: number): { feeds: CostFeeds; status: FeedStatus[] } {
  // Each entry is filled in when the source module is built.
  const feeds: CostFeeds = {
    budgetTransfers: new Map(),
    dvo: new Map(),
    pvo: new Map(),
    rfc: new Map(),
    earlyWarnings: new Map(),
    claims: new Map(),
    certified: new Map(),
  };
  const status: FeedStatus[] = [
    { column: "F", label: "Budget Transfers", module: "Module 10 – Budget Transfers", available: false },
    { column: "H", label: "Determined Variation Orders", module: "Module 3 – Change Management", available: false },
    { column: "J", label: "Potential Variation Orders", module: "Module 3 – Change Management", available: false },
    { column: "K", label: "Requests for Change", module: "Module 3 – Change Management", available: false },
    { column: "L", label: "Early Warnings", module: "Module 5 – Early Warnings", available: false },
    { column: "M", label: "Claims", module: "Module 4 – Claims & Disputes", available: false },
    { column: "P", label: "Certified to Date", module: "Module 8 – Invoice & Payment Tracking", available: false },
  ];
  return { feeds, status };
}
