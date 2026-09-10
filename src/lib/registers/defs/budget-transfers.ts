import type { RegisterDef } from "../types";

export const TRANSFER_STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"];

export const budgetTransfers: RegisterDef = {
  key: "budget_transfers",
  table: "budget_transfers",
  title: "Budget Transfers",
  singular: "Budget transfer",
  description: "Movements of budget from one package to another. Approved transfers flow into column F of the cost report.",
  displayField: "item",
  displayFields: ["item", "description"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "date", dir: "desc" },
  totals: ["amount"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "item", label: "Item", type: "text", required: true, unique: true, width: "6rem", help: "e.g. BT-01." },
    { key: "description", label: "Description", type: "textarea", required: true },
    { key: "status", label: "Status", type: "select", options: TRANSFER_STATUSES, required: true, defaultValue: "Pending", chip: true, filter: true, help: "Only Approved transfers change the cost report." },
    { key: "from_package_id", label: "From package", type: "lookup", lookup: { register: "packages" }, required: true, filter: true },
    { key: "from_cost_line_id", label: "From cost line", type: "lookup", lookup: { register: "cost_lines" }, hideInTable: true, help: "Only needed when the package has more than one Level 2 line." },
    { key: "to_package_id", label: "To package", type: "lookup", lookup: { register: "packages" }, required: true, filter: true },
    { key: "to_cost_line_id", label: "To cost line", type: "lookup", lookup: { register: "cost_lines" }, hideInTable: true, help: "Only needed when the package has more than one Level 2 line." },
    { key: "amount", label: "Amount", type: "money", required: true, help: "SAR. Always positive: it leaves the From package and arrives in the To package." },
    { key: "date", label: "Date", type: "date", required: true },
    { key: "period_id", label: "Reporting period", type: "lookup", lookup: { register: "reporting_periods" }, filter: true },
    { key: "approval_ref", label: "Approval ref", type: "text" },
    { key: "applied", label: "In cost report", type: "text", virtual: true, readonly: true, hideInForm: true, chip: true, help: "Whether the transfer is currently reflected in column F." },
    { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
};

export const budgetTransferRegisters: RegisterDef[] = [budgetTransfers];
