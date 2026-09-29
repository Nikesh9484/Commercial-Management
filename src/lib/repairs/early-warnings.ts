import { getDb, getSetting, setSetting, syntheticEwNo } from "../db";
import { logAudit } from "../audit";
import { latestPeriod, hasStoredCopy, takeSnapshot } from "../snapshots";

/**
 * One-off repair after the first early-warning tidy (29 Sep 2026), which treated every early
 * warning with the same wording as one item. That was right for the Marina rows the converter had
 * numbered itself ("EW", "EW-23-4" – the same item brought in twice) and wrong for early warnings
 * the workbook numbers itself ("EW 038 SPM" and "EW 038 STE" are two items). Runs once, on start:
 *
 *  1. every early warning removed by that tidy whose own number the workbook gave it comes back
 *     from the report's stored copy, and the row that was given its number and figures gets its
 *     own back;
 *  2. a locked latest report whose stored copy still lists early warnings the live register no
 *     longer has (the removed duplicates) is stored again from the live register, so its cost
 *     report and period movement no longer count the duplicates.
 */
export function repairEarlyWarnings(): void {
  const db = getDb();
  if (getSetting(db, "repaired_early_warnings") === "1") return;
  try {
    const cols = new Set((db.prepare('PRAGMA table_info("early_warnings")').all() as { name: string }[]).map((c) => c.name));
    const storedRow = (recordId: number, periodId?: number) =>
      db
        .prepare(`SELECT period_id, data FROM snapshots WHERE register_key = 'early_warnings' AND record_id = ? ${periodId ? "AND period_id = ?" : ""} ORDER BY taken_at DESC LIMIT 1`)
        .get(...(periodId ? [recordId, periodId] : [recordId])) as { period_id: number; data: string } | undefined;
    const writeFrom = (data: Record<string, unknown>, id: number, insert: boolean) => {
      const keys = Object.keys(data).filter((k) => cols.has(k) && k !== "id" && data[k] !== undefined && (data[k] === null || typeof data[k] !== "object"));
      const vals = keys.map((k) => (typeof data[k] === "boolean" ? (data[k] ? 1 : 0) : (data[k] as string | number | null)));
      if (insert) db.prepare(`INSERT INTO early_warnings ("id", ${keys.map((k) => `"${k}"`).join(",")}) VALUES (?, ${keys.map(() => "?").join(",")})`).run(id, ...vals);
      else db.prepare(`UPDATE early_warnings SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE id = ?`).run(...vals, id);
    };

    let restored = 0;
    let renumbered = 0;
    const removed = db
      .prepare("SELECT DISTINCT record_id AS id FROM audit_log WHERE register_key = 'early_warnings' AND action = 'delete' AND user_name = 'system' AND summary LIKE 'Removed duplicated early warning%'")
      .all() as { id: number }[];
    const tx = db.transaction(() => {
      for (const { id } of removed) {
        if (db.prepare("SELECT 1 FROM early_warnings WHERE id = ?").get(id)) continue;
        const snap = storedRow(id);
        if (!snap) continue;
        const data = JSON.parse(snap.data) as Record<string, unknown>;
        if (syntheticEwNo(data.ew_no)) continue; // a real duplicate: stays removed
        // the row that was given this number and figures gets its own back first
        const twin = db.prepare("SELECT id FROM early_warnings WHERE programme_id IS ? AND ew_no = ? COLLATE NOCASE").get(data.programme_id ?? null, String(data.ew_no)) as { id: number } | undefined;
        if (twin) {
          const own = storedRow(twin.id, snap.period_id);
          if (own) {
            writeFrom(JSON.parse(own.data) as Record<string, unknown>, twin.id, false);
            renumbered++;
          }
        }
        writeFrom(data, id, true);
        restored++;
        logAudit(db, { registerKey: "early_warnings", recordId: id, action: "create", user: null, summary: `Restored early warning ${String(data.ew_no)} ("${String(data.description ?? "").slice(0, 60)}") from the stored copy – it is its own item, not a duplicate` });
      }
    });
    tx();

    // Locked latest reports whose stored copy still carries early warnings the live register no longer has.
    let storedAgain = 0;
    const programmes = db.prepare("SELECT id FROM programmes").all() as { id: number }[];
    for (const p of programmes) {
      const latest = latestPeriod(db, p.id);
      if (!latest || latest.status !== "Locked" || !hasStoredCopy(db, latest.id)) continue;
      const stored = (db.prepare("SELECT record_id FROM snapshots WHERE period_id = ? AND register_key = 'early_warnings'").all(latest.id) as { record_id: number }[]).map((r) => r.record_id);
      const live = new Set((db.prepare("SELECT id FROM early_warnings WHERE programme_id = ?").all(p.id) as { id: number }[]).map((r) => r.id));
      const gone = stored.filter((id) => !live.has(id));
      if (!gone.length) continue;
      const r = takeSnapshot(latest.id, null, "lock");
      logAudit(db, { registerKey: "reporting_periods", recordId: latest.id, action: "lock", user: null, summary: `Stored ${latest.label} again from the live registers (${r.records} record(s)) – its earlier stored copy still counted ${gone.length} duplicated early warning(s)` });
      storedAgain++;
    }
    if (restored || renumbered || storedAgain) console.log(`[repair] early warnings: ${restored} restored, ${renumbered} given their own number back, ${storedAgain} report(s) stored again`);
  } catch (e) {
    console.warn("[repair] early warnings skipped:", e);
    return;
  }
  setSetting(db, "repaired_early_warnings", "1");
}
