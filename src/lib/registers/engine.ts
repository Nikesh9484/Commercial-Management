import type Database from "better-sqlite3";
import { getDb, columnFor, getSetting } from "../db";
import { getRegisterDef, allRegisters } from "./index";
import type { FieldDef, LookupOption, RecordRow, RegisterDef, UserInfo } from "./types";
import { canEditRegister, canViewRegister } from "./types";
import { logAudit } from "../audit";
import { hashPassword, AuthError } from "../auth";
import { nowIso, parseDateInput, formatMonthYear } from "../format";

export class ValidationError extends Error {
  status = 400;
  fieldErrors: Record<string, string>;
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

export function requireDef(key: string): RegisterDef {
  const def = getRegisterDef(key);
  if (!def) throw new ValidationError(`Unknown register "${key}".`);
  return def;
}

export function assertCanView(def: RegisterDef, user: UserInfo) {
  if (!canViewRegister(def, user.role)) throw new AuthError("You do not have access to this register.");
}

export function assertCanEdit(def: RegisterDef, user: UserInfo) {
  if (!canEditRegister(def, user.role)) throw new AuthError("Your role is view-only for this register.");
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function selectColumns(def: RegisterDef): string {
  const cols = ["id", "created_at", "created_by", "updated_at", "updated_by"];
  for (const f of def.fields) {
    if (f.type === "password") continue; // never returned
    cols.push(`"${f.key}"`);
  }
  return cols.join(", ");
}

export function lookupOptions(db: Database.Database, registerKey: string, includeInactive = false): LookupOption[] {
  const def = requireDef(registerKey);
  const hasActive = def.fields.some((f) => f.key === "active");
  const hasOrder = def.fields.some((f) => f.key === "sort_order");
  const where = hasActive && !includeInactive ? "WHERE active = 1 OR active IS NULL" : "";
  const order = hasOrder ? `ORDER BY sort_order ASC, "${def.displayField}" COLLATE NOCASE ASC` : `ORDER BY "${def.displayField}" COLLATE NOCASE ASC`;
  const rows = db.prepare(`SELECT id, "${def.displayField}" AS label FROM "${def.table}" ${where} ${order}`).all() as LookupOption[];
  return rows.map((r) => ({ id: r.id, label: String(r.label ?? "") }));
}

/** The `programme_id` / `asset_id` value new rows get, based on the top-bar selection. */
export function scopeDefaults(def: RegisterDef): Record<string, number> {
  if (!def.scope) return {};
  const db = getDb();
  const key = def.scope === "programme" ? "programme_id" : "asset_id";
  const value = getSetting(db, `current_${key}`);
  return value ? { [key]: Number(value) } : {};
}

/** All rows of a register with lookup labels attached as `<field>__label`. */
export function listRecords(def: RegisterDef, options: { allScopes?: boolean } = {}): RecordRow[] {
  const db = getDb();
  const sort = def.defaultSort ?? { field: "id", dir: "asc" };
  const scope = options.allScopes ? {} : scopeDefaults(def);
  const [scopeKey, scopeValue] = Object.entries(scope)[0] ?? [];
  const where = scopeKey ? `WHERE "${scopeKey}" = ?` : "";
  const rows = db
    .prepare(`SELECT ${selectColumns(def)} FROM "${def.table}" ${where} ORDER BY "${sort.field}" ${sort.dir === "desc" ? "DESC" : "ASC"}, id ASC`)
    .all(...(scopeKey ? [scopeValue] : [])) as RecordRow[];
  attachLabels(db, def, rows);
  return rows.map(normaliseRow(def));
}

export function getRecord(def: RegisterDef, id: number): RecordRow | null {
  const db = getDb();
  const row = db.prepare(`SELECT ${selectColumns(def)} FROM "${def.table}" WHERE id = ?`).get(id) as RecordRow | undefined;
  if (!row) return null;
  attachLabels(db, def, [row]);
  return normaliseRow(def)(row);
}

function attachLabels(db: Database.Database, def: RegisterDef, rows: RecordRow[]) {
  for (const f of def.fields) {
    if (f.type !== "lookup" || !f.lookup) continue;
    const map = new Map(lookupOptions(db, f.lookup.register, true).map((o) => [o.id, o.label]));
    for (const r of rows) {
      const v = r[f.key];
      r[`${f.key}__label`] = v === null || v === undefined ? "" : (map.get(Number(v)) ?? "");
    }
  }
}

function normaliseRow(def: RegisterDef) {
  const boolKeys = def.fields.filter((f) => f.type === "boolean").map((f) => f.key);
  return (r: RecordRow): RecordRow => {
    for (const k of boolKeys) r[k] = r[k] === null || r[k] === undefined ? null : Number(r[k]) === 1;
    return r;
  };
}

/** Lookup options for every lookup field of a register (used by the form). */
export function lookupsFor(def: RegisterDef): Record<string, LookupOption[]> {
  const db = getDb();
  const out: Record<string, LookupOption[]> = {};
  for (const f of def.fields) {
    if (f.type === "lookup" && f.lookup) out[f.key] = lookupOptions(db, f.lookup.register, true);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Validation / coercion                                               */
/* ------------------------------------------------------------------ */

function coerce(field: FieldDef, raw: unknown, errors: Record<string, string>): unknown {
  const empty = raw === null || raw === undefined || raw === "";
  switch (field.type) {
    case "text":
    case "textarea": {
      const v = empty ? null : String(raw).trim();
      return v === "" ? null : v;
    }
    case "password":
      return empty ? null : String(raw);
    case "number":
    case "money":
    case "percent": {
      if (empty) return null;
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").replace(/SAR/i, "").trim());
      if (Number.isNaN(n)) {
        errors[field.key] = `${field.label} must be a number.`;
        return null;
      }
      return n;
    }
    case "date": {
      if (empty) return null;
      const iso = parseDateInput(raw);
      if (!iso) errors[field.key] = `${field.label} is not a valid date (use DD-MMM-YY).`;
      return iso;
    }
    case "boolean": {
      if (empty) return null;
      if (typeof raw === "boolean") return raw ? 1 : 0;
      const s = String(raw).trim().toLowerCase();
      if (["1", "true", "yes", "y"].includes(s)) return 1;
      if (["0", "false", "no", "n"].includes(s)) return 0;
      errors[field.key] = `${field.label} must be Yes or No.`;
      return null;
    }
    case "select": {
      if (empty) return null;
      const s = String(raw).trim();
      const match = (field.options ?? []).find((o) => o.toLowerCase() === s.toLowerCase());
      if (!match) {
        errors[field.key] = `${field.label} must be one of: ${(field.options ?? []).join(", ")}.`;
        return null;
      }
      return match;
    }
    case "lookup": {
      if (empty) return null;
      if (typeof raw === "number") return raw;
      const s = String(raw).trim();
      if (/^\d+$/.test(s)) return Number(s);
      // Allow the label (e.g. "Early Works") - used by Excel import.
      const opts = lookupOptions(getDb(), field.lookup!.register, true);
      const hit = opts.find((o) => o.label.toLowerCase() === s.toLowerCase());
      if (!hit) {
        errors[field.key] = `${field.label} "${s}" was not found in ${field.lookup!.register.replace(/_/g, " ")}.`;
        return null;
      }
      return hit.id;
    }
  }
}

interface Prepared {
  values: Record<string, unknown>; // column -> value
  display: Record<string, unknown>; // key -> human value for audit
}

function prepareInput(def: RegisterDef, input: Record<string, unknown>, mode: "create" | "update", existing?: RecordRow): Prepared {
  const errors: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const display: Record<string, unknown> = {};

  for (const f of def.fields) {
    const provided = Object.prototype.hasOwnProperty.call(input, f.key);
    if (f.readonly && mode === "update") continue; // system-managed
    if (f.readonly && mode === "create" && !provided) {
      if (f.defaultValue !== undefined) {
        values[columnFor(f)] = f.type === "boolean" ? (f.defaultValue ? 1 : 0) : f.defaultValue;
        display[f.key] = f.defaultValue;
      }
      continue;
    }
    if (!provided) {
      if (mode === "create" && f.defaultValue !== undefined) {
        values[columnFor(f)] = f.type === "boolean" ? (f.defaultValue ? 1 : 0) : f.defaultValue;
        display[f.key] = f.defaultValue;
      } else if (mode === "create" && f.required && f.type !== "password") {
        errors[f.key] = `${f.label} is required.`;
      }
      continue;
    }
    let v = coerce(f, input[f.key], errors);
    if (f.type === "password") {
      if (v === null) {
        if (mode === "create") errors[f.key] = "Password is required for a new user.";
        continue;
      }
      if (String(v).length < 8) {
        errors[f.key] = "Password must be at least 8 characters.";
        continue;
      }
      values[columnFor(f)] = hashPassword(String(v));
      display[f.key] = "(changed)";
      continue;
    }
    if (f.required && (v === null || v === undefined)) errors[f.key] = `${f.label} is required.`;
    if (f.type === "text" && f.key === "email" && v) v = String(v).toLowerCase();
    values[columnFor(f)] = v;
    display[f.key] = v;
  }

  // Uniqueness
  const db = getDb();
  for (const f of def.fields) {
    if (!f.unique || !(f.key in values) || values[f.key] === null) continue;
    const clash = db
      .prepare(`SELECT id FROM "${def.table}" WHERE "${f.key}" = ? COLLATE NOCASE ${existing ? "AND id <> ?" : ""}`)
      .get(...(existing ? [values[f.key], existing.id] : [values[f.key]])) as { id: number } | undefined;
    if (clash) errors[f.key] = `${f.label} "${values[f.key]}" already exists.`;
  }

  if (Object.keys(errors).length) throw new ValidationError("Please fix the highlighted fields.", errors);
  return { values, display };
}

/* ------------------------------------------------------------------ */
/* Register-specific rules (kept small; bigger logic lives in modules) */
/* ------------------------------------------------------------------ */

function applyRules(def: RegisterDef, prepared: Prepared, mode: "create" | "update", existing: RecordRow | undefined, user: UserInfo) {
  if (def.key === "reporting_periods") {
    const end = (prepared.values.period_end as string | undefined) ?? (existing?.period_end as string | undefined);
    const no = (prepared.values.report_no as number | undefined) ?? (existing?.report_no as number | undefined);
    const label = prepared.values.label as string | null | undefined;
    if ((label === null || label === undefined || label === "") && end && no !== undefined && (mode === "create" || "label" in prepared.values || "period_end" in prepared.values || "report_no" in prepared.values)) {
      prepared.values.label = `Monthly Report No ${no} – ${formatMonthYear(end)}`;
      prepared.display.label = prepared.values.label;
    }
    if (existing && existing.status === "Locked" && mode === "update") {
      const structural = ["report_no", "period_start", "period_end"];
      if (Object.keys(prepared.values).some((k) => structural.includes(k))) {
        throw new ValidationError("This period is locked. Unlock it first to change its number or dates.");
      }
    }
  }
  if (def.key === "users" && mode === "update" && existing) {
    if (existing.id === user.id && prepared.values.role && prepared.values.role !== "admin") {
      throw new ValidationError("You cannot remove your own Admin role.", { role: "You cannot change your own role." });
    }
    if (existing.id === user.id && prepared.values.active === 0) {
      throw new ValidationError("You cannot deactivate your own account.", { active: "You cannot deactivate yourself." });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export function createRecord(def: RegisterDef, input: Record<string, unknown>, user: UserInfo, source: "form" | "import" = "form"): RecordRow {
  assertCanEdit(def, user);
  const db = getDb();
  const withScope = { ...scopeDefaults(def), ...input };
  for (const [k, v] of Object.entries(scopeDefaults(def))) if (withScope[k] === null || withScope[k] === undefined || withScope[k] === "") withScope[k] = v;
  const prepared = prepareInput(def, withScope, "create");
  applyRules(def, prepared, "create", undefined, user);
  const stamp = nowIso();
  const cols = [...Object.keys(prepared.values), "created_at", "created_by", "updated_at", "updated_by"];
  const vals = [...Object.values(prepared.values), stamp, user.name, stamp, user.name];
  const result = db
    .prepare(`INSERT INTO "${def.table}"(${cols.map((c) => `"${c}"`).join(", ")}) VALUES(${cols.map(() => "?").join(", ")})`)
    .run(...(vals as never[]));
  const id = Number(result.lastInsertRowid);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(prepared.display)) if (v !== null && v !== undefined && v !== "") changes[k] = { from: null, to: v };
  logAudit(db, {
    registerKey: def.key,
    recordId: id,
    action: source === "import" ? "import" : "create",
    user,
    summary: `${source === "import" ? "Imported" : "Added"} ${def.singular} "${describe(def, prepared.display)}"`,
    changes,
  });
  return getRecord(def, id)!;
}

export function updateRecord(
  def: RegisterDef,
  id: number,
  input: Record<string, unknown>,
  user: UserInfo,
  source: "form" | "import" = "form",
  options: { bypassRoles?: boolean } = {},
): RecordRow {
  if (!options.bypassRoles) assertCanEdit(def, user);
  const db = getDb();
  const existing = getRecord(def, id);
  if (!existing) throw new ValidationError(`${def.singular} #${id} was not found (it may have been deleted).`);
  const prepared = prepareInput(def, input, "update", existing);
  applyRules(def, prepared, "update", existing, user);

  // Only keep what actually changed.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, v] of Object.entries(prepared.display)) {
    const field = def.fields.find((f) => f.key === key)!;
    if (field.type === "password") {
      changes[key] = { from: "••••", to: "(changed)" };
      continue;
    }
    const before = field.type === "boolean" ? (existing[key] === null ? null : existing[key] ? 1 : 0) : existing[key];
    const same = (before ?? null) === (v ?? null) || (typeof before === "number" && typeof v === "number" && Math.abs(before - v) < 1e-9);
    if (same) {
      delete prepared.values[columnFor(field)];
      continue;
    }
    changes[key] = { from: labelFor(field, before, existing), to: labelFor(field, v) };
  }
  if (Object.keys(prepared.values).length === 0) return existing;

  const stamp = nowIso();
  const cols = Object.keys(prepared.values);
  db.prepare(
    `UPDATE "${def.table}" SET ${cols.map((c) => `"${c}" = ?`).join(", ")}, updated_at = ?, updated_by = ? WHERE id = ?`,
  ).run(...(Object.values(prepared.values) as never[]), stamp, user.name, id);
  logAudit(db, {
    registerKey: def.key,
    recordId: id,
    action: source === "import" ? "import" : "update",
    user,
    summary: `${source === "import" ? "Imported update to" : "Changed"} ${def.singular} "${describe(def, existing)}": ${Object.keys(changes)
      .map((k) => def.fields.find((f) => f.key === k)?.label ?? k)
      .join(", ")}`,
    changes,
  });
  return getRecord(def, id)!;
}

export function deleteRecord(def: RegisterDef, id: number, user: UserInfo): void {
  assertCanEdit(def, user);
  const db = getDb();
  const existing = getRecord(def, id);
  if (!existing) return;
  if (def.key === "users") {
    if (existing.id === user.id) throw new ValidationError("You cannot delete your own account.");
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as { n: number }).n;
    if (existing.role === "admin" && admins <= 1) throw new ValidationError("There must always be at least one active Admin.");
  }
  if (def.key === "reporting_periods" && existing.status === "Locked") {
    throw new ValidationError("A locked period cannot be deleted. Unlock it first.");
  }
  // Block deleting something other records point at.
  for (const other of allDefsUsing(def.key)) {
    for (const f of other.def.fields) {
      if (f.type === "lookup" && f.lookup?.register === def.key) {
        const n = (db.prepare(`SELECT COUNT(*) AS n FROM "${other.def.table}" WHERE "${f.key}" = ?`).get(id) as { n: number }).n;
        if (n > 0) throw new ValidationError(`Cannot delete: ${n} ${other.def.title} record(s) still use this ${def.singular}. Mark it inactive instead.`);
      }
    }
  }
  db.prepare(`DELETE FROM "${def.table}" WHERE id = ?`).run(id);
  logAudit(db, {
    registerKey: def.key,
    recordId: id,
    action: "delete",
    user,
    summary: `Deleted ${def.singular} "${describe(def, existing)}"`,
    changes: Object.fromEntries(
      def.fields.filter((f) => f.type !== "password" && existing[f.key] !== null && existing[f.key] !== undefined).map((f) => [f.key, { from: labelFor(f, existing[f.key], existing), to: null }]),
    ),
  });
}

function allDefsUsing(key: string) {
  return allRegisters
    .filter((def) => def.fields.some((f) => f.type === "lookup" && f.lookup?.register === key))
    .map((def) => ({ def }));
}

function describe(def: RegisterDef, row: Record<string, unknown>): string {
  const v = row[def.displayField];
  return v === null || v === undefined ? `#${row.id ?? ""}` : String(v);
}

function labelFor(field: FieldDef, value: unknown, row?: RecordRow): unknown {
  if (value === null || value === undefined) return null;
  if (field.type === "boolean") return Number(value) === 1 || value === true ? "Yes" : "No";
  if (field.type === "lookup" && field.lookup) {
    if (row && row[`${field.key}__label`]) return row[`${field.key}__label`];
    const opts = lookupOptions(getDb(), field.lookup.register, true);
    return opts.find((o) => o.id === Number(value))?.label ?? value;
  }
  return value;
}
