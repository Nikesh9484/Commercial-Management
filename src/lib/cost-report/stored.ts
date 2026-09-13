import Database from "better-sqlite3";

/** Lookup tables copied whole: names, codes and statuses are not part of a period's stored copy. */
const LOOKUPS = new Set(["programmes", "assets", "packages", "contractors", "cost_categories", "approval_statuses", "project_stages", "change_categories", "change_initiators", "clients", "locations", "bond_types", "ps_statuses"]);
/** Stored copies that are results, not registers. */
const RESULTS = new Set(["cost_report", "cashflow"]);
/** Never copied into the working database. */
const PRIVATE = new Set(["snapshots", "audit_log", "users", "sqlite_sequence", "app_settings", "library_docs", "ear_files"]);

/**
 * Opens an in-memory database holding the registers of a stored reporting period (locked, or no longer
 * the latest) exactly as they were when that period was stored. The cost report of an earlier report is
 * recalculated from these rows with the current rules, so a rule fixed after the report was stored reads
 * the same way on every report, instead of showing the copy calculated at the time.
 *
 * Returns null when the period has no stored cost lines (older stored copies), in which case the caller
 * falls back to the stored copy of the calculated report. The caller closes the returned database.
 */
export function openStoredRegisters(db: Database.Database, periodId: number): Database.Database | null {
  const keys = new Set((db.prepare("SELECT DISTINCT register_key FROM snapshots WHERE period_id = ?").all(periodId) as { register_key: string }[]).map((r) => r.register_key));
  if (!keys.has("cost_lines")) return null;
  const file = db.name;
  if (!file || file === ":memory:") return null;
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name).filter((t) => !PRIVATE.has(t) && !RESULTS.has(t));
  const mem = new Database(":memory:");
  try {
    mem.prepare("ATTACH DATABASE ? AS live").run(file);
    const read = db.prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = ? ORDER BY record_id");
    for (const t of tables) {
      if (LOOKUPS.has(t)) {
        mem.exec(`CREATE TABLE "${t}" AS SELECT * FROM live."${t}"`);
        continue;
      }
      // every register table exists (empty) so the feeds can query it; the stored rows fill the ones stored
      mem.exec(`CREATE TABLE "${t}" AS SELECT * FROM live."${t}" WHERE 0`);
      if (!keys.has(t)) continue;
      const cols = (mem.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
      const ins = mem.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
      const rows = read.all(periodId, t) as { data: string }[];
      mem.transaction(() => {
        for (const r of rows) {
          const d = JSON.parse(r.data) as Record<string, unknown>;
          ins.run(...cols.map((c) => cellValue(d[c])));
        }
      })();
    }
    mem.exec("DETACH DATABASE live");
    return mem;
  } catch (e) {
    mem.close();
    throw e;
  }
}

function cellValue(v: unknown): string | number | null | bigint | Buffer {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string" || typeof v === "bigint" || Buffer.isBuffer(v)) return v;
  return JSON.stringify(v);
}
