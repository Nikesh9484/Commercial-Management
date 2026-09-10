import type Database from "better-sqlite3";
import { getDb, getSetting } from "./db";
import { listRecords, scopeFilter } from "./registers/engine";
import type { RecordRow, RegisterDef } from "./registers/types";

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

/**
 * The rows of a register as the top-bar period sees them: its stored copy when that period is locked
 * or not the latest report (filtered to the current programme), else the live rows.
 */
export function recordsForView(def: RegisterDef, db: Database.Database = getDb()): RecordRow[] {
  if (def.snapshot) {
    const viewed = viewingLockedPeriod(db);
    if (viewed) {
      const stored = snapshotRows<RecordRow>(db, viewed.id, def.key);
      if (stored) {
        const [k, v] = Object.entries(scopeFilter(def))[0] ?? [];
        return k ? stored.filter((r) => Number(r[k]) === Number(v)) : stored;
      }
    }
  }
  return listRecords(def);
}

/** Contracts and payment applications as the top-bar period sees them (for the payment calculations). */
export function paymentSourceForView<C, A>(db: Database.Database, programmeId: number): { contracts: C[]; apps: A[] } | undefined {
  const viewed = viewingLockedPeriod(db);
  if (!viewed) return undefined;
  const contracts = snapshotRows<RecordRow>(db, viewed.id, "contracts");
  const apps = snapshotRows<RecordRow>(db, viewed.id, "payment_applications");
  if (!contracts || !apps) return undefined;
  const mine = (rows: RecordRow[]) => rows.filter((r) => Number(r.programme_id) === programmeId);
  return {
    contracts: mine(contracts).sort((a, b) => Number(a.sr_no ?? 0) - Number(b.sr_no ?? 0) || Number(a.id) - Number(b.id)) as unknown as C[],
    apps: mine(apps).sort((a, b) => Number(a.contract_id) - Number(b.contract_id) || String(a.application_date ?? "").localeCompare(String(b.application_date ?? "")) || Number(a.id) - Number(b.id)) as unknown as A[],
  };
}
