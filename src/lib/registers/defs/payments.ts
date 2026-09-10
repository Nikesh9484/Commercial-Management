import type { RegisterDef } from "../types";

export const CONTRACT_STATUSES = ["Active", "Completed", "Suspended", "Terminated", "Closed"];
export const VAT_DEFAULT = 15;

const SETTINGS = "Contract settings (used by the IPC log)";

/** Module 8 – one row per contract. Values marked (auto) are calculated by src/lib/payments/compute.ts. */
export const contracts: RegisterDef = {
  key: "contracts",
  table: "contracts",
  title: "Contracts – Payment Summary",
  singular: "Contract",
  description: "One row per contract or purchase order, with its revised value and cumulative payment position.",
  displayField: "reef_po_no",
  displayFields: ["reef_po_no", "title"],
  scope: "programme",
  snapshot: true,
  rowLinkTemplate: "/modules/invoices-payments/{id}",
  rowLinkLabel: "IPC log",
  defaultSort: { field: "sr_no", dir: "asc" },
  totals: ["original_contract", "approved_vos", "approved_claims", "final_account_adjustment", "revised_contract_value", "net_cum_applied", "net_cum_certified", "cum_paid"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "sr_no", label: "SR No", type: "number", required: true, width: "4rem" },
    { key: "title", label: "Contract title", type: "text", required: true, help: "Short name used in dropdowns, e.g. Main Works – Basin." },
    { key: "reef_pr_no", label: "REEF PR No", type: "text" },
    { key: "reef_po_no", label: "REEF PO No", type: "text", required: true, unique: true },
    { key: "acc_ref", label: "ACC ref", type: "text" },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, required: true, filter: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, hideInTable: true, filter: true },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, hideInTable: true, help: "Links approved VOs, approved claims and certified-to-date (column P) to the cost report." },
    { key: "scope_of_work", label: "Scope of work", type: "textarea", hideInTable: true },
    { key: "current_status", label: "Current status", type: "select", options: CONTRACT_STATUSES, required: true, defaultValue: "Active", chip: true, filter: true },
    { key: "original_completion_date", label: "Original completion date", type: "date" },
    { key: "eot_granted_days", label: "EOT granted (days)", type: "number", help: "Total extension of time granted to date." },
    { key: "revised_completion_date", label: "Revised completion date", type: "date", virtual: true, readonly: true, hideInForm: true, help: "Original completion date + EOT granted." },
    { key: "original_contract", label: "Original contract", type: "money", required: true, defaultValue: 0 },
    { key: "approved_vos", label: "Approved VOs", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Approved DVOs in the Change Tracker linked to this contract's cost line." },
    { key: "approved_claims", label: "Approved claims", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Determined value of approved claims linked to this contract's cost line." },
    { key: "final_account_adjustment", label: "Final account adjustment", type: "money", defaultValue: 0, help: "Manual adjustment agreed at final account (positive or negative)." },
    { key: "revised_contract_value", label: "Revised contract value", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Original + approved VOs + approved claims + final account adjustment." },
    { key: "net_cum_applied", label: "Net cumulative applied", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Sum of net claimed in the IPC log (after advance recovery and retention, excl. VAT)." },
    { key: "net_cum_certified", label: "Net cumulative certified", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "cum_paid", label: "Cumulative payment released", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Net payments with a paid date, excl. VAT." },
    { key: "pct_certified", label: "% certified to date", type: "percent", virtual: true, readonly: true, hideInForm: true, help: "Gross cumulative certified ÷ revised contract value." },
    { key: "pct_balance", label: "% balance to certify", type: "percent", virtual: true, readonly: true, hideInForm: true },
    { key: "advance_recovery_pct", label: "Advance recovery %", type: "percent", defaultValue: 0, section: SETTINGS, hideInTable: true, help: "Deducted from each gross amount, e.g. 10." },
    { key: "retention_pct", label: "Retention %", type: "percent", defaultValue: 0, section: SETTINGS, hideInTable: true, help: "e.g. 10." },
    { key: "ipc_days", label: "Days to issue IPC", type: "number", defaultValue: 28, section: SETTINGS, hideInTable: true, help: "Contractual days from the payment application to the IPC." },
    { key: "payment_days", label: "Days to pay", type: "number", defaultValue: 30, section: SETTINGS, hideInTable: true, help: "Contractual days from the IPC to payment." },
    { key: "vat_pct", label: "VAT %", type: "percent", defaultValue: VAT_DEFAULT, section: SETTINGS, hideInTable: true },
    { key: "notes", label: "Notes", type: "textarea", section: SETTINGS, hideInTable: true },
  ],
};

const CLAIM = "Payment application (claimed)";
const IPC = "Interim Payment Certificate (certified)";
const PAY = "Invoice & payment";

/** Module 8 – IPC log: one row per payment application. */
export const paymentApplications: RegisterDef = {
  key: "payment_applications",
  table: "payment_applications",
  title: "IPC Log",
  singular: "Payment application",
  description: "One row per payment application: what was claimed, what was certified, and what was paid, with contractual due dates.",
  displayField: "application_no",
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "application_date", dir: "asc" },
  totals: ["gross_claimed_month", "net_claimed", "gross_certified_month", "net_certified", "net_payment", "vat", "final_amount_paid"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "contract_id", label: "Contract", type: "lookup", lookup: { register: "contracts" }, required: true, filter: true, section: CLAIM },
    { key: "sr_no", label: "SR", type: "number", width: "4rem", section: CLAIM },
    { key: "application_no", label: "Payment application no", type: "text", required: true, section: CLAIM },
    { key: "month", label: "Month", type: "text", section: CLAIM, help: "e.g. Sep-26." },
    { key: "application_aconex_ref", label: "Application Aconex ref", type: "text", hideInTable: true, section: CLAIM },
    { key: "application_date", label: "Application date", type: "date", required: true, section: CLAIM, help: "Aconex letter date. Drives the contractual IPC due date." },
    { key: "cumulative_claimed", label: "Cumulative claimed (excl. VAT)", type: "money", required: true, section: CLAIM },
    { key: "gross_claimed_month", label: "Gross claimed – month", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Cumulative claimed − previous application's cumulative." },
    { key: "advance_recovery_claimed", label: "Advance recovery", type: "money", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "retention_claimed", label: "Retention", type: "money", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "net_claimed", label: "Net claimed", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "ipc_no", label: "IPC No", type: "text", section: IPC },
    { key: "ipc_aconex_ref", label: "IPC Aconex ref", type: "text", hideInTable: true, section: IPC },
    { key: "ipc_date", label: "IPC date", type: "date", section: IPC },
    { key: "ipc_due_date", label: "IPC due (contract)", type: "date", virtual: true, readonly: true, hideInForm: true, help: "Application date + days to issue IPC." },
    { key: "ipc_days_late", label: "IPC days late / (early)", type: "number", virtual: true, readonly: true, hideInForm: true },
    { key: "cumulative_certified", label: "Cumulative certified (excl. VAT)", type: "money", section: IPC },
    { key: "gross_certified_month", label: "Gross certified – month", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "advance_recovery_certified", label: "Advance recovery (cert.)", type: "money", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "retention_certified", label: "Retention (cert.)", type: "money", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "net_certified", label: "Net certified", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "invoice_aconex_ref", label: "Invoice approval Aconex ref", type: "text", hideInTable: true, section: PAY },
    { key: "invoice_date", label: "Invoice approval date", type: "date", hideInTable: true, section: PAY },
    { key: "paid_date", label: "Paid by Finance", type: "date", section: PAY },
    { key: "payment_due_date", label: "Payment due (contract)", type: "date", virtual: true, readonly: true, hideInForm: true, help: "IPC date + days to pay." },
    { key: "payment_days_late", label: "Payment days late / (early)", type: "number", virtual: true, readonly: true, hideInForm: true },
    { key: "net_payment", label: "Net payment", type: "money", virtual: true, readonly: true, hideInForm: true, help: "= net certified." },
    { key: "vat", label: "VAT", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "final_amount_paid", label: "Final amount (incl. VAT)", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "cumulative_paid", label: "Cumulative paid (incl. VAT)", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Running total of paid applications." },
    { key: "comments", label: "Comments", type: "textarea", hideInTable: true, section: PAY },
  ],
};

export const paymentRegisters: RegisterDef[] = [contracts, paymentApplications];
