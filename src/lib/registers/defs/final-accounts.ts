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
  description: "Final account statement status per contract: open, closed or not required, with forecast closure dates and the anticipated final account from the cost report. Upload the final account statement and its transmittals and the row is closed from them.",
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
    { key: "final_contract_price", label: "Final contract price (statement)", type: "money", help: "The final contract price agreed on the Final Account Statement. Filled when the statement is uploaded." },
    { key: "fa_construction_price", label: "Construction work price", type: "money", section: "Final account statement", hideInTable: true, help: "From the Financial Account Statement Form." },
    { key: "fa_provisional_sums", label: "Provisional sum price", type: "money", section: "Final account statement", hideInTable: true },
    { key: "fa_variation_orders", label: "Carried from variation orders", type: "money", section: "Final account statement", hideInTable: true, help: "The approved variations on the statement – these are the DVOs in Change Management." },
    { key: "fa_omissions", label: "Carried from omissions", type: "money", section: "Final account statement", hideInTable: true, help: "An omission agreed at final account is not a variation order. The dashboard keeps one Change Management entry (category Final Account, DVO approved for this amount, on the cost report line above) in step with this figure, so it reaches column H, the Excel cost report and the Aconex check. Cleared here, the entry goes too." },
    { key: "fa_claims", label: "Carried from claims", type: "money", section: "Final account statement", hideInTable: true },
    { key: "fa_negotiation", label: "Others – negotiation adjustment", type: "money", section: "Final account statement", hideInTable: true, help: "For information: the statement's approved variations already carry the negotiation adjustment, so it is not added to column H again. If a negotiation amount is genuinely outside the approved DVOs, file it in Change Management with the category Final Account." },
    { key: "responsible", label: "Responsible", type: "text", hideInTable: true },
    { key: "forecast_closure_date", label: "Forecast FA closure", type: "date", help: "When the final account statement is expected to be signed." },
    { key: "days_remaining", label: "Days remaining", type: "number", virtual: true, readonly: true, hideInForm: true, help: "Amber within 60 days of the forecast date, red when overdue (open final accounts only)." },
    { key: "status", label: "Status", type: "select", options: [...FA_STATUSES], required: true, defaultValue: "Open", chip: true, filter: true },
    { key: "fa_statement_ref", label: "FA statement ref", type: "text", hideInTable: true },
    { key: "closed_date", label: "Closed / signed date", type: "date", hideInTable: true },
    { key: "settled_by", label: "Balance settled by", type: "select", options: ["", "Head Office", "Direct final payment", "Final account settlement"], hideInTable: true, help: "When a closed account's final contract price is above what the IPCs on the payment log certify, the dashboard keeps one row on the contract's IPC log for the balance – named after who settled it (Head Office payment, Direct final payment, FA settlement) – so certified to date, the Excel report and Aconex agree." },
    { key: "library_doc_id", label: "Statement in the Contract Library", type: "number", readonly: true, hideInForm: true, hideInTable: true },
    { key: "documents", label: "Documents", type: "text", virtual: true, readonly: true, hideInForm: true, help: "The final account statement and its transmittals filed in the Contract Library for this contract." },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
};

export const finalAccountRegisters = [finalAccounts];
