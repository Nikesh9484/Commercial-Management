import type { RegisterDef } from "../types";

/**
 * Cost recovery registers – stand-alone trackers that are uploaded when they change, not every
 * month, so they carry their own "as of" date and are never touched by the monthly workbook:
 *
 *  - Accommodation cost recovery: the AMAALA Construction Village lease-agreement invoice tracker
 *    ("L.A. Invoice Tracker (W)" sheet) – what each contractor has been invoiced for its staff
 *    accommodation, what has been paid or recovered through its IPCs, and what is outstanding.
 *  - Customs duty recovery: the AMAALA Customs Recovery Tracker – customs duties RSG paid on a
 *    contractor's imports that the contract says the contractor must bear, and how they are
 *    being recovered (PVO / early warning notice).
 */
const TRACKER = "Tracker row";
const INVOICES = "Invoices and payments (cumulative, from the tracker)";
const RECOVERY = "Recovery";
const CUSTOMS = "Customs paid";
const CONTRACT = "Contract";

export const RECOVERY_STATUSES = ["Open", "Closed"] as const;

export const accommodationRecovery: RegisterDef = {
  key: "accommodation_recovery",
  table: "accommodation_recovery",
  title: "Accommodation Cost Recovery",
  singular: "Accommodation recovery row",
  description: "Construction village lease-agreement invoices per contractor: invoiced, received or recovered through IPCs, withheld and outstanding – from the accommodation invoice tracker.",
  group: "Recovery",
  scope: "programme",
  snapshot: false,
  displayField: "tracker_name",
  displayFields: ["tracker_name", "asset_ref"],
  defaultSort: { field: "outstanding", dir: "desc" },
  totals: ["invoiced_gross", "received_total", "offset_via_ipc", "outstanding", "withheld_in_ipc", "deemed_settled_fa"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "tracker_key", label: "Tracker key", type: "text", required: true, unique: true, hideInTable: true, hideInForm: true, help: "How a re-upload finds this row again (name on the tracker + asset code)." },
    { key: "tracker_name", label: "Name on the tracker", type: "text", required: true, section: TRACKER, width: "18rem" },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, section: TRACKER, filter: true, help: "Our contractor record, so the row reaches the early warning distribution and the cost report line." },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: TRACKER, hideInTable: true, help: "The contract the accommodation is recovered against (filled in from the contractor when it has one contract)." },
    { key: "program_name", label: "Program (tracker)", type: "text", section: TRACKER, hideInTable: true },
    { key: "asset_ref", label: "Asset code (tracker)", type: "text", section: TRACKER, width: "8rem" },
    { key: "status", label: "Status", type: "select", options: [...RECOVERY_STATUSES], required: true, defaultValue: "Open", chip: true, filter: true, section: TRACKER, help: "Closed when the tracker notes the agreement as closed." },
    { key: "tracker_date", label: "Tracker as of", type: "date", section: TRACKER, hideInTable: true },
    { key: "lease_sum", label: "Lease agreement sum", type: "money", section: TRACKER, hideInTable: true, help: "Including amendments." },
    { key: "commercial_lead", label: "Commercial lead", type: "text", section: TRACKER, hideInTable: true },
    { key: "point_of_contact", label: "Point of contact", type: "text", section: TRACKER, hideInTable: true },
    { key: "note", label: "Tracker note", type: "textarea", section: TRACKER, width: "16rem" },
    { key: "assessment_to_date", label: "Assessment to date (net)", type: "money", section: INVOICES, hideInTable: true },
    { key: "invoiced_net", label: "Invoiced to date (excl. VAT)", type: "money", section: INVOICES, hideInTable: true },
    { key: "not_yet_invoiced", label: "Assessed, not yet invoiced", type: "money", section: INVOICES, hideInTable: true },
    { key: "invoiced_gross", label: "Invoiced to date (incl. VAT)", type: "money", section: INVOICES },
    { key: "received_pct", label: "% received + recovered", type: "number", section: INVOICES, hideInTable: true, help: "Of the invoices issued to date." },
    { key: "received_total", label: "Received + recovered", type: "money", section: INVOICES, help: "Payments received plus recoveries through IPCs." },
    { key: "received_recorded", label: "Payments recorded by Finance", type: "money", section: INVOICES, hideInTable: true },
    { key: "confirmed_by_finance", label: "Confirmed by Finance", type: "money", section: INVOICES, hideInTable: true },
    { key: "awaiting_confirmation", label: "Awaiting Finance confirmation", type: "money", section: INVOICES, hideInTable: true },
    { key: "offset_via_ipc", label: "Offset via IPC", type: "money", section: RECOVERY, help: "Contra-charged by Finance from the contractor's payment certificates." },
    { key: "outstanding", label: "Outstanding", type: "money", section: RECOVERY, help: "Invoices issued less payments received and recoveries." },
    { key: "withheld_in_ipc", label: "Withheld under IPC", type: "money", section: RECOVERY, help: "Held back from the contractor's certificate until the accommodation invoices are settled." },
    { key: "ipc_ref", label: "IPC ref", type: "text", section: RECOVERY, hideInTable: true },
    { key: "received_plus_withheld", label: "Received, recovered + withheld", type: "money", section: RECOVERY, hideInTable: true },
    { key: "deemed_settled_fa", label: "To settle in the final account", type: "money", section: RECOVERY, help: "Outstanding and not withheld in an IPC: the tracker deems it settled within the final account." },
    { key: "comments", label: "Comments", type: "textarea", section: RECOVERY, hideInTable: true },
  ],
};

