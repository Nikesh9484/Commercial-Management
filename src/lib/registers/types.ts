/**
 * A "register" is any table of records in the app (Packages, Contractors, Change Events ...).
 * Every register is described by a RegisterDef. The generic engine + generic UI then give it
 * add / edit / delete / filter / sort / search / export / import / history for free.
 *
 * This file must stay free of server-only imports: it is shared with the browser.
 */

export type Role = "admin" | "editor" | "contributor" | "viewer" | "reporter";

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
  /** Where the column sits in the table, low numbers first. Columns without one keep the order they
   *  are declared in and follow the numbered ones. Lets a field live under its own heading on the
   *  record form while still being read early in the table. */
  tableOrder?: number;
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
  /** Group heading in the add / edit form. Fields without a section go under the first heading. */
  section?: string;
  /**
   * Calculated on the server for display (e.g. "Days open"). Not stored, not editable, not importable.
   * Set by src/lib/registers/enrich.ts. Implies readonly + hidden in the form.
   */
  virtual?: boolean;
  /** When any field in a register sets this, only those fields get filter dropdowns. */
  filter?: boolean;
  /** For lookups: `<key>__label` is filled; for chips on lookups set `chip`. */
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
  /** Optional: several fields joined with " · " for lookup labels (e.g. code + name). */
  displayFields?: string[];
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** Roles allowed to add/edit/delete/import. Everyone with access can view + export. Default: admin + editor. */
  editRoles?: Role[];
  /** Roles allowed to view. Default: all roles. */
  viewRoles?: Role[];
  /** Include this register's rows in the month-end snapshot. Default: false (reference data). */
  snapshot?: boolean;
  /** The page table shows every field (the full tracker, scrolled sideways) instead of the compact set; PDF and report builder keep the compact set. */
  wideTable?: boolean;
  /** Group shown in the Settings page. */
  group?: string;
  /**
   * Rows belong to the Programme / Asset currently selected in the top bar.
   * The register must have a `programme_id` / `asset_id` lookup field; the engine filters by it
   * and fills it in for new records.
   */
  scope?: "programme" | "asset";
  /** Money / number fields to total in a footer row of the table (over the rows currently shown). */
  totals?: string[];
  /** Adds an "open" link per row, e.g. "/modules/invoices-payments/{id}". */
  rowLinkTemplate?: string;
  rowLinkLabel?: string;
}

export interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** True when the account still uses a starting password and must set its own before doing anything else. */
  mustChangePassword?: boolean;
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
  contributor: "Data entry (add only)",
  viewer: "Viewer",
  reporter: "View & reports only",
};

/**
 * What a "Reports only" user may open. They see every module (1–11) and every report, strictly read
 * only, and nothing that belongs to the automation side of the product (automation, libraries,
 * imports, settings, the assistant). Checked at the front door (proxy.ts), again in every API
 * handler (withUser) and in the page layout, so one list decides all three.
 *
 * Reading (GET) is open on the pages and APIs below. Changing anything is refused, with three
 * exceptions that change nothing shared: logging in / out and their own password, building a
 * report to download, and choosing their own project / period in the top bar (kept in their
 * browser, see personal-context.ts).
 */
