import type Database from "better-sqlite3";
import { getDb, getSetting } from "./db";
import { listRecords, scopeFilter } from "./registers/engine";
import { enrichRows } from "./registers/enrich";
import { computeContracts, mergeComputed, type ContractRow, type ApplicationRow } from "./payments/compute";
import { openStoredRegisters } from "./cost-report/stored";
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
  const p = db.prepare("SELECT id, label, report_no, status, programme_id FROM reporting_periods WHERE id = ?").get(id) as (ViewedPeriod & { status: string; programme_id: number }) | undefined;
  if (!p) return null;
  if (String(p.programme_id) !== (getSetting(db, "current_programme_id") ?? String(p.programme_id))) return null;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE period_id = ? AND register_key = 'cost_report'").get(id) as { n: number }).n;
  if (!n) return null;
  const newer = db.prepare("SELECT label FROM reporting_periods WHERE programme_id = ? AND report_no > ? ORDER BY report_no DESC LIMIT 1").get(p.programme_id, p.report_no) as { label: string } | undefined;
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
        const mine = k ? stored.filter((r) => Number(r[k]) === Number(v)) : stored;
        if (def.key === "contracts" || def.key === "payment_applications") {
          // the calculated columns (revised value, certified, paid, days late) are worked out again from
          // the report's own stored registers, so an issued report shows them even when the copy was
          // taken before they were stored
          const programmeId = Number(getSetting(db, "current_programme_id") ?? 0);
          if (programmeId) mergeComputed(def.key, mine as unknown as Record<string, unknown>[], paymentComputedForPeriod(db, programmeId, viewed.id));
        }
        backfillDerived(def, mine);
        return mine;
      }
    }
  }
  return listRecords(def);
}

/**
 * A report issued before a field existed carries no value for it. Everything the stored copy does hold
 * is left exactly as it was issued – the amounts and dates are the historical record – and only the
 * fields it never had are worked out now. Without this, a filter on a flag added later (a released
 * bond, a change on a contract since closed) quietly matches nothing on an older report.
 */
function backfillDerived(def: RegisterDef, rows: RecordRow[]) {
  if (!rows.length) return;
  const fresh = rows.map((r) => ({ ...r }));
  enrichRows(def, fresh);
  rows.forEach((r, i) => {
    for (const [k, v] of Object.entries(fresh[i])) if (!(k in r)) r[k] = v;
  });
}

/**
 * The payment calculations of a stored report: run against that report's own registers (its contracts,
 * IPC log, change tracker and claims as they were), so the figures are the ones that report was issued
 * with. Older stored copies without the registers fall back to their stored contracts and IPC log.
 */
export function paymentComputedForPeriod(db: Database.Database, programmeId: number, periodId: number) {
  const stored = openStoredRegisters(db, periodId);
  if (stored) {
    try {
      return computeContracts(stored, programmeId);
    } finally {
      stored.close();
    }
  }
  const mine = <T>(rows: T[] | null) => (rows ?? []).filter((r) => Number((r as unknown as RecordRow).programme_id) === programmeId);
  return computeContracts(db, programmeId, { contracts: mine(snapshotRows<ContractRow>(db, periodId, "contracts")), apps: mine(snapshotRows<ApplicationRow>(db, periodId, "payment_applications")) });
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
