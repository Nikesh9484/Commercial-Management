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

export const RECOVERY_STATUSES = ["Open", "Recovered", "Closed"] as const;

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
    { key: "status", label: "Status", type: "select", options: [...RECOVERY_STATUSES], required: true, defaultValue: "Open", chip: true, filter: true, section: TRACKER, help: "Recovered once the money is fully back (set from the Mark fully recovered button on the summary, or here); Closed when the tracker notes the agreement as closed." },
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
    { key: "change_id", label: "Change item (cost recovery)", type: "lookup", lookup: { register: "changes" }, section: RECOVERY, hideInTable: true, help: "The RFC / EI → PVO → VO → DVO entry in Change Management that recovers this customs duty. Found by itself when its wording mentions customs for the same contractor; set it here when it does not." },
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
    { key: "eac_rsg", label: "Estimate at completion (RSG 1115)", type: "money", section: FIGURES, help: "RSG's own EAC column in the Aconex export – the approved budget less the approved early warnings. Compared with column N when the export carries it." },
    { key: "at_completion_variance_rsg", label: "At completion variance (RSG 1115)", type: "money", section: FIGURES, hideInTable: true },
    { key: "approved_early_warnings_rsg", label: "Approved early warnings (RSG)", type: "money", section: FIGURES, hideInTable: true },
    { key: "pending_early_warnings_rsg", label: "Pending early warnings (RSG)", type: "money", section: FIGURES, hideInTable: true },
    { key: "potential_change_ew", label: "Potential change / early warning", type: "money", section: FIGURES, hideInTable: true },
    { key: "pending_pvos_rsg", label: "Pending contract changes (PVOs, RSG)", type: "money", section: FIGURES, hideInTable: true },
    { key: "potential_etc_ama", label: "AMA potential ETC", type: "money", section: FIGURES, hideInTable: true },
    { key: "remaining_to_certify_rsg", label: "Remaining to certify (RSG 1040)", type: "money", section: FIGURES, hideInTable: true },
    { key: "paid_to_date", label: "Paid to date", type: "money", section: FIGURES, hideInTable: true },
    { key: "deductions_non_repayable", label: "Deductions (non-repayable)", type: "money", section: FIGURES, hideInTable: true },
    { key: "deductions_repayable", label: "Deductions (repayable)", type: "money", section: FIGURES, hideInTable: true },
  ],
};

const EVENT = "Change event";
const IMPACT = "Aconex impact (SAR)";

/**
 * The project's change events as Aconex Cost holds them – PVOs, budget transfers (BTR), RFCs and
 * adjustments – uploaded on their own, per project, from the change-event export. The Aconex Cost Check
 * sets each one against the change register, contractor by contractor.
 */