export const REPORTER_MODULES = [
  "project-setup",
  "cost-report",
  "change-management",
  "claims-disputes",
  "early-warnings",
  "provisional-sums",
  "bonds-insurance",
  "invoices-payments",
  "final-accounts",
  "cash-flow",
  "budget-transfers",
  "executive-summary",
  "cost-recovery",
  "aconex-check",
];
export const REPORTER_PATHS = [
  "/",
  ...REPORTER_MODULES.map((m) => `/modules/${m}`),
  "/reports",
  "/packs",
  "/api/packs",
  "/api/export",
  "/api/report",
  "/api/email-report",
  "/api/custom-report",
  "/api/registers",
  "/api/kpi",
  "/api/cost-report",
  "/api/cashflow",
  "/api/context",
  "/api/auth",
  "/api/health",
  "/imports/documents",
  // the document libraries: the user accounts read them and add the contract documents they receive
  "/library",
  "/api/library",
  "/api/leases",
  "/user-guide.pdf",
  "/login",
  "/account",
];
/** Changes a "Reports only" user may make – none of them touches the shared data. */
const REPORTER_WRITES: { method: string; path: string }[] = [
  { method: "POST", path: "/api/auth" },
  { method: "POST", path: "/api/custom-report" },
  { method: "PUT", path: "/api/context" },
  // the KPI packs and the document packs are prepared by the user account as well as the admin:
  // uploading files, typing the head office details and the form fields, building the packs
  ...["POST", "PUT", "PATCH", "DELETE"].flatMap((method) => [{ method, path: "/api/kpi" }, { method, path: "/api/packs" }]),
  // bonds and insurance documents are uploaded by the user account as well: the register is updated from them
  { method: "POST", path: "/api/bonds/from-documents" },
  // and corrects the entries by hand (adding and editing; deleting stays with the admin and editors)
  { method: "PUT", path: "/api/registers/bonds" },
  { method: "POST", path: "/api/registers/bonds" },
  { method: "POST", path: "/api/payments/from-documents" },
  { method: "POST", path: "/api/feed/from-documents" },
  // the accommodation lease agreements: uploaded, added and corrected by the user account (deleting stays with the admin and editors)
  { method: "POST", path: "/api/leases/from-documents" },
  { method: "PUT", path: "/api/registers/lease_agreements" },
  { method: "POST", path: "/api/registers/lease_agreements" },
  { method: "PUT", path: "/api/registers/lease_amendments" },
  { method: "POST", path: "/api/registers/lease_amendments" },
  // the document libraries: adding, correcting the filing and re-reading (removing stays with the admin and editors)
  { method: "POST", path: "/api/library" },
  { method: "PATCH", path: "/api/library" },
];
const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?");

export function reporterAllowed(pathname: string, method = "GET"): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") {
    // "/" is the Executive Summary itself, not a prefix for everything
    return REPORTER_PATHS.some((p) => (p === "/" ? pathname === "/" : under(pathname, p)));
  }
  // saved report presets stay with the people who keep the data
  if (pathname.startsWith("/api/custom-report/presets")) return false;
  return REPORTER_WRITES.some((w) => w.method === m && under(pathname, w.path));
}

export function canEditRegister(def: RegisterDef, role: Role): boolean {
  const roles = def.editRoles ?? ["admin", "editor"];
  return roles.includes(role);
}

export function canViewRegister(def: RegisterDef, role: Role): boolean {
  const roles = def.viewRoles ?? ["admin", "editor", "contributor", "viewer", "reporter"];
  return roles.includes(role);
}

/** Adding rows: editors and admins, plus "data entry" users on every register an editor may edit. */
export function canCreateRegister(def: RegisterDef, role: Role): boolean {
  return canEditRegister(def, role) || (role === "contributor" && canEditRegister(def, "editor"));
}

/** Roles that may change existing data (edit, delete, cash flow, report control, imports). */
export function isEditorRole(role: Role): boolean {
  return role === "admin" || role === "editor";
}

/** Colour for a status value: green / amber / red / blue / grey. */
export type ChipTone = "green" | "amber" | "red" | "blue" | "grey";

export function statusTone(value: unknown): ChipTone {
  const v = String(value ?? "").toLowerCase();
  if (!v) return "grey";
  if (["approved", "review complete", "locked", "active", "yes", "expended", "closed", "paid", "current", "opportunity", "realised"].some((k) => v === k || v.includes(k))) return "green";
  if (["rejected", "cancelled", "overdue", "expired", "no", "not active", "disputed"].some((k) => v === k || v.includes(k))) return "red";
  if (["pending", "revised", "partially", "open", "submitted", "in progress", "under review", "draft", "risk", "mitigating", "converted"].some((k) => v === k || v.includes(k))) return "amber";
  if (["superseded", "transferred", "inactive", "withdrawn"].some((k) => v === k || v.includes(k))) return "grey";
  return "blue";
}
