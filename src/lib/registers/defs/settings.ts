import type { RegisterDef, FieldDef } from "../types";

const ADMIN_ONLY = ["admin"] as const;

/** Small helper: a simple dropdown list with Name / Order / Active. */
function simpleList(key: string, table: string, title: string, singular: string, description: string): RegisterDef {
  return {
    key,
    table,
    title,
    singular,
    description,
    group: "Dropdown lists",
    displayField: "name",
    editRoles: [...ADMIN_ONLY],
    defaultSort: { field: "sort_order", dir: "asc" },
    fields: [
      { key: "name", label: "Name", type: "text", required: true, unique: true },
      { key: "sort_order", label: "Order", type: "number", defaultValue: 0, help: "Controls the order in dropdowns (lowest first)." },
      { key: "active", label: "Active", type: "boolean", defaultValue: true, help: "Inactive items stay on old records but are hidden from new dropdowns." },
    ],
  };
}

const auditFields: FieldDef[] = [];

export const clients: RegisterDef = {
  key: "clients",
  table: "clients",
  title: "Clients",
  singular: "Client",
  description: "The employer / client organisations.",
  group: "Project structure",
  displayField: "name",
  editRoles: [...ADMIN_ONLY],
  defaultSort: { field: "name", dir: "asc" },
  fields: [
    { key: "name", label: "Client name", type: "text", required: true, unique: true },
    { key: "code", label: "Code", type: "text" },
    { key: "contact_name", label: "Contact", type: "text" },
    { key: "contact_email", label: "Contact email", type: "text" },
    ...auditFields,
  ],
};

export const locations: RegisterDef = {
  key: "locations",
  table: "locations",
  title: "Locations",
  singular: "Location",
  description: "Where the programmes / assets are located.",
  group: "Project structure",
  displayField: "name",
  editRoles: [...ADMIN_ONLY],
  defaultSort: { field: "name", dir: "asc" },
  fields: [
    { key: "name", label: "Location", type: "text", required: true, unique: true },
    { key: "country", label: "Country", type: "text", defaultValue: "Saudi Arabia" },
  ],
};

export const programmes: RegisterDef = {
  key: "programmes",
  table: "programmes",
  title: "Programmes",
  singular: "Programme",
  description: "Top-level programmes (e.g. 1TB01031).",
  group: "Project structure",
  displayField: "name",
  editRoles: [...ADMIN_ONLY],
  defaultSort: { field: "code", dir: "asc" },
  fields: [
    { key: "code", label: "Programme code", type: "text", required: true, unique: true, help: "e.g. 1TB01031" },
    { key: "name", label: "Programme name", type: "text", required: true },
    { key: "client_id", label: "Client", type: "lookup", lookup: { register: "clients" } },
    { key: "location_id", label: "Location", type: "lookup", lookup: { register: "locations" } },
    { key: "description", label: "Description", type: "textarea", hideInTable: true },
  ],
};

export const assets: RegisterDef = {
  key: "assets",
  table: "assets",
  title: "Assets",
  singular: "Asset",
  description: "Assets within a programme (e.g. 1TB01031.01).",
  group: "Project structure",
  displayField: "name",
  editRoles: [...ADMIN_ONLY],
  defaultSort: { field: "code", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true },
    { key: "code", label: "Asset code", type: "text", required: true, unique: true, help: "e.g. 1TB01031.01" },
    { key: "name", label: "Asset name", type: "text", required: true },
    { key: "description", label: "Description", type: "textarea", hideInTable: true },
  ],
};

