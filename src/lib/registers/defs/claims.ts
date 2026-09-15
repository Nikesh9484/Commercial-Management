import type { FieldDef, RegisterDef } from "../types";

export const CLAIM_STATUSES = ["Pending", "Approved", "Rejected", "Approved incl. in Lump Sum", "Approved (Authority)", "Approved (proceed to ERI)"];

/** Contract time limits (business days). */
export const NOTICE_LIMIT_DAYS = 28;
export const DETAIL_LIMIT_DAYS = 42;

export const CLAIM_TYPES = [
  { key: "type_eot", label: "EOT" },
  { key: "type_prolongation", label: "Prolongation" },
  { key: "type_disruption", label: "Disruption" },
  { key: "type_acceleration", label: "Acceleration" },
  { key: "type_other", label: "Other" },
] as const;

/** The four assessment parties, in order. */
export const ASSESSMENT_PARTIES = [
  { prefix: "contractor", label: "Contractor's Claim", refLabel: "Claim letter ref" },
  { prefix: "engineer", label: "Engineer's Recommendation", refLabel: "Letter ref" },
  { prefix: "employer", label: "Employer's Assessment", refLabel: "Letter ref" },
  { prefix: "determination", label: "Determination / Agreement", refLabel: "Letter / VO ref" },
] as const;

const HEADER = "Claim details";
const NOTICE = "Notice compliance";
const DETAIL = "Detailed claim";

function assessment(prefix: string, label: string, refLabel: string): FieldDef[] {
  const s = `Assessment – ${label}`;
  return [
    { key: `${prefix}_eot_days`, label: "EOT days", type: "number", section: s, hideInTable: true },
    { key: `${prefix}_compensable_days`, label: "Compensable days", type: "number", section: s, hideInTable: true },
    { key: `${prefix}_cost`, label: "Cost (SAR)", type: "money", section: s, hideInTable: true },
    { key: `${prefix}_ref`, label: refLabel, type: "text", section: s, hideInTable: true },
    { key: `${prefix}_date`, label: "Date", type: "date", section: s, hideInTable: true },
  ];
}

const EAR = "EAR / assessment progress";
const ACTIONS = "Status, actions and notices";
const KPI = "KPI – closure months";
const PROJECT = "Project dates (per tracker)";

/** Extension Assessment Report (EAR / HLEAR) timetable as tracked on the Claims Tracker. */
export const EAR_STEPS = [
  { prefix: "ear_pretia", label: "Draft report – merit & chronology (pre-TIA)" },
  { prefix: "ear_tia", label: "TIA assessment" },
  { prefix: "ear_final", label: "Finalisation (EAR / HLEAR / COST EAR)" },
] as const;

const EAR_FIELDS: FieldDef[] = [
  { key: "last_action", label: "Last action / type of discussion", type: "textarea", section: EAR, hideInTable: true, help: "Last action date and the type of discussion between Employer, Engineer and Contractor." },
  { key: "ear_start_date", label: "EAR / HLEAR start (trigger date)", type: "date", section: EAR, hideInTable: true, help: "Fully detailed claim received, or receipt of the RFA." },
  ...EAR_STEPS.flatMap<FieldDef>((st) => [
    { key: `${st.prefix}_days`, label: `${st.label} – days allowed`, type: "number", section: EAR, hideInTable: true },
    { key: `${st.prefix}_date`, label: `${st.label} – completed`, type: "date", section: EAR, hideInTable: true },
  ]),
];

const STATUS_FIELDS: FieldDef[] = [
  { key: "discretionary_eot", label: "Discretionary EOT", type: "text", section: ACTIONS, hideInTable: true },
  { key: "assessment_report", label: "Assessment report", tableOrder: 10, type: "text", section: ACTIONS, filter: true, width: "10rem" },
  { key: "ei_dvo", label: "EI / DVO status", tableOrder: 11, type: "text", section: ACTIONS, filter: true, width: "10rem" },
  { key: "action_with", label: "Currently with", tableOrder: 4, type: "text", section: ACTIONS, filter: true, chip: true, width: "9rem", help: "Who the claim is sitting with right now – the Contractor, the Engineer, the Employer or the commercial team. Read straight from the Claims Tracker." },
  { key: "owner", label: "Owner (person)", type: "text", section: ACTIONS, hideInTable: true, help: "Who inside the team is carrying this claim – the EOT tracker reports by owner as well as by team." },
  { key: "last_action_date", label: "Last action", tableOrder: 8, type: "date", section: ACTIONS, help: "Drives \"days since last action\" on the EOT / claims tracker. Left empty, the tracker falls back to when the row was last edited." },
  { key: "target_date", label: "Target date", tableOrder: 9, type: "date", section: ACTIONS, help: "Drives \"days to / overdue target\" on the EOT / claims tracker." },
  { key: "remark", label: "Comments", tableOrder: 5, type: "textarea", section: ACTIONS, width: "18rem", help: "The remark column of the Claims Tracker – where the claim actually stands, in the team's own words." },
  { key: "rejection", label: "Rejected on merit / revise & resubmit", type: "text", section: ACTIONS, hideInTable: true },
  { key: "nod_issued", label: "Notice of Dissatisfaction issued", type: "boolean", defaultValue: false, section: ACTIONS, hideInTable: true, filter: true },
  { key: "nod_dispute", label: "Notice of Dispute issued", type: "boolean", defaultValue: false, section: ACTIONS, hideInTable: true, filter: true },
];

