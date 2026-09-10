import type Database from "better-sqlite3";
import { getDb, getSetting } from "./db";

export interface ViewedPeriod {
  id: number;
  label: string;
  report_no: number;
}

/**
 * "Period view mode": when the period chosen in the top bar is Locked and has a stored snapshot,
 * every page shows that issued report (the snapshot) instead of the live data, read-only.
 */
export function viewingLockedPeriod(db: Database.Database = getDb()): ViewedPeriod | null {
  const id = Number(getSetting(db, "current_period_id") ?? 0);
  if (!id) return null;
  const p = db.prepare("SELECT id, label, report_no, status FROM reporting_periods WHERE id = ?").get(id) as (ViewedPeriod & { status: string }) | undefined;
  if (!p || p.status !== "Locked") return null;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE period_id = ?").get(id) as { n: number }).n;
  return n ? { id: p.id, label: p.label, report_no: p.report_no } : null;
}

/** Snapshot rows of one register for a period (already enriched when they were taken). */
export function snapshotRows<T = Record<string, unknown>>(db: Database.Database, periodId: number, registerKey: string): T[] | null {
  const rows = db.prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = ? ORDER BY record_id").all(periodId, registerKey) as { data: string }[];
  return rows.length ? rows.map((r) => JSON.parse(r.data) as T) : null;
}