export const reportingPeriods: RegisterDef = {
  key: "reporting_periods",
  table: "reporting_periods",
  title: "Reporting Periods",
  singular: "Reporting Period",
  description: "One row per monthly report. Lock a period at month end to take a snapshot of every register.",
  group: "Report control",
  displayField: "label",
  editRoles: [...ADMIN_ONLY],
  defaultSort: { field: "report_no", dir: "desc" },
  fields: [
    { key: "report_no", label: "Report No", type: "number", required: true, unique: true },
    { key: "period_end", label: "Period end (cut-off)", type: "date", required: true, help: "The label is built from this date, e.g. Sep'26." },
    { key: "period_start", label: "Period start", type: "date" },
    { key: "label", label: "Period label", type: "text", help: "Leave blank to auto-fill as “Monthly Report No X – Mon'YY”." },
    { key: "status", label: "Status", type: "select", options: ["Open", "Locked"], readonly: true, chip: true, defaultValue: "Open" },
    { key: "locked_at", label: "Locked at", type: "date", readonly: true, hideInForm: true },
    { key: "locked_by", label: "Locked by", type: "text", readonly: true, hideInForm: true },
    { key: "source_file", label: "Imported from", type: "text", readonly: true, hideInForm: true, hideInTable: true },
    { key: "imported_at", label: "Imported at", type: "text", readonly: true, hideInForm: true, hideInTable: true },
    { key: "imported_by", label: "Imported by", type: "text", readonly: true, hideInForm: true, hideInTable: true },
    { key: "aconex_ref", label: "Aconex ref", type: "text", help: "Aconex document / transmittal reference for this report." },
    { key: "prepared_by", label: "Prepared by", type: "text", hideInTable: true },
    { key: "prepared_date", label: "Prepared date", type: "date", hideInTable: true },
    { key: "reviewed_by", label: "Reviewed by", type: "text", hideInTable: true },
    { key: "reviewed_date", label: "Reviewed date", type: "date", hideInTable: true },
    { key: "approved_by", label: "Approved by", type: "text", hideInTable: true },
    { key: "approved_date", label: "Approved date", type: "date", hideInTable: true },
    { key: "key_issues", label: "Key issues this period", type: "textarea", hideInTable: true, help: "Shown on the Executive Summary." },
    { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
};

export const packages: RegisterDef = {
  key: "packages",
  table: "packages",
  title: "Packages",
  singular: "Package",
  description: "Work packages / contracts that the cost report is broken down by.",
  group: "Commercial lists",
  displayField: "name",
  editRoles: [...ADMIN_ONLY],
  defaultSort: { field: "sort_order", dir: "asc" },
  fields: [
    { key: "code", label: "Package code", type: "text" },
    { key: "name", label: "Package name", type: "text", required: true, unique: true },
    { key: "asset_id", label: "Asset", type: "lookup", lookup: { register: "assets" } },
    { key: "sort_order", label: "Order", type: "number", defaultValue: 0 },
    { key: "active", label: "Active", type: "boolean", defaultValue: true },
    { key: "description", label: "Description", type: "textarea", hideInTable: true },
  ],
};

export const contractors: RegisterDef = {
  key: "contractors",
  table: "contractors",
  title: "Contractors & Consultants",
  singular: "Contractor / Consultant",
  description: "Every party you hold a contract or purchase order with.",
  group: "Commercial lists",
  displayField: "name",
  editRoles: [...ADMIN_ONLY],
  defaultSort: { field: "name", dir: "asc" },
  fields: [
    { key: "name", label: "Name", type: "text", required: true, unique: true },
    { key: "type", label: "Type", type: "select", required: true, options: ["Contractor", "Consultant", "Sub-contractor", "Supplier", "Insurer"], chip: true },
    { key: "reef_po_ref", label: "REEF PO ref", type: "text" },
    { key: "acc_ref", label: "ACC ref", type: "text" },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" } },
    { key: "contact_name", label: "Contact", type: "text", hideInTable: true },
    { key: "contact_email", label: "Contact email", type: "text", hideInTable: true },
    { key: "active", label: "Active", type: "boolean", defaultValue: true },
  ],
};

export const approvalStatuses = simpleList("approval_statuses", "approval_statuses", "Approval Statuses", "Approval Status", "Used by change events, claims, invoices etc.");
export const changeInitiators = simpleList("change_initiators", "change_initiators", "Change Initiated By", "Initiator", "Who raised a change.");
export const projectStages = simpleList("project_stages", "project_stages", "Project Stages", "Project Stage", "Stage the change belongs to.");
export const changeCategories = simpleList("change_categories", "change_categories", "Change Categories", "Change Category", "Why the change happened.");
export const bondTypes = simpleList("bond_types", "bond_types", "Insurance / Bond Types", "Insurance / Bond Type", "Types of bonds and insurance policies.");
export const provisionalSumStatuses = simpleList("ps_statuses", "ps_statuses", "Provisional Sum Statuses", "Provisional Sum Status", "Statuses for provisional sums.");
export const costCategories = simpleList("cost_categories", "cost_categories", "Cost Categories", "Cost Category", "Level 1 groups of the cost report, e.g. Professional Services, Construction Works. Order controls the Level 1 row order.");

export const users: RegisterDef = {
  key: "users",
  table: "users",
  title: "Users",
  singular: "User",
  description: "People who can log in. Admin = full control, Editor = can add and change records, Viewer = read-only.",
  group: "Access",
  displayField: "name",
  editRoles: [...ADMIN_ONLY],
  viewRoles: [...ADMIN_ONLY],
  defaultSort: { field: "name", dir: "asc" },
  fields: [
    { key: "name", label: "Full name", type: "text", required: true },
    { key: "email", label: "Email (login)", type: "text", required: true, unique: true },
    { key: "role", label: "Role", type: "select", required: true, options: ["admin", "editor", "contributor", "viewer", "reporter"], chip: true, defaultValue: "editor", help: "Admin: everything. Editor: add, edit and delete. Contributor (data entry): add new rows, run reports and emails, but not change existing rows. Viewer: read only. Reporter: can only open the Reports page and download the PDF / Excel reports." },
    { key: "active", label: "Active", type: "boolean", defaultValue: true, help: "Inactive users cannot log in." },
    { key: "must_change_password", label: "Must change password at next login", type: "boolean", defaultValue: true, help: "Tick when you set a starting password for someone: they are asked to choose their own password the next time they log in." },
    { key: "password", label: "Password", type: "password", help: "At least 8 characters. Leave blank when editing to keep the current password." },
  ],
};

export const settingsRegisters: RegisterDef[] = [
  programmes,
  assets,
  clients,
  locations,
  reportingPeriods,
  packages,
  contractors,
  approvalStatuses,
  changeInitiators,
  projectStages,
  changeCategories,
  bondTypes,
  provisionalSumStatuses,
  costCategories,
  users,
];
