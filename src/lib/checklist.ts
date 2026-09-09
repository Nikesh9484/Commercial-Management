import { getDb } from "./db";
import { modules } from "./modules";
import { logAudit } from "./audit";
import { nowIso } from "./format";
import type { UserInfo } from "./registers/types";
import { AuthError } from "./auth";
import { ValidationError } from "./registers/engine";
import { DEFAULT_TEAM_ROLES } from "./registers/defs/project-setup";

export interface ChecklistItem {
  id: number;
  period_id: number;
  module_no: number;
  title: string;
  slug: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  comment: string | null;
}

type Raw = { id: number; period_id: number; module_no: number; done: number; done_by: string | null; done_at: string | null; comment: string | null };

/** One checklist row per module for the period (rows are created the first time they are needed). */
export function getChecklist(periodId: number): ChecklistItem[] {
  const db = getDb();
  const ins = db.prepare("INSERT OR IGNORE INTO report_checklist(period_id, module_no) VALUES(?, ?)");
  for (const m of modules) ins.run(periodId, m.no);
  const rows = db.prepare("SELECT * FROM report_checklist WHERE period_id = ? ORDER BY module_no").all(periodId) as Raw[];
  return rows
    .map((r) => {
      const m = modules.find((x) => x.no === r.module_no);
      if (!m) return null;
      return { ...r, done: r.done === 1, title: m.title, slug: m.slug };
    })
    .filter((x): x is ChecklistItem => x !== null);
}

export function setChecklistItem(id: number, input: { done?: boolean; comment?: string | null }, user: UserInfo): ChecklistItem {
  if (user.role === "viewer") throw new AuthError("Viewers cannot change the report checklist.");
  const db = getDb();
  const row = db.prepare("SELECT * FROM report_checklist WHERE id = ?").get(id) as Raw | undefined;
  if (!row) throw new ValidationError("Checklist item not found.");
  const mod = modules.find((m) => m.no === row.module_no);
  const period = db.prepare("SELECT label FROM reporting_periods WHERE id = ?").get(row.period_id) as { label: string } | undefined;
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (input.done !== undefined && (input.done ? 1 : 0) !== row.done) {
    db.prepare("UPDATE report_checklist SET done = ?, done_by = ?, done_at = ? WHERE id = ?").run(input.done ? 1 : 0, input.done ? user.name : null, input.done ? nowIso() : null, id);
    changes.status = { from: row.done ? "Done" : "Not Done", to: input.done ? "Done" : "Not Done" };
  }
  if (input.comment !== undefined) {
    const c = input.comment?.trim() || null;
    if (c !== (row.comment ?? null)) {
      db.prepare("UPDATE report_checklist SET comment = ? WHERE id = ?").run(c, id);
      changes.comment = { from: row.comment, to: c };
    }
  }
  if (Object.keys(changes).length) {
    logAudit(db, {
      registerKey: "report_checklist",
      recordId: id,
      action: "update",
      user,
      summary: `Checklist · ${period?.label ?? "period"} · ${mod?.title ?? `Module ${row.module_no}`}: ${changes.status ? String(changes.status.to) : "comment updated"}`,
      changes,
    });
  }
  return getChecklist(row.period_id).find((x) => x.id === id)!;
}

/** Creates the standard distribution roles for a programme that has no team list yet. */
export function ensureDefaultTeam(programmeId: number) {
  const db = getDb();
  const n = (db.prepare("SELECT COUNT(*) AS n FROM project_team WHERE programme_id = ?").get(programmeId) as { n: number }).n;
  if (n > 0) return;
  const stamp = nowIso();
  const ins = db.prepare(
    `INSERT INTO project_team(programme_id, sort_order, role, in_distribution, created_at, created_by, updated_at, updated_by) VALUES(?, ?, ?, 1, ?, 'system', ?, 'system')`,
  );
  DEFAULT_TEAM_ROLES.forEach((role, i) => ins.run(programmeId, (i + 1) * 10, role, stamp, stamp));
}
