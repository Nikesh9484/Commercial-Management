/**
 * A "register" is any table of records in the app (Packages, Contractors, Change Events ...).
 * Every register is described by a RegisterDef. The generic engine + generic UI then give it
 * add / edit / delete / filter / sort / search / export / import / history for free.
 *
 * This file must stay free of server-only imports: it is shared with the browser.
 */

export type Role = "admin" | "editor" | "viewer";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "percent"
  | "date"
  | "select"
  | "lookup"
  | "boolean"
  | "password";

export interface FieldDef {
  /** Column name in the database and key in JSON. */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Fixed choices for `select` fields. */
  options?: string[];
  /** For `lookup` fields: which register the value points to (stores that record's id). */
  lookup?: { register: string };
  /** Value must be unique within the register (e.g. a code). */
  unique?: boolean;
  /** Not editable through the form (set by the system). */
  readonly?: boolean;
  /** Hide from the table (still shown in the form). Default: shown. */
  hideInTable?: boolean;
  /** Hide from the form (system fields). */
  hideInForm?: boolean;
  /** Short helper text shown under the input. */
  help?: string;
  /** Default value for new records. */
  defaultValue?: string | number | boolean | null;
  /** Render as a coloured status chip in tables. */
  chip?: boolean;
  /** Column width hint, e.g. "12rem". */
  width?: string;
}

export interface RegisterDef {
  /** URL-safe id, e.g. "packages". */
  key: string;
  /** SQLite table name. */
  table: string;
  title: string;
  singular: string;
  description?: string;
  fields: FieldDef[];
  /** Which field is shown when another register looks this one up. */
  displayField: string;
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** Roles allowed to add/edit/delete/import. Everyone with access can view + export. Default: admin + editor. */
  editRoles?: Role[];
  /** Roles allowed to view. Default: all roles. */
  viewRoles?: Role[];
  /** Include this register's rows in the month-end snapshot. Default: false (reference data). */
  snapshot?: boolean;
  /** Group shown in the Settings page. */
  group?: string;
}

export interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface LookupOption {
  id: number;
  label: string;
}

export type RecordRow = Record<string, unknown> & { id: number };

export interface AuditEntry {
  id: number;
  register_key: string;
  record_id: number | null;
  action: string;
  user_name: string;
  at: string;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export function canEditRegister(def: RegisterDef, role: Role): boolean {
  const roles = def.editRoles ?? ["admin", "editor"];
  return roles.includes(role);
}

export function canViewRegister(def: RegisterDef, role: Role): boolean {
  const roles = def.viewRoles ?? ["admin", "editor", "viewer"];
  return roles.includes(role);
}

/** Colour for a status value: green / amber / red / blue / grey. */
export type ChipTone = "green" | "amber" | "red" | "blue" | "grey";

export function statusTone(value: unknown): ChipTone {
  const v = String(value ?? "").toLowerCase();
  if (!v) return "grey";
  if (["approved", "review complete", "locked", "active", "yes", "expended", "closed", "paid", "current"].some((k) => v === k || v.includes(k))) return "green";
  if (["rejected", "cancelled", "overdue", "expired", "no", "not active", "disputed"].some((k) => v === k || v.includes(k))) return "red";
  if (["pending", "revised", "partially", "open", "submitted", "in progress", "under review", "draft"].some((k) => v === k || v.includes(k))) return "amber";
  if (["superseded", "transferred", "inactive", "withdrawn"].some((k) => v === k || v.includes(k))) return "grey";
  return "blue";
}
