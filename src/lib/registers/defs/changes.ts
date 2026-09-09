import type { FieldDef, RegisterDef } from "../types";

/** The stages a change moves through, in order. */
export const CHANGE_STAGES = [
  { prefix: "ew", label: "Early Warning", short: "EW" },
  { prefix: "rfc", label: "RFC", short: "RFC" },
  { prefix: "pvo", label: "PVO", short: "PVO" },
  { prefix: "vo", label: "VO", short: "VO" },
  { prefix: "ei", label: "EI", short: "EI" },
  { prefix: "dvo", label: "DVO", short: "DVO" },
] as const;

/** Overall statuses that mean the change is no longer open. */
export const CLOSED_STATUSES = ["Approved", "Rejected", "Cancelled", "Superseded", "Transferred", "Review Complete"];

/** Stage statuses that mean the stage amount should no longer be carried in the cost report. */
export const DEAD_STATUSES = ["Cancelled", "Rejected", "Superseded", "Transferred"];

const STATUS = { register: "approval_statuses" };

function stageFields(prefix: string, label: string, full: string): FieldDef[] {
  const s = full;
  return [
    { key: `${prefix}_ref`, label: `${label} reference no`, type: "text", section: s, hideInTable: true },
    { key: `${prefix}_rev`, label: "Revision", type: "text", section: s, hideInTable: true },
    { key: `${prefix}_date`, label: "Date", type: "date", section: s, hideInTable: true },
    { key: `${prefix}_status_id`, label: `${label} status`, type: "lookup", lookup: STATUS, chip: true, section: s, hideInTable: true },
    { key: `${prefix}_aconex_ref`, label: "Aconex workflow approval ref", type: "text", section: s, hideInTable: true },
    { key: `${prefix}_time_impact`, label: "Time impact (days)", type: "number", section: s, hideInTable: true },
    { key: `${prefix}_tracker_amount`, label: `${label} tracker amount`, type: "money", section: s, hideInTable: true, help: "Amount submitted / claimed at this stage." },
    { key: `${prefix}_cr_amount`, label: `${label} cost-report amount`, type: "money", section: s, hideInTable: true, help: "Amount carried in the cost report for this stage." },
  ];
}

function submission(prefix: string, label: string): FieldDef[] {
  const s = "VO submissions";
  return [
    { key: `vo_${prefix}_aconex_ref`, label: `${label} – Aconex ref`, type: "text", section: s, hideInTable: true },
    { key: `vo_${prefix}_date`, label: `${label} – date`, type: "date", section: s, hideInTable: true },
    { key: `vo_${prefix}_amount`, label: `${label} – submitted amount`, type: "money", section: s, hideInTable: true },
  ];
}

const HEADER = "Change details";
const FUNDING = "Funding";

