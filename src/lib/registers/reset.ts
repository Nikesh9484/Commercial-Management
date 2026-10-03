import type Database from "better-sqlite3";
import { getDb } from "../db";
import { formatDate, formatMoney } from "../format";
import { snapshotRows } from "../view-mode";
import { assertCanEdit, deleteRecord, getRecord, lookupOptions, updateRecord, ValidationError } from "./engine";
import { isEditorRole, type FieldDef, type RecordRow, type RegisterDef, type UserInfo } from "./types";

/**
 * "Reset to the previous report": an entry goes back to how it stood in the last issued report, and an
 * entry added since is removed. Registers kept in the month-end copy (contracts, payment applications)
 * are reset from that copy; the others (bonds and insurance) from their change history – every change
 * logged since the report was issued is undone, newest first.
 */
export interface ResetPreview {
  report: string;
  /** restore – values go back; remove – the entry was added after the report; none – already as issued */
  action: "restore" | "remove" | "none";
  changes: { label: string; from: string; to: string }[];
  /** fields the history could not take back (a lookup whose label no longer exists) */
  skipped: string[];
  canApply: boolean;
  why: string;
}

interface Period {
  id: number;
  label: string;
  report_no: number;
  locked_at: string | null;
  period_end: string | null;
}

/** The last issued report of the programme: the newest locked period, else the newest earlier one with a stored copy. */
export function previousReport(db: Database.Database, programmeId: number): Period | null {
  const locked = db.prepare("SELECT id, label, report_no, locked_at, period_end FROM reporting_periods WHERE programme_id = ? AND status = 'Locked' ORDER BY report_no DESC LIMIT 1").get(programmeId) as Period | undefined;
  if (locked) return locked;
  const latest = db.prepare("SELECT report_no FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC LIMIT 1").get(programmeId) as { report_no: number } | undefined;
  if (!latest) return null;
  return (
    (db
      .prepare("SELECT p.id, p.label, p.report_no, p.locked_at, p.period_end FROM reporting_periods p WHERE p.programme_id = ? AND p.report_no < ? AND EXISTS (SELECT 1 FROM snapshots s WHERE s.period_id = p.id) ORDER BY p.report_no DESC LIMIT 1")
      .get(programmeId, latest.report_no) as Period | undefined) ?? null
  );
}

const show = (f: FieldDef, v: unknown, row?: RecordRow): string => {
  if (v === null || v === undefined || v === "") return "–";
  if (f.type === "boolean") return v === true || Number(v) === 1 || v === "Yes" ? "Yes" : "No";
  if (f.type === "money") return formatMoney(Number(v));
  if (f.type === "date") return formatDate(String(v));
  if (f.type === "lookup" && row && row[`${f.key}__label`]) return String(row[`${f.key}__label`]);
  return String(v);
};

/** The fields an entry is reset on: everything stored, apart from the project it belongs to. */
const resettable = (def: RegisterDef) => def.fields.filter((f) => !f.virtual && f.type !== "password" && f.key !== "programme_id" && !f.readonly);

function fromSnapshot(db: Database.Database, def: RegisterDef, current: RecordRow, period: Period): { stored: RecordRow | null; has: boolean } {
  const rows = snapshotRows<RecordRow>(db, period.id, def.key);
  if (!rows) return { stored: null, has: false };
  return { stored: rows.find((r) => Number(r.id) === Number(current.id)) ?? null, has: true };
}

/**
 * The entry as it stood when the report was issued, worked back from its change history: a create
 * since then means it did not exist; every update since then is undone, newest first.
 */