export const customsRecovery: RegisterDef = {
  key: "customs_recovery",
  table: "customs_recovery",
  title: "Customs Duty Recovery",
  singular: "Customs recovery row",
  description: "Customs duties paid by RSG on contractors' imports and how they are recovered under each contract – from the AMAALA Customs Recovery Tracker.",
  group: "Recovery",
  scope: "programme",
  snapshot: false,
  displayField: "vendor",
  displayFields: ["vendor", "contract_code"],
  defaultSort: { field: "to_recover", dir: "desc" },
  totals: ["customs_rsg_paid", "customs_contractor_paid", "to_recover", "unrecoverable", "recoverable_via_contractor", "pvo_value", "ewn_value"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "tracker_key", label: "Tracker key", type: "text", required: true, unique: true, hideInTable: true, hideInForm: true, help: "How a re-upload finds this row again (contract code, else vendor)." },
    { key: "vendor", label: "Vendor / contractor on the tracker", type: "text", required: true, section: TRACKER, width: "18rem" },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, section: TRACKER, filter: true },
    { key: "contract_code", label: "Contract code", type: "text", section: CONTRACT, width: "7rem", help: "e.g. 031C13 – links the row to the cost report line." },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: CONTRACT, hideInTable: true },
    { key: "asset_ref", label: "Asset code (tracker)", type: "text", section: CONTRACT, hideInTable: true },
    { key: "legal_entity", label: "RSG legal entity", type: "text", section: CONTRACT, hideInTable: true },
    { key: "action_lead", label: "Action lead", type: "text", section: CONTRACT, hideInTable: true },
    { key: "contract_value", label: "Contract value incl. variations", type: "money", section: CONTRACT, hideInTable: true },
    { key: "remaining_to_pay", label: "Remaining to pay", type: "money", section: CONTRACT, help: "What is still to be paid under the contract – the room to recover through the certificates." },
    { key: "customs_payer", label: "Who pays customs per contract", type: "text", section: CONTRACT, chip: true, filter: true },
    { key: "other_contract_note", label: "Paid under a different contract", type: "text", section: CONTRACT, hideInTable: true },
    { key: "status", label: "Status", type: "select", options: [...RECOVERY_STATUSES], required: true, defaultValue: "Open", chip: true, filter: true, section: TRACKER },
    { key: "tracker_date", label: "Tracker as of", type: "date", section: TRACKER, hideInTable: true },
    { key: "vat_deferred", label: "VAT deferred (Fasah)", type: "money", section: CUSTOMS, hideInTable: true },
    { key: "vat_definitive", label: "VAT definitive (Fasah)", type: "money", section: CUSTOMS, hideInTable: true },
    { key: "customs_fasah", label: "Customs (Fasah)", type: "money", section: CUSTOMS, hideInTable: true },
    { key: "customs_naif", label: "Customs (Naif)", type: "money", section: CUSTOMS, hideInTable: true },
    { key: "customs_rsg_paid", label: "Customs paid by RSG", type: "money", section: CUSTOMS },
    { key: "customs_contractor_paid", label: "Customs paid by contractor", type: "money", section: CUSTOMS, hideInTable: true },
    { key: "to_recover", label: "RSG / AMAALA to recover", type: "money", section: CUSTOMS },
    { key: "actual_customs_cost", label: "Actual customs cost by asset", type: "money", section: CUSTOMS, hideInTable: true },
    { key: "unrecoverable", label: "Unrecoverable", type: "money", section: RECOVERY, hideInTable: true },
    { key: "recoverable_via_contractor", label: "Recoverable through contractor", type: "money", section: RECOVERY },
    { key: "ps_exceeds", label: "Customs PS exceeded", type: "money", section: RECOVERY, hideInTable: true },
    { key: "notice_ref", label: "Notice of customs recovery", type: "text", section: RECOVERY, hideInTable: true },
    { key: "pvo_ref", label: "PVO / Employer notice ref", type: "text", section: RECOVERY, hideInTable: true },
    { key: "pvo_date", label: "PVO approved date", type: "date", section: RECOVERY, hideInTable: true },
    { key: "pvo_value", label: "PVO value", type: "money", section: RECOVERY },
    { key: "ewn_ref", label: "EWN reference", type: "text", section: RECOVERY, hideInTable: true },
    { key: "ewn_value", label: "EWN value", type: "money", section: RECOVERY },
    { key: "comments", label: "Comments", type: "textarea", section: RECOVERY },
  ],
};