const KPI_FIELDS: FieldDef[] = [
  { key: "closure_month_report", label: "Assessment report closure month", type: "text", section: KPI, hideInTable: true, help: "MM-YY as on the tracker." },
  { key: "closure_month_eot", label: "Discretionary EOT closure month", type: "text", section: KPI, hideInTable: true },
  { key: "closure_month_dvo", label: "DVO closure month", type: "text", section: KPI, hideInTable: true },
];

const PROJECT_FIELDS: FieldDef[] = [
  { key: "project_start_date", label: "Project start date", type: "date", section: PROJECT, hideInTable: true },
  { key: "project_completion_date", label: "Project completion date", type: "date", section: PROJECT, hideInTable: true },
  { key: "revised_completion_date", label: "Revised completion date", type: "date", section: PROJECT, hideInTable: true },
  { key: "late_entry_date", label: "Entry date of late claim in the tracker", type: "date", section: PROJECT, hideInTable: true },
];

export const claims: RegisterDef = {
  key: "claims",
  table: "claims",
  title: "Claims & Disputes",
  singular: "Claim",
  description: "Contractual claims with notice compliance, detailed claim, assessment by each party and determination.",
  displayField: "claim_no",
  displayFields: ["claim_no", "description"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "claim_no", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "claim_no", label: "Claim No", tableOrder: 1, type: "text", required: true, unique: true, section: HEADER, width: "7rem" },
    { key: "description", label: "Description", tableOrder: 2, type: "textarea", required: true, section: HEADER, width: "26rem" },
    { key: "status", label: "Status", tableOrder: 3, type: "select", options: CLAIM_STATUSES, required: true, defaultValue: "Pending", chip: true, section: HEADER, filter: true },
    { key: "claim_types", label: "Claim type", tableOrder: 6, type: "text", virtual: true, readonly: true, hideInForm: true },
    { key: "asset_id", label: "Asset code", type: "lookup", lookup: { register: "assets" }, required: true, section: HEADER, filter: true, hideInTable: true },
    { key: "contractor_id", label: "Contractor / Consultant", tableOrder: 7, type: "lookup", lookup: { register: "contractors" }, section: HEADER, filter: true },
    { key: "contract_no", label: "Contract No", type: "text", section: HEADER, hideInTable: true },
    { key: "project", label: "Project", type: "text", section: HEADER, hideInTable: true },
    { key: "scope", label: "Scope", type: "textarea", section: HEADER, hideInTable: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, section: HEADER, hideInTable: true, filter: true },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: HEADER, hideInTable: true, help: "Which Level 2 line this claim feeds (column M of the cost report)." },
    { key: "contract_closed", label: "Contract closed (final account)", type: "boolean", virtual: true, readonly: true, hideInForm: true, hideInTable: true, filter: true, help: "Worked out from the Final Account Status: the final account for this contract is signed, not required or a direct payment. The standard pending reports leave these out." },
    { key: "in_cost_report", label: "Carry in cost report (column M)", type: "boolean", defaultValue: true, section: HEADER, hideInTable: true, filter: true, help: "Untick to keep the claim out of the cost report, e.g. when its cost is already carried as an early warning. Claims imported from the Claims Tracker are ticked only once approved." },
    ...CLAIM_TYPES.map<FieldDef>((t) => ({ key: t.key, label: `Claim type: ${t.label}`, type: "boolean", defaultValue: false, section: HEADER, hideInTable: true })),
    { key: "type_other_text", label: "Other – describe", type: "text", section: HEADER, hideInTable: true },

    { key: "notice_aware_date", label: "(A) Date contractor became aware", type: "date", section: NOTICE, hideInTable: true },
    { key: "notice_letter_ref", label: "Notice letter ref", type: "text", section: NOTICE, hideInTable: true },
    { key: "notice_received_date", label: "(B) Date received by RSG", type: "date", section: NOTICE, hideInTable: true },
    { key: "notice_business_days", label: "Business days A → B", type: "number", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "notice_complies", label: "Notice within 28 days", type: "text", virtual: true, readonly: true, hideInForm: true, hideInTable: true, chip: true },
    { key: "notice_response_ref", label: "Engineer / Employer response ref", type: "text", section: NOTICE, hideInTable: true },
    { key: "notice_response_date", label: "Response date", type: "date", section: NOTICE, hideInTable: true },

    { key: "detail_letter_ref", label: "Detailed claim letter ref", type: "text", section: DETAIL, hideInTable: true },
    { key: "detail_received_date", label: "(C) Date detailed claim received", type: "date", section: DETAIL, hideInTable: true },
    { key: "detail_business_days", label: "Business days A → C", type: "number", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "detail_complies", label: "Detail within 42 days", type: "text", virtual: true, readonly: true, hideInForm: true, hideInTable: true, chip: true },
    { key: "detail_response_ref", label: "Engineer / Employer detailed response ref", type: "text", section: DETAIL, hideInTable: true },
    { key: "detail_response_date", label: "Detailed response date", type: "date", section: DETAIL, hideInTable: true },
    { key: "resubmission_ref", label: "Resubmission ref", type: "text", section: DETAIL, hideInTable: true },
    { key: "resubmission_date", label: "Resubmission date", type: "date", section: DETAIL, hideInTable: true },

    ...ASSESSMENT_PARTIES.flatMap((p) => assessment(p.prefix, p.label, p.refLabel)),

    { key: "contractor_eot_days_view", label: "EOT claimed (days)", type: "number", virtual: true, readonly: true, hideInForm: true },
    { key: "determination_eot_days_view", label: "EOT granted (days)", type: "number", virtual: true, readonly: true, hideInForm: true },
    { key: "contractor_cost_view", label: "SAR claimed", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "determination_cost_view", label: "SAR determined", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "cost_report_amount", label: "Cost report amount (M)", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Determination, else Employer's assessment, else Engineer's recommendation, else Contractor's claim. Zero when Rejected or included in the lump sum." },
    { key: "notes", label: "Notes", type: "textarea", section: "Assessment – Determination / Agreement", hideInTable: true },

    // Claims Tracker columns not covered above (every column of the AMAALA tracker is kept)
    { key: "assessment_type", label: "Assessment type", type: "text", section: HEADER, hideInTable: true, filter: true, help: "As on the Claims Tracker: FULL TIA EAR (time), COST EAR (cost), HLEAR …" },
    { key: "tracker_item", label: "Claims Tracker item No", type: "number", section: HEADER, hideInTable: true },
    { key: "notice_days_tracker", label: "(B−A) business days per tracker", type: "number", section: NOTICE, hideInTable: true },
    { key: "notice_complies_tracker", label: "Complies per tracker (20 business days)", type: "text", section: NOTICE, hideInTable: true },
    { key: "detail_days_tracker", label: "(C−A) business days per tracker", type: "number", section: DETAIL, hideInTable: true },
    { key: "detail_complies_tracker", label: "Complies per tracker (30 business days)", type: "text", section: DETAIL, hideInTable: true },
    { key: "hlear_rfa_ref", label: "High-level EAR RFA reference", type: "text", section: DETAIL, hideInTable: true, help: "Pre-approved RFA from management, where one exists." },
    { key: "hlear_rfa_date", label: "High-level EAR RFA approved", type: "date", section: DETAIL, hideInTable: true },
    ...EAR_FIELDS,
    ...STATUS_FIELDS,
    ...KPI_FIELDS,
    ...PROJECT_FIELDS,
  ],
};

export const claimRegisters: RegisterDef[] = [claims];

/** The value carried in the cost report for a claim (see cost_report_amount help text). */
export function claimCostReportAmount(row: Record<string, unknown>): number {
  const status = String(row.status ?? "");
  if (status === "Rejected" || status === "Approved incl. in Lump Sum") return 0;
  if (row.in_cost_report === false || row.in_cost_report === 0) return 0;
  for (const k of ["determination_cost", "employer_cost", "engineer_cost", "contractor_cost"]) {
    const v = row[k];
    if (v !== null && v !== undefined && v !== "") return Number(v);
  }
  return 0;
}
