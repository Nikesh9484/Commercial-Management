import type Database from "better-sqlite3";
import { impliedOverallStatus } from "../registers/defs/changes";

/**
 * Brings every change's overall status in line with its stages (see impliedOverallStatus): a DVO
 * approved is Approved, a cancelled last stage is Cancelled, and so on. Runs at start-up over the
 * live rows of every project; issued reports keep what they were issued with. Returns the rows changed.
 */
export function rederiveOverallStatuses(db: Database.Database): number {
  const names = new Map((db.prepare("SELECT id, name FROM approval_statuses").all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const ids = new Map([...names.entries()].map(([id, n]) => [n, id]));
  const rows = db.prepare("SELECT id, overall_status_id, ew_status_id, rfc_status_id, pvo_status_id, vo_status_id, ei_status_id, dvo_status_id, dvo_closed FROM changes").all() as Record<string, number | null>[];
  const update = db.prepare("UPDATE changes SET overall_status_id = ? WHERE id = ?");
  let changed = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      const stage: Record<string, string | null> = {};
      for (const p of ["ew", "rfc", "pvo", "vo", "ei", "dvo"]) stage[p] = r[`${p}_status_id`] === null ? null : (names.get(Number(r[`${p}_status_id`])) ?? null);
      const want = impliedOverallStatus(stage, r.overall_status_id === null ? null : names.get(Number(r.overall_status_id)), { dvoClosed: r.dvo_closed === 1 });
      const id = ids.get(want);
      if (id !== undefined && id !== r.overall_status_id) {
        update.run(id, r.id);
        changed++;
      }
    }
  });
  run();
  return changed;
}
