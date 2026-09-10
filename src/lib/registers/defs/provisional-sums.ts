import type { RegisterDef } from "../types";

export const provisionalSums: RegisterDef = {
  key: "provisional_sums",
  table: "provisional_sums",
  title: "Provisional Sums",
  singular: "Provisional Sum",
  description: "Provisional sum allowances in the contract, the value instructed against each, and the resulting saving or extra.",
  displayField: "item",
  displayFields: ["item", "description"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "sort_order", dir: "asc" },
  totals: ["budget", "contract_value", "saving_extra"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "item", label: "Item", type: "text", required: true, unique: true, width: "6rem", help: "Provisional sum item number, e.g. PS-01." },
    { key: "description", label: "Description", type: "textarea", required: true },
    { key: "status_id", label: "Status", type: "lookup", lookup: { register: "ps_statuses" }, required: true, chip: true, filter: true },
    { key: "contractor_id", label: "Contractor", type: "lookup", lookup: { register: "contractors" }, filter: true },
    { key: "asset_id", label: "Asset", type: "lookup", lookup: { register: "assets" }, hideInTable: true, filter: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, hideInTable: true, filter: true },
    { key: "budget", label: "Budget", type: "money", required: true, defaultValue: 0, help: "SAR. The provisional sum allowed in the contract." },
    { key: "contract_value", label: "Contract value", type: "money", help: "SAR. The value instructed / agreed against this item." },
    { key: "saving_extra", label: "(Saving) / Extra", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Contract value − budget. Negative (green) = saving, positive (red) = extra." },
    { key: "comments", label: "Comments", type: "textarea" },
    { key: "sort_order", label: "Order", type: "number", defaultValue: 0, hideInTable: true },
  ],
};

export const provisionalSumRegisters: RegisterDef[] = [provisionalSums];