export const aconexChangeEvents: RegisterDef = {
  key: "aconex_change_events",
  table: "aconex_change_events",
  title: "Aconex Change Events",
  singular: "Aconex change event",
  description: "Every change event of the project as exported from Aconex Cost – its status and its budget and cost impact – for reconciliation against the change register.",
  group: "Recovery",
  scope: "programme",
  snapshot: false,
  displayField: "event_no",
  displayFields: ["event_no", "name"],
  defaultSort: { field: "event_no", dir: "asc" },
  totals: ["total_cost_impact", "approved_cost_impact", "total_budget_impact"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "tracker_key", label: "Tracker key", type: "text", required: true, unique: true, hideInTable: true, hideInForm: true },
    { key: "event_no", label: "Event no", type: "text", required: true, section: EVENT, width: "11rem" },
    { key: "kind", label: "Kind", type: "select", options: ["PVO", "BTR", "RFC", "ADJ", "Other"], section: EVENT, chip: true, filter: true },
    { key: "contract_frag", label: "Contract", type: "text", section: EVENT, width: "6rem", filter: true },
    { key: "name", label: "Name", type: "text", section: EVENT, width: "22rem" },
    { key: "description", label: "Description", type: "textarea", section: EVENT, hideInTable: true },
    { key: "internal_no", label: "Internal event no", type: "text", section: EVENT, hideInTable: true },
    { key: "event_date", label: "Event date", type: "date", section: EVENT },
    { key: "budget_status", label: "Budget status", type: "text", section: EVENT, chip: true, filter: true },
    { key: "cost_status", label: "Cost status", type: "text", section: EVENT, hideInTable: true },
    { key: "event_type", label: "Change event type", type: "text", section: EVENT, hideInTable: true },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: EVENT, hideInTable: true, help: "Matched by the contract code in the event number (031C15-PVO-0003 ↔ CN.031C15)." },
    { key: "contractor_id", label: "Contractor", type: "lookup", lookup: { register: "contractors" }, section: EVENT, filter: true },
    { key: "tracker_date", label: "Export uploaded", type: "date", section: EVENT, hideInTable: true },
    { key: "total_cost_impact", label: "Total cost impact", type: "money", section: IMPACT },
    { key: "approved_cost_impact", label: "Approved cost impact", type: "money", section: IMPACT },
    { key: "potential_cost_impact", label: "Potential cost impact", type: "money", section: IMPACT, hideInTable: true },
    { key: "total_budget_impact", label: "Total budget impact", type: "money", section: IMPACT },
    { key: "approved_budget_impact", label: "Approved budget impact", type: "money", section: IMPACT, hideInTable: true },
    { key: "budget_transfer_from", label: "Budget transfer from", type: "money", section: IMPACT, hideInTable: true },
    { key: "budget_transfer_to", label: "Budget transfer to", type: "money", section: IMPACT, hideInTable: true },
    { key: "net_budget_transfer", label: "Net budget transfer", type: "money", section: IMPACT, hideInTable: true },
    { key: "approved_contract_changes", label: "Approved contract changes", type: "money", section: IMPACT, hideInTable: true },
    { key: "pending_contract_changes", label: "Pending contract changes", type: "money", section: IMPACT, hideInTable: true },
    { key: "approved_change_events", label: "Approved change events", type: "money", section: IMPACT, hideInTable: true },
    { key: "potential_change_events", label: "Potential change events", type: "money", section: IMPACT, hideInTable: true },
  ],
};

const INVOICE = "Invoice";
const SETTLEMENT = "Settlement";

/** One invoice of a lease agreement – the tracker's "Invoice Set" columns, one row per set. */
export const accommodationInvoices: RegisterDef = {
  key: "accommodation_invoices",
  table: "accommodation_invoices",
  title: "Accommodation Invoices",
  singular: "Accommodation invoice",
  description: "Every accommodation invoice issued under a lease agreement, with its due date, what was received or recovered and what is still unpaid – from the Invoice Set columns of the accommodation invoice tracker.",
  group: "Recovery",
  scope: "programme",
  snapshot: false,
  displayField: "invoice_no",
  displayFields: ["invoice_no", "tracker_name"],
  defaultSort: { field: "due_date", dir: "asc" },
  totals: ["amount_gross", "received", "balance_due", "withheld_in_ipc"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "tracker_key", label: "Tracker key", type: "text", required: true, unique: true, hideInTable: true, hideInForm: true },
    { key: "lease_key", label: "Lease agreement key", type: "text", hideInTable: true, hideInForm: true, help: "The tracker key of the lease agreement row this invoice belongs to." },
    { key: "tracker_name", label: "Lease agreement (name on the tracker)", type: "text", required: true, section: INVOICE, width: "16rem" },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, section: INVOICE, filter: true },
    { key: "set_no", label: "Invoice set", type: "number", section: INVOICE, hideInTable: true },
    { key: "invoice_period", label: "Occupancy period", type: "date", section: INVOICE, help: "The month the invoice covers." },
    { key: "invoice_no", label: "Invoice no", type: "text", section: INVOICE, width: "8rem" },
    { key: "invoice_date", label: "Invoice date", type: "date", section: INVOICE },
    { key: "issued_date", label: "Issued on", type: "date", section: INVOICE, help: "When the invoice was issued to the contractor." },
    { key: "due_date", label: "Due date", type: "date", section: INVOICE, help: "The settlement date on the tracker (14 days from issue)." },
    { key: "amount_net", label: "Amount (excl. VAT)", type: "money", section: INVOICE, hideInTable: true },
    { key: "amount_gross", label: "Amount (incl. VAT)", type: "money", section: INVOICE },
    { key: "status", label: "Status", type: "select", options: ["Unpaid", "Part-paid", "Paid", "Not issued"], required: true, defaultValue: "Unpaid", chip: true, filter: true, section: SETTLEMENT },
    { key: "received", label: "Received (incl. VAT)", type: "money", section: SETTLEMENT },
    { key: "confirmed_by_finance", label: "Confirmed by Finance", type: "text", section: SETTLEMENT, hideInTable: true },
    { key: "offset_via_ipc", label: "Offset via IPC", type: "money", section: SETTLEMENT, hideInTable: true },
    { key: "withheld_in_ipc", label: "Withheld under IPC", type: "money", section: SETTLEMENT, hideInTable: true },
    { key: "balance_due", label: "Unpaid", type: "money", section: SETTLEMENT },
    { key: "actual_settlement_date", label: "Settled on", type: "date", section: SETTLEMENT, hideInTable: true },
    { key: "days_overdue", label: "Days overdue", type: "number", section: SETTLEMENT, help: "Unpaid: days past the due date at the tracker date. Paid: how many days late it was settled." },
    { key: "remark", label: "Remark", type: "textarea", section: SETTLEMENT, hideInTable: true },
    { key: "tracker_date", label: "Tracker as of", type: "date", section: SETTLEMENT, hideInTable: true },
  ],
};

