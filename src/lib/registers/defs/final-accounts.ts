import type { RegisterDef } from "../types";

export const FA_STATUSES = ["Open", "Closed", "Not Required", "Direct Payment – No FA"] as const;
export const FA_AMBER_DAYS = 60;

/**
 * Final Account Status – one row per contract / cost report line, tracking whether the final
 * account statement is open, signed (closed) or not required, with the forecast closure date.
 * Committed, uncommitted and anticipated final account come from the cost report automatically.
 */
export const finalAccounts: RegisterDef = {
  key: "final_accounts",
  table: "final_accounts",
  title: "Final Account Status",
  singular: "Final Account",
  description: "Final account statement status per contract: open, closed or not required, with forecast closure dates and the anticipated final account from the cost report.",
  group: "Payments",
  scope: "programme",
  snapshot: true,
  displayField: "acc_ref",
  displayFields: ["acc_ref", "description"],
  totals: ["committed", "uncommitted", "afa"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "acc_ref", label: "ACC code", type: "text", required: true, unique: true, width: "8rem", help: "e.g. CN.031C10 – the cost code of the contract." },
    { key: "description", label: "Package / description", type: "text", required: true },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, filter: true },
    { key: "type", label: "Type", type: "select", options: ["Contractor", "Consultant", "Supplier", "Insurer"], chip: true, filter: true },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, required: true, hideInTable: true, help: "Committed, uncommitted and anticipated final account are read from this line of the cost report." },
    { key: "contract_id", label: "Contract", type: "lookup", lookup: { register: "contracts" }, hideInTable: true },
    { key: "committed", label: "Committed cost (I)", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Cost report column I for the linked line." },
    { key: "uncommitted", label: "Uncommitted (N − I)", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Anticipated final account less committed cost." },
    { key: "afa", label: "Anticipated Final Account (N)", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "responsible", label: "Responsible", type: "text", hideInTable: true },
    { key: "forecast_closure_date", label: "Forecast FA closure", type: "date", help: "When the final account statement is expected to be signed." },
    { key: "days_remaining", label: "Days remaining", type: "number", virtual: true, readonly: true, hideInForm: true, help: "Amber within 60 days of the forecast date, red when overdue (open final accounts only)." },
    { key: "status", label: "Status", type: "select", options: [...FA_STATUSES], required: true, defaultValue: "Open", chip: true, filter: true },
    { key: "fa_statement_ref", label: "FA statement ref", type: "text", hideInTable: true },
    { key: "closed_date", label: "Closed / signed date", type: "date", hideInTable: true },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
};

export const finalAccountRegisters = [finalAccounts];