function fromHistory(db: Database.Database, def: RegisterDef, current: RecordRow, period: Period): { stored: RecordRow | null; existed: boolean; skipped: string[]; touched: boolean } {
  // the moment the report was issued: the lock as logged (to the second); else the end of the lock day
  const lock = db.prepare("SELECT at FROM audit_log WHERE register_key = 'reporting_periods' AND record_id = ? AND action = 'lock' ORDER BY at DESC LIMIT 1").get(period.id) as { at: string } | undefined;
  const day = period.locked_at ?? period.period_end ?? "";
  const since = lock?.at ?? (day.length === 10 ? `${day}T23:59:59.999Z` : day);
  const entries = db
    .prepare("SELECT action, summary, changes FROM audit_log WHERE register_key = ? AND record_id = ? AND at > ? ORDER BY at DESC, id DESC")
    .all(def.key, Number(current.id), since) as { action: string; summary: string; changes: string | null }[];
  const stored: RecordRow = { ...current };
  const skipped = new Set<string>();
  let existed = true;
  for (const e of entries) {
    const created = e.action === "create" || (e.action === "import" && /^(Imported|Added) /.test(e.summary) && !/^Imported update/.test(e.summary));
    if (created) {
      existed = false;
      break;
    }
    const changes = e.changes ? (JSON.parse(e.changes) as Record<string, { from: unknown; to: unknown }>) : {};
    for (const [k, c] of Object.entries(changes)) {
      const f = def.fields.find((x) => x.key === k);
      if (!f || f.virtual || f.type === "password") continue;
      const from = c.from;
      if (f.type === "boolean") stored[k] = from === null || from === undefined ? null : from === "Yes" || from === true || Number(from) === 1;
      else if (f.type === "lookup" && f.lookup) {
        if (from === null || from === undefined || from === "") stored[k] = null;
        else {
          const hit = lookupOptions(db, f.lookup.register, true).find((o) => o.label === String(from) || o.id === Number(from));
          if (hit) stored[k] = hit.id;
          else skipped.add(f.label);
        }
      } else stored[k] = from ?? null;
    }
  }
  return { stored: existed ? stored : null, existed, skipped: [...skipped], touched: entries.length > 0 };
}

function plan(db: Database.Database, def: RegisterDef, current: RecordRow): { period: Period; stored: RecordRow | null; action: ResetPreview["action"]; changes: ResetPreview["changes"]; skipped: string[]; patch: Record<string, unknown> } {
  const programmeId = Number(current.programme_id);
  const period = previousReport(db, programmeId);
  if (!period) throw new ValidationError("There is no issued report to reset to yet – lock a reporting period first.");
  let stored: RecordRow | null = null;
  let skipped: string[] = [];
  let decided = false;
  if (def.snapshot) {
    const snap = fromSnapshot(db, def, current, period);
    if (snap.has) {
      stored = snap.stored;
      decided = true;
    }
  }
  if (!decided) {
    const h = fromHistory(db, def, current, period);
    stored = h.stored;
    skipped = h.skipped;
    if (h.existed && !h.touched) return { period, stored: current, action: "none", changes: [], skipped, patch: {} };
  }
  if (!stored) return { period, stored: null, action: "remove", changes: [], skipped, patch: {} };
  const patch: Record<string, unknown> = {};
  const changes: ResetPreview["changes"] = [];
  for (const f of resettable(def)) {
    if (!(f.key in stored)) continue;
    const was = stored[f.key];
    const now = current[f.key];
    if (show(f, was, stored) === show(f, now, current)) continue;
    patch[f.key] = was ?? null;
    changes.push({ label: f.label, from: show(f, now, current), to: show(f, was, stored) });
  }
  return { period, stored, action: changes.length ? "restore" : "none", changes, skipped, patch };
}

export function previewReset(def: RegisterDef, id: number, user: UserInfo): ResetPreview {
  const db = getDb();
  const current = getRecord(def, id);
  if (!current) throw new ValidationError(`${def.singular} #${id} was not found (it may have been deleted).`);
  const p = plan(db, def, current);
  const canApply = p.action === "remove" ? isEditorRole(user.role) : true;
  const why =
    p.action === "none"
      ? `Already as it stood in ${p.period.label} – nothing to reset.`
      : p.action === "remove"
        ? `This entry was added after ${p.period.label} was issued; resetting removes it.${canApply ? "" : " Only an admin or editor can remove an entry."}`
        : `${p.changes.length} field(s) go back to how they stood in ${p.period.label}.`;
  return { report: p.period.label, action: p.action, changes: p.changes, skipped: p.skipped, canApply, why };
}

export function resetRecord(def: RegisterDef, id: number, user: UserInfo): { action: ResetPreview["action"]; report: string; row: RecordRow | null } {
  assertCanEdit(def, user);
  const db = getDb();
  const current = getRecord(def, id);
  if (!current) throw new ValidationError(`${def.singular} #${id} was not found (it may have been deleted).`);
  const p = plan(db, def, current);
  if (p.action === "none") return { action: "none", report: p.period.label, row: current };
  if (p.action === "remove") {
    deleteRecord(def, id, user);
    return { action: "remove", report: p.period.label, row: null };
  }
  const row = updateRecord(def, id, p.patch, user, "form");
  return { action: "restore", report: p.period.label, row };
}
