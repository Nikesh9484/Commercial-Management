import type Database from "better-sqlite3";
import type { UserInfo } from "../registers/types";
import { contractorKey } from "../bonds/name-key";
import { logAudit } from "../audit";

/**
 * One company, one record. A register filled from two places ends up with the same company twice –
 * "Sydney Seaplanes Asia Limited" and "Sydney Seaplanes Asia Limited." – which splits every
 * contractor-wise summary, hides a replacement policy behind the other spelling, and stops a closure
 * recorded against one row from reaching the bonds filed against the other.
 *
 * Only names that are the same once full stops, spaces and capitals are taken out are merged. Two
 * names that merely look related ("WSP Middle East" and "WSP Consulting") are never merged here:
 * deciding those is a judgement about the contract, not about spelling, and getting it wrong would
 * move real records under the wrong company with no way back.
 */

export interface DuplicateGroup {
  /** The name squashed to letters and digits – what makes these rows the same company. */
  key: string;
  /** The row everything will be moved onto. */
  keep: { id: number; name: string; links: number };
  /** The rows that will be emptied and removed. */
  merge: { id: number; name: string; links: number }[];
  /** How many records will move. */
  moves: number;
}

/** Every table that points at a contractor, discovered from the database rather than listed here,
 *  so a register added later is covered without anyone remembering to come back to this file. */
export function contractorTables(db: Database.Database): string[] {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  return tables.filter((t) => {
    if (t === "contractors") return false;
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[];
    return cols.some((c) => c.name === "contractor_id");
  });
}

function linkCount(db: Database.Database, tables: string[], id: number): number {
  let n = 0;
  for (const t of tables) n += Number((db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE contractor_id = ?`).get(id) as { c: number }).c);
  return n;
}

/**
 * Which contractors are the same company under different spellings. The row kept is the one carrying
 * the most records – the one the contracts and final accounts are already filed against – and, where
 * that is equal, the fullest spelling, since that is usually the complete legal name.
 */
export function duplicateContractors(db: Database.Database): DuplicateGroup[] {
  const tables = contractorTables(db);
  const rows = db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string | null }[];
  const byKey = new Map<string, { id: number; name: string }[]>();
  for (const r of rows) {
    const k = contractorKey(r.name);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), { id: r.id, name: String(r.name ?? "") }]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const scored = list
      .map((c) => ({ ...c, links: linkCount(db, tables, c.id) }))
      .sort((a, b) => b.links - a.links || b.name.length - a.name.length || a.id - b.id);
    const [keep, ...merge] = scored;
    groups.push({ key, keep, merge, moves: merge.reduce((t, m) => t + m.links, 0) });
  }
  return groups.sort((a, b) => b.moves - a.moves || a.keep.name.localeCompare(b.keep.name));
}

export interface MergeResult {
  groups: number;
  removed: number;
  moved: number;
  detail: { kept: string; removed: string[]; moved: number }[];
}

/**
 * Does the merge, all of it or none of it. Every record pointing at a duplicate is repointed at the
 * row being kept and the duplicate row is then removed; the audit log keeps what was merged into
 * what, so the change can be read back later even though the rows themselves are gone.
 */
export function mergeDuplicateContractors(db: Database.Database, user: UserInfo | null, only?: string[]): MergeResult {
  const tables = contractorTables(db);
  const wanted = only && only.length ? new Set(only) : null;
  const groups = duplicateContractors(db).filter((g) => !wanted || wanted.has(g.key));
  const result: MergeResult = { groups: 0, removed: 0, moved: 0, detail: [] };
  if (!groups.length) return result;

  const run = db.transaction(() => {
    for (const g of groups) {
      const ids = g.merge.map((m) => m.id);
      if (!ids.length) continue;
      const holes = ids.map(() => "?").join(",");
      let moved = 0;
      for (const t of tables) {
        moved += Number(db.prepare(`UPDATE "${t}" SET contractor_id = ? WHERE contractor_id IN (${holes})`).run(g.keep.id, ...ids).changes);
      }
      db.prepare(`DELETE FROM contractors WHERE id IN (${holes})`).run(...ids);
      logAudit(db, {
        registerKey: "contractors",
        recordId: g.keep.id,
        action: "update",
        user,
        summary: `Merged ${g.merge.length} duplicate contractor record(s) into "${g.keep.name}": ${g.merge.map((m) => `"${m.name}"`).join(", ")}. ${moved} record(s) moved.`,
        changes: { merged: { from: g.merge.map((m) => `${m.name} (#${m.id})`), to: `${g.keep.name} (#${g.keep.id})` } },
      });
      result.groups += 1;
      result.removed += ids.length;
      result.moved += moved;
      result.detail.push({ kept: g.keep.name, removed: g.merge.map((m) => m.name), moved });
    }
  });
  run();
  return result;
}
