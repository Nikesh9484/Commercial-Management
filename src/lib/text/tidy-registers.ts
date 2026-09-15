import type Database from "better-sqlite3";
import type { UserInfo } from "../registers/types";
import { allRegisters } from "../registers";
import { tidyText, needsTidy } from "./tidy";
import { logAudit } from "../audit";

/**
 * Tidies the wording already in the registers, for rows imported before the wording was tidied on the
 * way in. Wording only – the same fields the import tidies, nothing else – so no figure, reference or
 * date is touched, and running it a second time changes nothing.
 */

const FIELDS = new Set(["description", "scope", "remark", "comments", "last_action"]);

export interface TidyPreview {
  register: string;
  title: string;
  field: string;
  id: number;
  before: string;
  after: string;
}

function targets(db: Database.Database, programmeId: number | null): { table: string; key: string; title: string; field: string; scoped: boolean }[] {
  const out: { table: string; key: string; title: string; field: string; scoped: boolean }[] = [];
  for (const def of allRegisters) {
    const cols = db.prepare(`PRAGMA table_info("${def.table}")`).all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    const scoped = names.has("programme_id");
    for (const f of def.fields) {
      if (!FIELDS.has(f.key) || f.virtual || !names.has(f.key)) continue;
      if (f.type !== "text" && f.type !== "textarea") continue;
      out.push({ table: def.table, key: def.key, title: def.title, field: f.key, scoped: scoped && programmeId !== null });
    }
  }
  return out;
}

/** What would change, without changing it. */
export function previewTidy(db: Database.Database, programmeId: number | null, limit = 500): TidyPreview[] {
  const out: TidyPreview[] = [];
  for (const t of targets(db, programmeId)) {
    const where = t.scoped ? "WHERE programme_id = ?" : "";
    const rows = db.prepare(`SELECT id, "${t.field}" AS v FROM "${t.table}" ${where}`).all(...(t.scoped ? [programmeId] : [])) as { id: number; v: unknown }[];
    for (const r of rows) {
      if (!needsTidy(r.v)) continue;
      out.push({ register: t.key, title: t.title, field: t.field, id: r.id, before: String(r.v), after: tidyText(r.v) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * The issued reports hold their own copy of each row, taken when the period was locked. Those copies
 * are what an issued month shows on screen and in its downloads, so the wording has to be tidied
 * there too – otherwise the live register reads properly and last month's report still shouts. The
 * copy is only re-worded: no figure, date or reference in it is touched, so the report still says
 * exactly what it said when it was issued.
 */
function tidySnapshots(db: Database.Database, user: UserInfo | null): number {
  const rows = db.prepare("SELECT id, data FROM snapshots").all() as { id: number; data: string }[];
  const update = db.prepare("UPDATE snapshots SET data = ? WHERE id = ?");
  let changed = 0;
  for (const r of rows) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(r.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    let touched = false;
    for (const k of Object.keys(obj)) {
      if (!FIELDS.has(k) || typeof obj[k] !== "string") continue;
      if (!needsTidy(obj[k])) continue;
      obj[k] = tidyText(obj[k]);
      touched = true;
    }
    if (!touched) continue;
    update.run(JSON.stringify(obj), r.id);
    changed += 1;
  }
  if (changed) {
    logAudit(db, {
      registerKey: "snapshots",
      recordId: null,
      action: "update",
      user,
      summary: `Tidied the wording inside ${changed} issued-report row(s), so an issued month reads the same as the live register. No figure, reference or date was changed.`,
    });
  }
  return changed;
}

export interface TidyResult {
  changed: number;
  snapshots: number;
  byRegister: { title: string; field: string; changed: number }[];
}

/** Does it. One transaction, with an audit entry per register so the change can be read back. */
export function tidyRegisters(db: Database.Database, programmeId: number | null, user: UserInfo | null): TidyResult {
  const result: TidyResult = { changed: 0, snapshots: 0, byRegister: [] };
  const run = db.transaction(() => {
    for (const t of targets(db, programmeId)) {
      const where = t.scoped ? "WHERE programme_id = ?" : "";
      const rows = db.prepare(`SELECT id, "${t.field}" AS v FROM "${t.table}" ${where}`).all(...(t.scoped ? [programmeId] : [])) as { id: number; v: unknown }[];
      const update = db.prepare(`UPDATE "${t.table}" SET "${t.field}" = ? WHERE id = ?`);
      let n = 0;
      for (const r of rows) {
        if (!needsTidy(r.v)) continue;
        update.run(tidyText(r.v), r.id);
        n += 1;
      }
      if (!n) continue;
      result.changed += n;
      result.byRegister.push({ title: t.title, field: t.field, changed: n });
      logAudit(db, {
        registerKey: t.key,
        recordId: null,
        action: "update",
        user,
        summary: `Tidied the wording of ${n} "${t.field}" value(s): spelling, block capitals and spacing. No figure, reference or date was changed.`,
      });
    }
    result.snapshots = tidySnapshots(db, user);
  });
  run();
  return result;
}