const DECLARATION = "Customs declaration";
const PAYMENT = "Payment";

/** One customs declaration (Bayan) on a contractor's imports – the tracker's Breakdown sheet. */
export const customsDeclarations: RegisterDef = {
  key: "customs_declarations",
  table: "customs_declarations",
  title: "Customs Declarations",
  singular: "Customs declaration",
  description: "Each customs declaration on a contractor's imports – port, Bayan number, supplier, customs duty and who paid it – from the Breakdown sheet of the customs recovery tracker; the RSG-paid ones are what the contractor owes back.",
  group: "Recovery",
  scope: "programme",
  snapshot: false,
  displayField: "bayan_no",
  displayFields: ["bayan_no", "supplier"],
  defaultSort: { field: "payment_date", dir: "desc" },
  totals: ["customs_duty", "rsg_paid", "contractor_paid"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "tracker_key", label: "Tracker key", type: "text", required: true, unique: true, hideInTable: true, hideInForm: true },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, section: DECLARATION, filter: true },
    { key: "vendor", label: "Vendor on the tracker", type: "text", section: DECLARATION, hideInTable: true },
    { key: "contract_code", label: "Contract code", type: "text", section: DECLARATION, width: "7rem" },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: DECLARATION, hideInTable: true },
    { key: "payment_date", label: "Payment date", type: "date", section: DECLARATION },
    { key: "statement_date", label: "Statement date", type: "date", section: DECLARATION, hideInTable: true },
    { key: "port", label: "Port", type: "text", section: DECLARATION },
    { key: "statement_type", label: "Type of statement", type: "text", section: DECLARATION, hideInTable: true },
    { key: "bayan_no", label: "Bayan no", type: "text", section: DECLARATION, width: "8rem" },
    { key: "broker", label: "Customs broker", type: "text", section: DECLARATION, hideInTable: true },
    { key: "supplier", label: "Manufacturer / supplier", type: "text", section: DECLARATION, width: "14rem" },
    { key: "goods_value", label: "Goods value (SAR)", type: "money", section: DECLARATION, hideInTable: true },
    { key: "vat_amount", label: "VAT", type: "money", section: DECLARATION, hideInTable: true },
    { key: "customs_duty", label: "Customs duty", type: "money", section: DECLARATION },
    { key: "paid_by", label: "Who paid", type: "select", options: ["RSG", "Contractor", "Unknown"], chip: true, filter: true, section: PAYMENT },
    { key: "invoice_no", label: "Invoice no", type: "text", section: PAYMENT, hideInTable: true },
    { key: "snb_status", label: "RSG SNB status", type: "text", section: PAYMENT, hideInTable: true },
    { key: "rsg_paid", label: "Paid by RSG", type: "money", section: PAYMENT },
    { key: "contractor_paid", label: "Paid by contractor", type: "money", section: PAYMENT, hideInTable: true },
    { key: "pvo_dvo_ref", label: "PVO / DVO reference", type: "text", section: PAYMENT, hideInTable: true },
    { key: "pvo_dvo_amount", label: "PVO / DVO amount", type: "money", section: PAYMENT, hideInTable: true },
    { key: "remarks", label: "Remarks", type: "textarea", section: PAYMENT, hideInTable: true },
    { key: "tracker_date", label: "Tracker as of", type: "date", section: PAYMENT, hideInTable: true },
  ],
};