const WBS = "Aconex control account";
const FIGURES = "Aconex figures (SAR)";

/**
 * The project's control accounts as Aconex holds them – uploaded on its own, per project, when a
 * check against the dashboard is wanted. One row per contract and budget hold; the reconciliation
 * report compares each with its cost report line.
 */
export const aconexControlAccounts: RegisterDef = {
  key: "aconex_control_accounts",
  table: "aconex_control_accounts",
  title: "Aconex Control Accounts",
  singular: "Aconex control account",
  description: "Budget, commitments, changes and estimate at completion per contract as exported from Aconex, for reconciliation against the dashboard's cost report.",
  group: "Recovery",
  scope: "programme",
  snapshot: false,
  displayField: "code",
  displayFields: ["code", "name"],
  defaultSort: { field: "code", dir: "asc" },
  totals: ["approved_budget", "current_commitments", "approved_changes", "pending_changes", "eac", "incurred_to_date"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "tracker_key", label: "Tracker key", type: "text", required: true, unique: true, hideInTable: true, hideInForm: true },
    { key: "code", label: "WBS code", type: "text", required: true, section: WBS, width: "15rem" },
    { key: "name", label: "Name", type: "text", section: WBS, width: "18rem" },
    { key: "description", label: "Description", type: "text", section: WBS, hideInTable: true },
    { key: "row_type", label: "Row type", type: "select", options: ["Contract", "Budget hold"], section: WBS, chip: true, filter: true },
    { key: "level", label: "Level", type: "text", section: WBS, hideInTable: true },
    { key: "parent_code", label: "Parent code", type: "text", section: WBS, hideInTable: true },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: WBS, hideInTable: true, help: "Matched by contract code (031C15 ↔ CN.031C15); set it by hand where the codes differ." },
    { key: "tracker_date", label: "Export uploaded", type: "date", section: WBS, hideInTable: true },
    { key: "baseline_budget", label: "Baseline budget", type: "money", section: FIGURES, hideInTable: true },
    { key: "approved_budget_changes", label: "Approved budget changes", type: "money", section: FIGURES, hideInTable: true },
    { key: "approved_budget_transfers", label: "Approved budget transfers", type: "money", section: FIGURES, hideInTable: true },
    { key: "approved_budget", label: "Approved budget", type: "money", section: FIGURES },
    { key: "pending_budget", label: "Pending budget", type: "money", section: FIGURES, hideInTable: true },
    { key: "approved_contracts", label: "Approved contracts (awarded)", type: "money", section: FIGURES, hideInTable: true },
    { key: "approved_changes", label: "Approved contract changes (DVO)", type: "money", section: FIGURES },
    { key: "pending_changes", label: "Pending contract changes (PVO)", type: "money", section: FIGURES },
    { key: "current_commitments", label: "Current commitments", type: "money", section: FIGURES },
    { key: "eac", label: "Estimate at completion", type: "money", section: FIGURES },
    { key: "potential_eac", label: "Potential EAC", type: "money", section: FIGURES, hideInTable: true },
    { key: "incurred_to_date", label: "Incurred to date", type: "money", section: FIGURES },
    { key: "actuals_to_date", label: "Direct actuals to date", type: "money", section: FIGURES, hideInTable: true },
    { key: "at_completion_variance", label: "At completion variance", type: "money", section: FIGURES, hideInTable: true },
  ],
};

export const recoveryRegisters = [accommodationRecovery, customsRecovery, aconexControlAccounts];