export const changes: RegisterDef = {
  key: "changes",
  table: "changes",
  title: "Change Management Tracker",
  singular: "Change",
  description: "One record per change, followed from Early Warning through RFC, PVO, VO, EI and DVO to funding.",
  displayField: "item_no",
  displayFields: ["item_no", "description"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "item_no", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "item_no", label: "Item No", type: "text", required: true, unique: true, section: HEADER, width: "7rem" },
    { key: "description", label: "Description", type: "textarea", required: true, section: HEADER },
    { key: "current_stage", label: "Current stage", type: "text", virtual: true, readonly: true, hideInForm: true, chip: true },
    { key: "overall_status_id", label: "Overall status", type: "lookup", lookup: STATUS, chip: true, section: HEADER, filter: true },
    { key: "days_open", label: "Days open", type: "number", virtual: true, readonly: true, hideInForm: true, help: "Amber over 30 days, red over 60 (open items only)." },
    { key: "date_raised", label: "Date raised", type: "date", section: HEADER, help: "Used for the Days open column." },
    { key: "asset_id", label: "Project / Asset", type: "lookup", lookup: { register: "assets" }, required: true, section: HEADER, filter: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, section: HEADER, filter: true },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, section: HEADER, filter: true },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: HEADER, hideInTable: true, help: "Which Level 2 line this change feeds (columns H, J, K of the cost report)." },
    { key: "project_stage_id", label: "Project stage", type: "lookup", lookup: { register: "project_stages" }, section: HEADER, filter: true },
    { key: "change_category_id", label: "Change category", type: "lookup", lookup: { register: "change_categories" }, section: HEADER, filter: true },
    { key: "initiated_by_id", label: "Initiated by", type: "lookup", lookup: { register: "change_initiators" }, section: HEADER, filter: true },
    { key: "amaala_rep", label: "Amaala rep", type: "text", section: HEADER, hideInTable: true, help: "Name of the Amaala representative who initiated / sponsors the change." },
    {
      key: "action_pending_by",
      label: "Action pending by",
      type: "select",
      options: ["Contractor", "Consultant", "Engineer's Representative", "Employer's Representative", "Employer / Client", "Authority", "Commercial Team", "None"],
      section: HEADER,
      filter: true,
    },
    { key: "closed_date", label: "Closed date", type: "date", section: HEADER, hideInTable: true, help: "Optional. Stops the Days open counter." },
    ...stageFields("ew", "Early Warning", "Early Warning"),
    ...stageFields("rfc", "RFC", "RFC – Request for Change"),
    ...stageFields("pvo", "PVO", "PVO – Potential Variation Order"),
    ...stageFields("vo", "VO", "VO – Variation Order"),
    { key: "vo_pr_status", label: "PR status", type: "select", options: ["Not raised", "Raised", "Approved", "Rejected", "Closed"], section: "VO – Variation Order", hideInTable: true },
    ...submission("contractor", "Contractor"),
    ...submission("engineer", "Engineer's Rep"),
    ...submission("employer", "Employer's Rep"),
    ...stageFields("ei", "EI", "EI – Engineer's Instruction"),
    ...stageFields("dvo", "DVO", "DVO – Determined Variation Order"),
    { key: "dvo_instruction_date", label: "Date of instruction", type: "date", section: "DVO – Determined Variation Order", hideInTable: true },
    { key: "dvo_avi_ref", label: "AVI / DVO ref", type: "text", section: "DVO – Determined Variation Order", hideInTable: true },
    { key: "dvo_agreement_date", label: "Date of agreement", type: "date", section: "DVO – Determined Variation Order", hideInTable: true },
    { key: "dvo_planned_value", label: "Planned value (PVO)", type: "money", section: "DVO – Determined Variation Order", hideInTable: true },
    { key: "dvo_actual_value", label: "Actual value (AVV)", type: "money", section: "DVO – Determined Variation Order", hideInTable: true },
    { key: "dvo_deadline", label: "Deadline to close", type: "date", section: "DVO – Determined Variation Order", hideInTable: true },
    { key: "dvo_remaining_days", label: "DVO days remaining", type: "number", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "dvo_closed", label: "DVO closed", type: "boolean", defaultValue: false, section: "DVO – Determined Variation Order", hideInTable: true },
    { key: "funding_btr", label: "BTR", type: "money", section: FUNDING, hideInTable: true, help: "Budget transfer request." },
    { key: "funding_pvo", label: "PVO", type: "money", section: FUNDING, hideInTable: true },
    { key: "funding_dvo", label: "DVO", type: "money", section: FUNDING, hideInTable: true },
    { key: "funding_po", label: "PO", type: "money", section: FUNDING, hideInTable: true },
    { key: "funding_pr", label: "PR", type: "money", section: FUNDING, hideInTable: true },
    { key: "funding_contingency", label: "Contingency / Additional budget", type: "money", section: FUNDING, hideInTable: true },
    { key: "notes", label: "Notes", type: "textarea", section: FUNDING, hideInTable: true },
  ],
};

export const changeRegisters: RegisterDef[] = [changes];