const LEASE = "Lease agreement";
const TERM = "Term and fee";
const RATES = "Room rates (SAR per person-night)";
const STANDING = "Current position (after amendments)";
export const LEASE_STATUSES = ["Active", "Extended", "Expired", "Terminated", "Closed"] as const;
export const LEASE_BILLING = ["Deducted from the tendered price", "Monthly invoice on actual occupancy", "Other"] as const;

/**
 * The Labour Accommodation Lease Agreements themselves – one row per agreement with the tenant
 * (our contractor), the works contract it serves, the term, the lease fee, the deposit and the room
 * rates – and the amendments that extend or re-price them. The current position (fee and expiry after
 * amendments) is what the tracker chases; the accommodation invoice tracker rows and invoices of the
 * same contractor are tied to the agreement for what has been invoiced, received and is overdue.
 */
export const leaseAgreements: RegisterDef = {
  key: "lease_agreements",
  table: "lease_agreements",
  title: "Accommodation Lease Agreements",
  singular: "Lease agreement",
  description: "Labour Accommodation Lease Agreements with their term, lease fee, security deposit and room rates, and the amendments that change them; tied to the accommodation cost recovery of the same contractor.",
  displayField: "agreement_no",
  displayFields: ["agreement_no", "contractor_id"],
  scope: "programme",
  snapshot: false,
  editRoles: ["admin", "editor", "contributor", "reporter"],
  defaultSort: { field: "current_expiry", dir: "asc" },
  totals: ["lease_fee", "current_fee", "security_deposit", "invoiced_to_date", "outstanding"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "agreement_no", label: "Agreement no", type: "text", required: true, unique: true, width: "9rem", section: LEASE, help: "As printed on the agreement, e.g. 1TB01006C45." },
    { key: "contractor_id", label: "Tenant (contractor)", type: "lookup", lookup: { register: "contractors" }, required: true, filter: true, section: LEASE },
    { key: "contract_code", label: "Works contract code", type: "text", width: "7rem", filter: true, section: LEASE, help: "The works agreement the accommodation serves, e.g. 006C45 – ties the lease to the cost report line and the recovery rows." },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, hideInTable: true, section: LEASE },
    { key: "works_description", label: "Works agreement", type: "textarea", hideInTable: true, section: LEASE, help: "The proposal the lease is attached to, as recited in the agreement." },
    { key: "agreement_date", label: "Agreement date", type: "date", hideInTable: true, section: LEASE },
    { key: "billing_basis", label: "How the fee is charged", type: "select", options: [...LEASE_BILLING], defaultValue: LEASE_BILLING[0], hideInTable: true, section: LEASE },
    { key: "aconex_ref", label: "Aconex ref", type: "text", hideInTable: true, section: LEASE },
    { key: "commencement_date", label: "Commencement", type: "date", required: true, section: TERM },
    { key: "term_months", label: "Term (months)", type: "number", section: TERM, help: "Lease term from the commencement date." },
    { key: "expiry_date", label: "Original expiry", type: "date", hideInTable: true, section: TERM, help: "Commencement plus the term (filled automatically when left blank)." },
    { key: "lease_fee", label: "Original lease fee", type: "money", section: TERM, help: "SAR, as agreed in the original term sheet." },
    { key: "security_deposit", label: "Security deposit", type: "money", hideInTable: true, section: TERM, help: "Usually 5% of the lease fee, payable on or before the commencement date." },
    { key: "deposit_received", label: "Deposit received", type: "boolean", defaultValue: false, filter: true, section: TERM },
    { key: "person_nights", label: "Person-nights contracted", type: "number", hideInTable: true, section: TERM },
    { key: "rate_worker", label: "Worker (4-share)", type: "money", hideInTable: true, section: RATES },
    { key: "rate_junior", label: "Junior (twin)", type: "money", hideInTable: true, section: RATES },
    { key: "rate_senior", label: "Senior (single)", type: "money", hideInTable: true, section: RATES },
    { key: "rate_executive", label: "Executive (single)", type: "money", hideInTable: true, section: RATES },
    { key: "histogram", label: "Monthly fee histogram", type: "textarea", hideInTable: true, section: RATES, help: "Month by month lease fee from the Tenant's Services Usage Histogram (Attachment A.1), e.g. May-25: 10,500; Jun-25: 40,300." },
    { key: "current_fee", label: "Current lease fee", type: "money", section: STANDING, help: "After the latest amendment (the original fee until one is recorded)." },
    { key: "current_expiry", label: "Current expiry", type: "date", section: STANDING, help: "After the latest amendment (the original expiry until one is recorded)." },
    { key: "amendments_count", label: "Amendments", type: "number", defaultValue: 0, width: "6rem", section: STANDING },
    { key: "status", label: "Status", type: "select", options: [...LEASE_STATUSES], required: true, defaultValue: "Active", chip: true, filter: true, section: STANDING },
    { key: "days_to_expiry", label: "Days to expiry", type: "number", virtual: true, readonly: true, hideInForm: true, help: "Amber within 60 days, red within 30 days or expired." },
    { key: "lease_status", label: "Position", type: "text", virtual: true, readonly: true, hideInForm: true, chip: true, help: "Active, Expiring, Expired, Extension needed (the works run past the lease), Closed." },
    { key: "works_completion", label: "Works completion", type: "date", virtual: true, readonly: true, hideInForm: true, hideInTable: true, help: "The works contract's revised completion date (original + EOT granted)." },
    { key: "invoiced_to_date", label: "Invoiced to date (incl. VAT)", type: "money", virtual: true, readonly: true, hideInForm: true, help: "From the accommodation invoice tracker rows of the same contractor." },
    { key: "outstanding", label: "Outstanding", type: "money", virtual: true, readonly: true, hideInForm: true, help: "From the accommodation invoice tracker: invoiced less received and recovered." },
    { key: "overdue_invoices", label: "Overdue invoices", type: "number", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "alerts", label: "Attention", type: "text", virtual: true, readonly: true, hideInForm: true, help: "What needs doing: expiry, extension, deposit, overdue invoices, fee exceeded." },
    { key: "library_doc_id", label: "Library document", type: "number", hideInTable: true, hideInForm: true },
    { key: "comments", label: "Comments", type: "textarea", hideInTable: true },
  ],
};

