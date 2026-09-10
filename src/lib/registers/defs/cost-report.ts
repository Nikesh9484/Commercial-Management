import type { RegisterDef } from "../types";

/**
 * Module 2 – Cost Report Level 2 lines. One row per Package / Contractor.
 * Only the "input" columns live here (A–E). Columns F–S are calculated by src/lib/cost-report/compute.ts.
 */
export const costLines: RegisterDef = {
  key: "cost_lines",
  table: "cost_lines",
  title: "Cost Report Lines",
  singular: "Cost line",
  description: "Level 2 rows of the cost report: one per package / contractor with its approved baseline budget.",
  displayField: "code",
  displayFields: ["code", "name"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "sort_order", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "asset_id", label: "Asset", type: "lookup", lookup: { register: "assets" }, required: true, help: "Level 1 rolls the report up by asset." },
    { key: "code", label: "Code", type: "text", required: true, unique: true, help: "Cost code, e.g. 1TB01031.01-C01 (column A)." },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, required: true },
    { key: "name", label: "Name / description", type: "text", help: "Description of the works or contract (column C)." },
    { key: "contractor_id", label: "Contractor / Sub-contractor", type: "lookup", lookup: { register: "contractors" } },
    { key: "section", label: "Section", type: "select", options: ["Committed", "Uncommitted"], required: true, defaultValue: "Committed", chip: true, help: "Committed = awarded contracts. Uncommitted = budgets not yet awarded." },
    { key: "approved_baseline_budget", label: "Approved Baseline Budget", type: "money", required: true, defaultValue: 0, help: "Column E. Budget transfers and change values are added automatically." },
    { key: "opening_transfers", label: "Budget transfers brought forward", type: "money", defaultValue: 0, hideInTable: true, help: "Net budget transfers made before this app started (from your last Excel report). Added to column F together with transfers recorded in Budget Transfers." },
    { key: "sort_order", label: "Order", type: "number", defaultValue: 0, hideInTable: true },
    { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
};

export const costReportRegisters: RegisterDef[] = [costLines];
