import type Database from "better-sqlite3";
import { getDb, getSetting } from "./db";

export interface ViewedPeriod {
  id: number;
  label: string;
  report_no: number;
}

/**
 * "Period view mode": every report keeps its own data. The live registers belong to the latest
 * report; when the top bar shows a locked report or an earlier one, every page shows that report's
 * stored copy, read-only.
 */
export function viewingLockedPeriod(db: Database.Database = getDb()): (ViewedPeriod & { status: string; reason: string }) | null {
  const id = Number(getSetting(db, "current_period_id") ?? 0);
  if (!id) return null;
  const p = db.prepare("SELECT id, label, report_no, status FROM reporting_periods WHERE id = ?").get(id) as (ViewedPeriod & { status: string }) | undefined;
  if (!p) return null;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE period_id = ? AND register_key = 'cost_report'").get(id) as { n: number }).n;
  if (!n) return null;
  const newer = db.prepare("SELECT label FROM reporting_periods WHERE report_no > ? ORDER BY report_no DESC LIMIT 1").get(p.report_no) as { label: string } | undefined;
  if (p.status !== "Locked" && !newer) return null;
  const reason = p.status === "Locked" ? `${p.label} is locked – you are viewing the issued report.` : `${p.label} is an earlier report – you are viewing its stored data; ${newer!.label} is the live one.`;
  return { id: p.id, label: p.label, report_no: p.report_no, status: p.status, reason };
}

/** Snapshot rows of one register for a period (already enriched when they were taken). */
export function snapshotRows<T = Record<string, unknown>>(db: Database.Database, periodId: number, registerKey: string): T[] | null {
  const rows = db.prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = ? ORDER BY record_id").all(periodId, registerKey) as { data: string }[];
  return rows.length ? rows.map((r) => JSON.parse(r.data) as T) : null;
}