export const leaseAmendments: RegisterDef = {
  key: "lease_amendments",
  table: "lease_amendments",
  title: "Lease Agreement Amendments",
  singular: "Lease amendment",
  description: "Each amendment to a Labour Accommodation Lease Agreement: what it changed (fee, term, rates) and when.",
  displayField: "amendment_no",
  displayFields: ["agreement_id", "amendment_no"],
  scope: "programme",
  snapshot: false,
  editRoles: ["admin", "editor", "contributor", "reporter"],
  defaultSort: { field: "amendment_date", dir: "desc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "agreement_id", label: "Lease agreement", type: "lookup", lookup: { register: "lease_agreements" }, required: true, filter: true },
    { key: "amendment_no", label: "Amendment no", type: "number", required: true, width: "6rem" },
    { key: "amendment_date", label: "Date", type: "date" },
    { key: "new_fee", label: "Lease fee after amendment", type: "money", help: "Leave blank when the fee is unchanged." },
    { key: "new_term_months", label: "Term after amendment (months)", type: "number", hideInTable: true },
    { key: "new_expiry", label: "Expiry after amendment", type: "date", help: "Leave blank when the term is unchanged." },
    { key: "changes", label: "What changed", type: "textarea" },
    { key: "aconex_ref", label: "Aconex ref", type: "text", hideInTable: true },
    { key: "library_doc_id", label: "Library document", type: "number", hideInTable: true, hideInForm: true },
    { key: "comments", label: "Comments", type: "textarea", hideInTable: true },
  ],
};

export const recoveryRegisters = [accommodationRecovery, accommodationInvoices, customsRecovery, customsDeclarations, aconexControlAccounts, aconexChangeEvents, leaseAgreements, leaseAmendments];
